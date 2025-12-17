/**
 * Vault Manager
 * High-level API for managing the note vault with file watching and sync
 */

import { promises as fs } from 'fs';
import path from 'path';
import { watch, type FSWatcher } from 'chokidar';
import type { 
  Note, 
  VaultIndex, 
  VaultConfig, 
  VaultEvent, 
  VaultEventListener,
  ConflictInfo 
} from './types.js';
import { 
  parseNote, 
  serializeNote, 
  createNote, 
  getNoteFilename, 
  extractNoteId 
} from './parser.js';
import { 
  loadIndex, 
  saveIndex, 
  upsertNoteInIndex, 
  removeNoteFromIndex,
  rebuildIndex 
} from './index-manager.js';
import { 
  scanForConflicts, 
  handleConflictFile, 
  isConflictFile,
  listConflicts,
  saveConflictsMeta
} from './conflict-resolver.js';

/**
 * Vault Manager class - main entry point for vault operations
 */
export class VaultManager {
  private config: VaultConfig;
  private index: VaultIndex | null = null;
  private notes: Map<string, Note> = new Map();
  private watcher: FSWatcher | null = null;
  private listeners: Set<VaultEventListener> = new Set();
  private initialized = false;

  constructor(config: VaultConfig) {
    this.config = config;
  }

  /**
   * Initialize the vault - load index and notes
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const notesPath = this.getNotesPath();
    
    // Ensure directories exist
    await fs.mkdir(notesPath, { recursive: true });
    
    // Load index
    this.index = await loadIndex(this.config.vaultPath);
    
    // Load all notes
    await this.loadAllNotes();
    
    // Handle any existing conflicts
    await this.processConflicts();
    
    // Start file watching if enabled
    if (this.config.watchFiles !== false) {
      this.startWatching();
    }
    
    this.initialized = true;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
    this.listeners.clear();
    this.initialized = false;
  }

  /**
   * Subscribe to vault events
   */
  on(listener: VaultEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: VaultEvent): void {
    this.listeners.forEach(listener => listener(event));
  }

  /**
   * Get the notes folder path
   */
  private getNotesPath(): string {
    return path.join(this.config.vaultPath, 'notes');
  }

  /**
   * Get full path to a note file
   */
  private getNotePath(noteId: string): string {
    return path.join(this.getNotesPath(), getNoteFilename(noteId));
  }

