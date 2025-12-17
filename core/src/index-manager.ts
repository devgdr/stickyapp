/**
 * Index Manager
 * Manages the vault index.json for fast access to note metadata
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { VaultIndex, IndexEntry, Note, NoteColor } from './types.js';

const INDEX_VERSION = 1;
const INDEX_FILENAME = 'index.json';

/**
 * Create a default empty vault index
 */
export function createEmptyIndex(): VaultIndex {
  return {
    version: INDEX_VERSION,
    lastSync: new Date().toISOString(),
    notes: {},
    deletedNotes: [],
    tags: [],
  };
}

/**
 * Load the vault index from disk
 * @param vaultPath - Path to the vault folder
 * @returns Vault index (creates new if doesn't exist)
 */
export async function loadIndex(vaultPath: string): Promise<VaultIndex> {
  const indexPath = path.join(vaultPath, 'notes', INDEX_FILENAME);
  
  try {
    const content = await fs.readFile(indexPath, 'utf-8');
    const index = JSON.parse(content) as VaultIndex;
    
    // Validate version and migrate if needed
    if (index.version !== INDEX_VERSION) {
      return migrateIndex(index);
    }
    
    return index;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Index doesn't exist, create new
      return createEmptyIndex();
    }
    throw error;
  }
}

/**
 * Save the vault index to disk
 * @param vaultPath - Path to the vault folder
 * @param index - Index to save
 */
export async function saveIndex(vaultPath: string, index: VaultIndex): Promise<void> {
  const notesPath = path.join(vaultPath, 'notes');
  const indexPath = path.join(notesPath, INDEX_FILENAME);
  
  // Ensure notes directory exists
  await fs.mkdir(notesPath, { recursive: true });
  
  // Update lastSync timestamp
  index.lastSync = new Date().toISOString();
  
  // Write atomically (write to temp, then rename)
  const tempPath = `${indexPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(tempPath, indexPath);
}

/**
 * Migrate index from older versions
 */
function migrateIndex(oldIndex: VaultIndex): VaultIndex {
  // Future migrations can be added here
  return {
    ...createEmptyIndex(),
    ...oldIndex,
    version: INDEX_VERSION,
  };
}

/**
 * Add or update a note in the index
 * @param index - Current vault index
 * @param note - Note to add/update
 * @returns Updated index
 */
export function upsertNoteInIndex(index: VaultIndex, note: Note): VaultIndex {
  const existingEntry = index.notes[note.id];
  const maxOrder = Math.max(-1, ...Object.values(index.notes).map(e => e.order));
  
  const entry: IndexEntry = {
    order: existingEntry?.order ?? maxOrder + 1,
    pinned: note.pinned,
    color: note.color,
    title: note.title,
    updated: note.updated,
  };
  
  // Update tags list
  const allTags = new Set(index.tags);
  note.tags.forEach(tag => allTags.add(tag));
  
  return {
    ...index,
    notes: {
      ...index.notes,
      [note.id]: entry,
    },
    tags: Array.from(allTags).sort(),
  };
}

/**
 * Remove a note from the index
 * @param index - Current vault index
 * @param noteId - ID of note to remove
 * @param trackDeletion - Whether to add to deletedNotes list
 * @returns Updated index
 */
export function removeNoteFromIndex(
  index: VaultIndex, 
  noteId: string, 
  trackDeletion = true
): VaultIndex {
  const { [noteId]: removed, ...remainingNotes } = index.notes;
  
  return {
    ...index,
    notes: remainingNotes,
    deletedNotes: trackDeletion 
      ? [...new Set([...index.deletedNotes, noteId])]
      : index.deletedNotes,
  };
}

/**
 * Reorder notes in the index
 * @param index - Current vault index
 * @param noteIds - Array of note IDs in desired order
 * @returns Updated index
 */
export function reorderNotes(index: VaultIndex, noteIds: string[]): VaultIndex {
  const updatedNotes = { ...index.notes };
  
  noteIds.forEach((id, order) => {
    if (updatedNotes[id]) {
      updatedNotes[id] = { ...updatedNotes[id], order };
    }
  });
  
  return {
    ...index,
    notes: updatedNotes,
  };
}

/**
 * Get notes sorted by their order, with pinned notes first
 * @param index - Vault index
 * @returns Sorted array of [noteId, entry] tuples
 */
export function getSortedNotes(index: VaultIndex): [string, IndexEntry][] {
  return Object.entries(index.notes).sort((a, b) => {
    // Pinned notes first
    if (a[1].pinned !== b[1].pinned) {
      return a[1].pinned ? -1 : 1;
    }
    // Then by order
    return a[1].order - b[1].order;
  });
}

/**
 * Get pinned notes only
 * @param index - Vault index
 * @returns Array of [noteId, entry] tuples for pinned notes
 */
export function getPinnedNotes(index: VaultIndex): [string, IndexEntry][] {
  return getSortedNotes(index).filter(([, entry]) => entry.pinned);
}

/**
 * Search notes by title (simple substring match)
 * @param index - Vault index
 * @param query - Search query
 * @returns Matching note entries
 */
export function searchNotesByTitle(
  index: VaultIndex, 
  query: string
): [string, IndexEntry][] {
  const lowerQuery = query.toLowerCase();
  return getSortedNotes(index).filter(([, entry]) => 
    entry.title.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Get notes by tag
 * @param index - Vault index
 * @param tag - Tag to filter by
 * @param allNotes - Map of all notes (needed to check tags)
 * @returns Note IDs that have the tag
 */
export function getNotesByTag(
  index: VaultIndex,
  tag: string,
  allNotes: Map<string, Note>
): string[] {
  return Object.keys(index.notes).filter(id => {
    const note = allNotes.get(id);
    return note?.tags.includes(tag);
  });
}

/**
 * Update note color in index
 */
export function updateNoteColor(
  index: VaultIndex,
  noteId: string,
  color: NoteColor
): VaultIndex {
  if (!index.notes[noteId]) return index;
  
  return {
    ...index,
    notes: {
      ...index.notes,
      [noteId]: {
        ...index.notes[noteId],
        color,
      },
    },
  };
}

/**
 * Toggle note pinned status in index
 */
export function toggleNotePinned(
  index: VaultIndex,
  noteId: string
): VaultIndex {
  if (!index.notes[noteId]) return index;
  
  return {
    ...index,
    notes: {
      ...index.notes,
      [noteId]: {
        ...index.notes[noteId],
        pinned: !index.notes[noteId].pinned,
      },
    },
  };
}

/**
 * Rebuild index from note files (repair command)
 * @param vaultPath - Path to the vault folder
 * @param notes - Array of parsed notes
 * @returns Fresh index built from notes
 */
export function rebuildIndex(notes: Note[]): VaultIndex {
  const index = createEmptyIndex();
  const allTags = new Set<string>();
  
  notes.forEach((note, i) => {
    index.notes[note.id] = {
      order: note.pinned ? -1000 + i : i, // Pinned notes get negative order
      pinned: note.pinned,
      color: note.color,
      title: note.title,
      updated: note.updated,
    };
    note.tags.forEach(tag => allTags.add(tag));
  });
  
  // Normalize orders
  const sorted = getSortedNotes(index);
  sorted.forEach(([id], i) => {
    index.notes[id].order = i;
  });
  
  index.tags = Array.from(allTags).sort();
  
  return index;
}
