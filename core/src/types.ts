/**
 * StickyVault Core Types
 * Defines the data structures for notes, reminders, and index management
 */

/**
 * Available note colors for visual identification
 */
export type NoteColor = 
  | '#FFE066'  // Yellow (default)
  | '#A8E6CF'  // Green
  | '#88D8F5'  // Blue
  | '#FFB3BA'  // Pink
  | '#E0BBE4'  // Purple
  | '#FFDAC1'  // Peach
  | '#C4C4C4'  // Gray
  | string;    // Custom hex color

/**
 * Represents a reminder attached to a note
 */
export interface Reminder {
  /** Unique identifier for this reminder */
  id: string;
  /** When to trigger the reminder (ISO 8601) */
  time: string;
  /** Optional custom message for the notification */
  message?: string;
  /** Whether this reminder has been acknowledged */
  acknowledged?: boolean;
}

/**
 * Note metadata stored in YAML frontmatter
 */
export interface NoteMeta {
  /** Unique identifier (UUID v4) */
  id: string;
  /** Display title */
  title: string;
  /** Background color */
  color: NoteColor;
  /** Whether note is pinned to top */
  pinned: boolean;
  /** Creation timestamp (ISO 8601) */
  created: string;
  /** Last update timestamp (ISO 8601) */
  updated: string;
  /** List of reminders for this note */
  reminders: Reminder[];
  /** Tags for categorization */
  tags: string[];
  /** Whether content is encrypted */
  encrypted: boolean;
}

/**
 * Complete note with metadata and content
 */
export interface Note extends NoteMeta {
  /** Markdown content body */
  content: string;
}

/**
 * Checkbox item parsed from markdown content
 */
export interface CheckboxItem {
  /** Line index in the content */
  lineIndex: number;
  /** The text content of the checkbox */
  text: string;
  /** Whether the checkbox is checked */
  checked: boolean;
  /** Full original line for replacement */
  originalLine: string;
}

/**
 * Entry in the index.json for quick access without parsing all notes
 */
export interface IndexEntry {
  /** Display order (0 = first) */
  order: number;
  /** Quick access to pinned status */
  pinned: boolean;
  /** Quick access to color */
  color: NoteColor;
  /** Cached title for list display */
  title: string;
  /** Last update for sorting */
  updated: string;
}

/**
 * The vault index file structure
 */
export interface VaultIndex {
  /** Schema version for migrations */
  version: number;
  /** Last sync timestamp */
  lastSync: string;
  /** Note entries keyed by note ID */
  notes: Record<string, IndexEntry>;
  /** IDs of deleted notes (for sync) */
  deletedNotes: string[];
  /** All tags used across notes */
  tags: string[];
}

/**
 * A detected conflict when multiple clients edit simultaneously
 */
export interface ConflictInfo {
  /** The note ID that has a conflict */
  noteId: string;
  /** Path to the conflict copy */
  conflictPath: string;
  /** When the conflict was detected */
  detectedAt: string;
  /** Original file modification time */
  originalModTime: string;
  /** Conflict file modification time */
  conflictModTime: string;
}

/**
 * Configuration for the vault
 */
export interface VaultConfig {
  /** Path to the vault folder */
  vaultPath: string;
  /** Encryption key (if using encryption) */
  encryptionKey?: string;
  /** Auto-sync interval in milliseconds */
  syncInterval?: number;
  /** Whether to watch for file changes */
  watchFiles?: boolean;
}

/**
 * Local window state (per-device, not synced)
 */
export interface WindowState {
  noteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alwaysOnTop: boolean;
  isOpen: boolean;
}

/**
 * Events emitted by the vault manager
 */
export type VaultEvent = 
  | { type: 'note-created'; note: Note }
  | { type: 'note-updated'; note: Note }
  | { type: 'note-deleted'; noteId: string }
  | { type: 'conflict-detected'; conflict: ConflictInfo }
  | { type: 'sync-started' }
  | { type: 'sync-completed' }
  | { type: 'sync-error'; error: Error };

/**
 * Callback for vault events
 */
export type VaultEventListener = (event: VaultEvent) => void;
