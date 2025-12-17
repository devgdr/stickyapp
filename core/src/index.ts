/**
 * StickyVault Core Library
 * Exports all public APIs
 */

// Types
export type {
  Note,
  NoteMeta,
  NoteColor,
  Reminder,
  CheckboxItem,
  VaultIndex,
  IndexEntry,
  ConflictInfo,
  VaultConfig,
  WindowState,
  VaultEvent,
  VaultEventListener,
} from './types.js';

// Parser
export {
  parseNote,
  serializeNote,
  createNote,
  extractTitleFromContent,
  parseCheckboxes,
  toggleCheckbox,
  addCheckbox,
  getContentPreview,
  getNoteFilename,
  extractNoteId,
} from './parser.js';

// Index Manager
export {
  createEmptyIndex,
  loadIndex,
  saveIndex,
  upsertNoteInIndex,
  removeNoteFromIndex,
  reorderNotes,
  getSortedNotes,
  getPinnedNotes,
  searchNotesByTitle,
  getNotesByTag,
  updateNoteColor,
  toggleNotePinned,
  rebuildIndex,
} from './index-manager.js';

// Conflict Resolver
export {
  isConflictFile,
  getOriginalIdFromConflict,
  handleConflictFile,
  scanForConflicts,
  listConflicts,
  saveConflictsMeta,
  resolveConflict,
  getConflictVersions,
  createMergedNote,
} from './conflict-resolver.js';

// Vault Manager
export {
  VaultManager,
  createVaultManager,
} from './vault-manager.js';

// Crypto (optional encryption)
export {
  encrypt,
  decrypt,
  isEncrypted,
  encryptNoteContent,
  decryptNoteContent,
  validatePassword,
  generateRandomKey,
} from './crypto.js';