  /**
   * Load all notes from disk
   */
  private async loadAllNotes(): Promise<void> {
    const notesPath = this.getNotesPath();
    
    try {
      const files = await fs.readdir(notesPath);
      
      for (const file of files) {
        if (file === 'index.json' || isConflictFile(file)) continue;
        
        const noteId = extractNoteId(file);
        if (!noteId) continue;
        
        try {
          const content = await fs.readFile(path.join(notesPath, file), 'utf-8');
          const note = parseNote(content);
          this.notes.set(note.id, note);
        } catch (error) {
          console.error(`Failed to load note ${file}:`, error);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Process any conflict files
   */
  private async processConflicts(): Promise<void> {
    const conflicts = await scanForConflicts(this.config.vaultPath);
    const existingConflicts = await listConflicts(this.config.vaultPath);
    const newConflicts: ConflictInfo[] = [...existingConflicts];
    
    for (const conflictFile of conflicts) {
      const info = await handleConflictFile(this.config.vaultPath, conflictFile);
      if (info) {
        newConflicts.push(info);
        this.emit({ type: 'conflict-detected', conflict: info });
      }
    }
    
    if (newConflicts.length > existingConflicts.length) {
      await saveConflictsMeta(this.config.vaultPath, newConflicts);
    }
  }

  /**
   * Start watching for file changes
   */
  private startWatching(): void {
    const notesPath = this.getNotesPath();
    
    this.watcher = watch(notesPath, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher
      .on('add', this.handleFileChange.bind(this, 'add'))
      .on('change', this.handleFileChange.bind(this, 'change'))
      .on('unlink', this.handleFileDelete.bind(this));
  }

  /**
   * Handle file add/change events
   */
  private async handleFileChange(eventType: 'add' | 'change', filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    
    // Check for conflict
    if (isConflictFile(filename)) {
      const info = await handleConflictFile(this.config.vaultPath, filename);
      if (info) {
        const conflicts = await listConflicts(this.config.vaultPath);
        conflicts.push(info);
        await saveConflictsMeta(this.config.vaultPath, conflicts);
        this.emit({ type: 'conflict-detected', conflict: info });
      }
      return;
    }
    
    // Skip non-note files
    if (filename === 'index.json') return;
    
    const noteId = extractNoteId(filename);
    if (!noteId) return;
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const note = parseNote(content);
      
      const isNew = !this.notes.has(note.id);
      this.notes.set(note.id, note);
      
      if (this.index) {
        this.index = upsertNoteInIndex(this.index, note);
        await saveIndex(this.config.vaultPath, this.index);
      }
      
      this.emit({ 
        type: isNew ? 'note-created' : 'note-updated', 
        note 
      });
    } catch (error) {
      console.error(`Failed to process file change for ${filename}:`, error);
    }
  }

  /**
   * Handle file deletion events
   */
  private async handleFileDelete(filePath: string): Promise<void> {
    const filename = path.basename(filePath);
    const noteId = extractNoteId(filename);
    
    if (!noteId) return;
    
    this.notes.delete(noteId);
    
    if (this.index) {
      this.index = removeNoteFromIndex(this.index, noteId);
      await saveIndex(this.config.vaultPath, this.index);
    }
    
    this.emit({ type: 'note-deleted', noteId });
  }

  // ===== PUBLIC API =====

  /**
   * Get all notes
   */
  getAllNotes(): Note[] {
    return Array.from(this.notes.values());
  }

  /**
   * Get a single note by ID
   */
  getNote(noteId: string): Note | undefined {
    return this.notes.get(noteId);
  }

  /**
   * Get the vault index
   */
  getIndex(): VaultIndex | null {
    return this.index;
  }

  /**
   * Create a new note
   */
  async createNote(partial?: Partial<Omit<Note, 'id' | 'created' | 'updated'>>): Promise<Note> {
    const note = createNote(partial);
    
    // Save to disk
    const content = serializeNote(note);
    await fs.writeFile(this.getNotePath(note.id), content, 'utf-8');
    
    // Update cache
    this.notes.set(note.id, note);
    
    // Update index
    if (this.index) {
      this.index = upsertNoteInIndex(this.index, note);
      await saveIndex(this.config.vaultPath, this.index);
    }
    
    this.emit({ type: 'note-created', note });
    
    return note;
  }

  /**
   * Update an existing note
   */
  async updateNote(noteId: string, updates: Partial<Omit<Note, 'id' | 'created'>>): Promise<Note | null> {
    const existing = this.notes.get(noteId);
    if (!existing) return null;
    
    const updated: Note = {
      ...existing,
      ...updates,
      id: noteId, // Ensure ID doesn't change
      created: existing.created, // Preserve creation date
      updated: new Date().toISOString(),
    };
    
    // Save to disk
    const content = serializeNote(updated);
    await fs.writeFile(this.getNotePath(noteId), content, 'utf-8');
    
    // Update cache
    this.notes.set(noteId, updated);
    
    // Update index
    if (this.index) {
      this.index = upsertNoteInIndex(this.index, updated);
      await saveIndex(this.config.vaultPath, this.index);
    }
    
    this.emit({ type: 'note-updated', note: updated });
    
    return updated;
  }

  /**
   * Delete a note
   */
  async deleteNote(noteId: string): Promise<boolean> {
    const notePath = this.getNotePath(noteId);
    
    try {
      await fs.unlink(notePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    
    // Update cache
    this.notes.delete(noteId);
    
    // Update index
    if (this.index) {
      this.index = removeNoteFromIndex(this.index, noteId);
      await saveIndex(this.config.vaultPath, this.index);
    }
    
    this.emit({ type: 'note-deleted', noteId });
    
    return true;
  }

  /**
   * Toggle a checkbox in a note
   */
  async toggleCheckbox(noteId: string, lineIndex: number): Promise<Note | null> {
    const { toggleCheckbox } = await import('./parser.js');
    
    const note = this.notes.get(noteId);
    if (!note) return null;
    
    const newContent = toggleCheckbox(note.content, lineIndex);
    return this.updateNote(noteId, { content: newContent });
  }

  /**
   * Pin/unpin a note
   */
  async togglePinned(noteId: string): Promise<Note | null> {
    const note = this.notes.get(noteId);
    if (!note) return null;
    
    return this.updateNote(noteId, { pinned: !note.pinned });
  }

  /**
   * Rebuild the index from note files
   */
  async rebuildIndex(): Promise<VaultIndex> {
    await this.loadAllNotes();
    const notes = Array.from(this.notes.values());
    this.index = rebuildIndex(notes);
    await saveIndex(this.config.vaultPath, this.index);
    return this.index;
  }

  /**
   * Get pending conflicts
   */
  async getConflicts(): Promise<ConflictInfo[]> {
    return listConflicts(this.config.vaultPath);
  }
}

/**
 * Create a new vault manager instance
 */
export function createVaultManager(config: VaultConfig): VaultManager {
  return new VaultManager(config);
}
