/**
 * useNotes Hook
 * Manages notes state and syncs with the vault
 */

import { useState, useEffect, useCallback } from 'react';
import type { Note, VaultIndex, VaultEvent } from '@stickyvault/core';

interface UseNotesResult {
  notes: Note[];
  index: VaultIndex | null;
  isLoading: boolean;
  error: Error | null;
  createNote: (partial?: Partial<Note>) => Promise<Note | null>;
  updateNote: (noteId: string, updates: Partial<Note>) => Promise<Note | null>;
  deleteNote: (noteId: string) => Promise<boolean>;
  toggleCheckbox: (noteId: string, lineIndex: number) => Promise<Note | null>;
  togglePinned: (noteId: string) => Promise<Note | null>;
  openNote: (note: Note) => void;
  refresh: () => Promise<void>;
}

export function useNotes(): UseNotesResult {
  const [notes, setNotes] = useState<Note[]>([]);
  const [index, setIndex] = useState<VaultIndex | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Load notes and index
  const loadNotes = useCallback(async () => {
    try {
      setIsLoading(true);
      const [notesData, indexData] = await Promise.all([
        window.electron.vault.getAllNotes(),
        window.electron.vault.getIndex(),
      ]);
      setNotes(notesData);
      setIndex(indexData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to load notes'));
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  // Initial load
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);
  
  // Subscribe to vault events
  useEffect(() => {
    const unsubscribe = window.electron.vault.onEvent((event: VaultEvent) => {
      switch (event.type) {
        case 'note-created':
          setNotes(prev => [...prev, event.note]);
          break;
        case 'note-updated':
          setNotes(prev => prev.map(n => n.id === event.note.id ? event.note : n));
          break;
        case 'note-deleted':
          setNotes(prev => prev.filter(n => n.id !== event.noteId));
          break;
        case 'sync-completed':
          loadNotes();
          break;
      }
    });
    
    return unsubscribe;
  }, [loadNotes]);
  
  // Create a new note
  const createNote = useCallback(async (partial?: Partial<Note>) => {
    try {
      const note = await window.electron.vault.createNote(partial ?? {});
      return note;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to create note'));
      return null;
    }
  }, []);
  
  // Update a note
  const updateNote = useCallback(async (noteId: string, updates: Partial<Note>) => {
    try {
      const note = await window.electron.vault.updateNote(noteId, updates);
      return note;
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to update note'));
      return null;
    }
  }, []);
  
  // Delete a note
  const deleteNote = useCallback(async (noteId: string) => {
    try {
      return await window.electron.vault.deleteNote(noteId);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to delete note'));
      return false;
    }
  }, []);
  
  // Toggle checkbox
  const toggleCheckbox = useCallback(async (noteId: string, lineIndex: number) => {
    try {
      return await window.electron.vault.toggleCheckbox(noteId, lineIndex);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to toggle checkbox'));
      return null;
    }
  }, []);
  
  // Toggle pinned
  const togglePinned = useCallback(async (noteId: string) => {
    try {
      return await window.electron.vault.togglePinned(noteId);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to toggle pinned'));
      return null;
    }
  }, []);
  
  // Open note in a new window
  const openNote = useCallback((note: Note) => {
    window.electron.window.openNote(note);
  }, []);
  
  return {
    notes,
    index,
    isLoading,
    error,
    createNote,
    updateNote,
    deleteNote,
    toggleCheckbox,
    togglePinned,
    openNote,
    refresh: loadNotes,
  };
}
