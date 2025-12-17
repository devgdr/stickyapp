/**
 * Note Parser
 * Handles parsing and serialization of note files with YAML frontmatter
 */

import matter from 'gray-matter';
import { v4 as uuidv4 } from 'uuid';
import type { Note, NoteMeta, CheckboxItem, Reminder } from './types.js';

/**
 * Default values for new notes
 */
const DEFAULT_NOTE_META: Omit<NoteMeta, 'id' | 'created' | 'updated'> = {
  title: 'Untitled Note',
  color: '#FFE066',
  pinned: false,
  reminders: [],
  tags: [],
  encrypted: false,
};

/**
 * Parse a note file content into a Note object
 * @param fileContent - Raw file content with YAML frontmatter
 * @returns Parsed Note object
 */
export function parseNote(fileContent: string): Note {
  const { data, content } = matter(fileContent);
  
  const now = new Date().toISOString();
  
  // Merge with defaults, ensuring all required fields exist
  const note: Note = {
    id: data.id || uuidv4(),
    title: data.title || DEFAULT_NOTE_META.title,
    color: data.color || DEFAULT_NOTE_META.color,
    pinned: Boolean(data.pinned),
    created: data.created || now,
    updated: data.updated || now,
    reminders: parseReminders(data.reminders),
    tags: Array.isArray(data.tags) ? data.tags : [],
    encrypted: Boolean(data.encrypted),
    content: content.trim(),
  };
  
  return note;
}

/**
 * Parse reminders from frontmatter data
 */
function parseReminders(remindersData: unknown): Reminder[] {
  if (!Array.isArray(remindersData)) return [];
  
  return remindersData
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    .map((r) => ({
      id: String(r.id || uuidv4()),
      time: String(r.time || new Date().toISOString()),
      message: r.message ? String(r.message) : undefined,
      acknowledged: Boolean(r.acknowledged),
    }));
}

/**
 * Serialize a Note object back to file content with YAML frontmatter
 * @param note - Note object to serialize
 * @returns String content ready to write to file
 */
export function serializeNote(note: Note): string {
  const { content, ...meta } = note;
  
  // Update the 'updated' timestamp
  meta.updated = new Date().toISOString();
  
  // Use gray-matter to stringify with frontmatter
  const result = matter.stringify(content, meta);
  
  return result;
}

/**
 * Create a new note with default values
 * @param partial - Optional partial note data to merge
 * @returns New Note object
 */
export function createNote(partial?: Partial<Omit<Note, 'id' | 'created' | 'updated'>>): Note {
  const now = new Date().toISOString();
  
  return {
    ...DEFAULT_NOTE_META,
    ...partial,
    id: uuidv4(),
    created: now,
    updated: now,
    content: partial?.content ?? '',
  };
}

/**
 * Extract the title from note content if not explicitly set
 * Uses the first heading or first line
 * @param content - Markdown content
 * @returns Extracted title
 */
export function extractTitleFromContent(content: string): string {
  const lines = content.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check for markdown heading
    const headingMatch = trimmed.match(/^#+\s+(.+)$/);
    if (headingMatch) {
      return headingMatch[1].slice(0, 100);
    }
    
    // Use first non-empty line
    return trimmed.slice(0, 100);
  }
  
  return 'Untitled Note';
}

/**
 * Parse checkbox items from markdown content
 * @param content - Markdown content
 * @returns Array of checkbox items with their positions
 */
export function parseCheckboxes(content: string): CheckboxItem[] {
  const lines = content.split('\n');
  const checkboxes: CheckboxItem[] = [];
  
  const checkboxRegex = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
  
  lines.forEach((line, index) => {
    const match = line.match(checkboxRegex);
    if (match) {
      checkboxes.push({
        lineIndex: index,
        text: match[3],
        checked: match[2].toLowerCase() === 'x',
        originalLine: line,
      });
    }
  });
  
  return checkboxes;
}

/**
 * Toggle a checkbox in the content
 * @param content - Markdown content
 * @param lineIndex - Line index of the checkbox to toggle
 * @returns Updated content with toggled checkbox
 */
export function toggleCheckbox(content: string, lineIndex: number): string {
  const lines = content.split('\n');
  
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return content;
  }
  
  const line = lines[lineIndex];
  const checkboxRegex = /^(\s*[-*]\s+\[)([ xX])(\]\s+.*)$/;
  const match = line.match(checkboxRegex);
  
  if (match) {
    const isChecked = match[2].toLowerCase() === 'x';
    lines[lineIndex] = `${match[1]}${isChecked ? ' ' : 'x'}${match[3]}`;
  }
  
  return lines.join('\n');
}

/**
 * Add a new checkbox item to the content
 * @param content - Markdown content
 * @param text - Text for the new checkbox
 * @param atEnd - If true, add at end; if false, add at beginning
 * @returns Updated content with new checkbox
 */
export function addCheckbox(content: string, text: string, atEnd = true): string {
  const newLine = `- [ ] ${text}`;
  
  if (!content.trim()) {
    return newLine;
  }
  
  if (atEnd) {
    return `${content}\n${newLine}`;
  } else {
    return `${newLine}\n${content}`;
  }
}

/**
 * Get a preview of the note content (first few lines, stripped of markdown)
 * @param content - Full markdown content
 * @param maxLength - Maximum preview length
 * @returns Plain text preview
 */
export function getContentPreview(content: string, maxLength = 100): string {
  // Remove markdown formatting
  let preview = content
    .replace(/^#+\s+/gm, '')           // Remove headings
    .replace(/\*\*([^*]+)\*\*/g, '$1') // Remove bold
    .replace(/\*([^*]+)\*/g, '$1')     // Remove italic
    .replace(/`([^`]+)`/g, '$1')       // Remove inline code
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '☐ ') // Simplify checkboxes
    .replace(/^\s*[-*]\s+/gm, '• ')    // Simplify lists
    .replace(/\n+/g, ' ')              // Collapse newlines
    .trim();
  
  if (preview.length > maxLength) {
    preview = preview.slice(0, maxLength - 3) + '...';
  }
  
  return preview;
}

/**
 * Get the note filename from its ID
 * @param noteId - Note UUID
 * @returns Filename (without path)
 */
export function getNoteFilename(noteId: string): string {
  return `${noteId}.md`;
}

/**
 * Extract note ID from filename
 * @param filename - Note filename
 * @returns Note ID or null if invalid
 */
export function extractNoteId(filename: string): string | null {
  const match = filename.match(/^([a-f0-9-]{36})\.md$/i);
  return match ? match[1] : null;
}
