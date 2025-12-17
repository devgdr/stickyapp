/**
 * Conflict Resolver
 * Handles file conflicts when multiple clients edit the same note
 * Strategy: Last-write-wins with conflict copy preservation
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { ConflictInfo, Note } from './types.js';
import { parseNote, serializeNote } from './parser.js';

const CONFLICTS_FOLDER = 'conflicts';

/**
 * Dropbox conflict marker pattern
 * Example: "note.md" becomes "note (John's conflicted copy 2025-01-01).md"
 */
const DROPBOX_CONFLICT_PATTERN = /^(.+)\s+\((.+)'s conflicted copy (\d{4}-\d{2}-\d{2})\)\.md$/i;

/**
 * Alternative conflict pattern (some Dropbox versions)
 */
const ALT_CONFLICT_PATTERN = /^(.+)\s+\(conflicted copy \d{4}-\d{2}-\d{2}\s+\d+\)\.md$/i;

/**
 * Check if a filename indicates a Dropbox conflict
 */
export function isConflictFile(filename: string): boolean {
  return DROPBOX_CONFLICT_PATTERN.test(filename) || ALT_CONFLICT_PATTERN.test(filename);
}

/**
 * Extract original note ID from a conflict filename
 */
export function getOriginalIdFromConflict(filename: string): string | null {
  const match = filename.match(DROPBOX_CONFLICT_PATTERN) || 
                filename.match(ALT_CONFLICT_PATTERN);
  
  if (match) {
    // The first capture group should be the original filename (without .md)
    // which is the note ID
    const originalName = match[1];
    // Validate it looks like a UUID
    if (/^[a-f0-9-]{36}$/i.test(originalName)) {
      return originalName;
    }
  }
  return null;
}

/**
 * Handle a detected conflict file
 * Moves it to the conflicts folder with metadata
 */
export async function handleConflictFile(
  vaultPath: string,
  conflictFilename: string
): Promise<ConflictInfo | null> {
  const notesPath = path.join(vaultPath, 'notes');
  const conflictsPath = path.join(vaultPath, CONFLICTS_FOLDER);
  const conflictFilePath = path.join(notesPath, conflictFilename);
  
  // Get original note ID
  const originalId = getOriginalIdFromConflict(conflictFilename);
  if (!originalId) {
    console.warn(`Could not extract note ID from conflict file: ${conflictFilename}`);
    return null;
  }
  
  // Ensure conflicts folder exists
  await fs.mkdir(conflictsPath, { recursive: true });
  
  // Read conflict file info
  const conflictStat = await fs.stat(conflictFilePath);
  
  // Check original file
  const originalPath = path.join(notesPath, `${originalId}.md`);
  let originalModTime = new Date().toISOString();
  try {
    const originalStat = await fs.stat(originalPath);
    originalModTime = originalStat.mtime.toISOString();
  } catch {
    // Original might not exist anymore
  }
  
  // Create conflict info
  const conflictInfo: ConflictInfo = {
    noteId: originalId,
    conflictPath: path.join(CONFLICTS_FOLDER, conflictFilename),
    detectedAt: new Date().toISOString(),
    originalModTime,
    conflictModTime: conflictStat.mtime.toISOString(),
  };
  
  // Move conflict file to conflicts folder
  const destPath = path.join(conflictsPath, conflictFilename);
  await fs.rename(conflictFilePath, destPath);
  
  return conflictInfo;
}

/**
 * Scan for conflict files in the notes folder
 */
export async function scanForConflicts(vaultPath: string): Promise<string[]> {
  const notesPath = path.join(vaultPath, 'notes');
  
  try {
    const files = await fs.readdir(notesPath);
    return files.filter(isConflictFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * List all conflict files in the conflicts folder
 */
export async function listConflicts(vaultPath: string): Promise<ConflictInfo[]> {
  const conflictsPath = path.join(vaultPath, CONFLICTS_FOLDER);
  const metaPath = path.join(conflictsPath, 'conflicts.json');
  
  try {
    const content = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(content) as ConflictInfo[];
  } catch {
    return [];
  }
}

/**
 * Save conflict metadata
 */
export async function saveConflictsMeta(
  vaultPath: string, 
  conflicts: ConflictInfo[]
): Promise<void> {
  const conflictsPath = path.join(vaultPath, CONFLICTS_FOLDER);
  await fs.mkdir(conflictsPath, { recursive: true });
  
  const metaPath = path.join(conflictsPath, 'conflicts.json');
  await fs.writeFile(metaPath, JSON.stringify(conflicts, null, 2), 'utf-8');
}

/**
 * Resolve a conflict by choosing one version
 * @param vaultPath - Path to the vault
 * @param conflictInfo - The conflict to resolve
 * @param keepConflict - If true, use conflict version; if false, keep original
 */
export async function resolveConflict(
  vaultPath: string,
  conflictInfo: ConflictInfo,
  keepConflict: boolean
): Promise<void> {
  const conflictFilePath = path.join(vaultPath, conflictInfo.conflictPath);
  const originalPath = path.join(vaultPath, 'notes', `${conflictInfo.noteId}.md`);
  
  if (keepConflict) {
    // Replace original with conflict version
    await fs.copyFile(conflictFilePath, originalPath);
  }
  
  // Delete conflict file
  await fs.unlink(conflictFilePath);
  
  // Update conflicts metadata
  const conflicts = await listConflicts(vaultPath);
  const updated = conflicts.filter(c => c.conflictPath !== conflictInfo.conflictPath);
  await saveConflictsMeta(vaultPath, updated);
}

/**
 * Merge two versions of a note (for manual resolution)
 * Returns both versions for user to compare
 */
export async function getConflictVersions(
  vaultPath: string,
  conflictInfo: ConflictInfo
): Promise<{ original: Note | null; conflict: Note }> {
  const conflictFilePath = path.join(vaultPath, conflictInfo.conflictPath);
  const originalPath = path.join(vaultPath, 'notes', `${conflictInfo.noteId}.md`);
  
  // Read conflict version
  const conflictContent = await fs.readFile(conflictFilePath, 'utf-8');
  const conflict = parseNote(conflictContent);
  
  // Try to read original
  let original: Note | null = null;
  try {
    const originalContent = await fs.readFile(originalPath, 'utf-8');
    original = parseNote(originalContent);
  } catch {
    // Original doesn't exist
  }
  
  return { original, conflict };
}

/**
 * Create a manual merge of two notes
 * Keeps both contents concatenated
 */
export function createMergedNote(original: Note, conflict: Note): Note {
  const mergedContent = `${original.content}

---
**[Merged from conflict - ${new Date().toISOString()}]**

${conflict.content}`;
  
  return {
    ...original,
    content: mergedContent,
    updated: new Date().toISOString(),
    // Merge tags
    tags: [...new Set([...original.tags, ...conflict.tags])],
    // Merge reminders (dedupe by time)
    reminders: [
      ...original.reminders,
      ...conflict.reminders.filter(cr => 
        !original.reminders.some(or => or.time === cr.time)
      ),
    ],
  };
}
