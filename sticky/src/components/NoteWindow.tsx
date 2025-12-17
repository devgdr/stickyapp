/**
 * NoteWindow Component
 * Frameless window for editing a single note (sticky note style)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Note } from '@stickyvault/core';
import './NoteWindow.css';

interface NoteWindowProps {
  noteId: string;
}

export default function NoteWindow({ noteId }: NoteWindowProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<number>();
  
  // Load note
  useEffect(() => {
    async function loadNote() {
      const noteData = await window.electron.vault.getNote(noteId);
      if (noteData) {
        setNote(noteData);
        setEditTitle(noteData.title);
        setEditContent(noteData.content);
      }
    }
    loadNote();
    
    // Listen for external updates
    const unsubscribe = window.electron.onNoteUpdated((updatedNote) => {
      if (updatedNote.id === noteId) {
        setNote(updatedNote);
        if (!isEditing) {
          setEditTitle(updatedNote.title);
          setEditContent(updatedNote.content);
        }
      }
    });
    
    return unsubscribe;
  }, [noteId, isEditing]);
  
  // Auto-save with debounce
  const saveNote = useCallback(async (title: string, content: string) => {
    if (!note) return;
    
    setIsSaving(true);
    try {
      await window.electron.vault.updateNote(noteId, { title, content });
    } catch (error) {
      console.error('Failed to save note:', error);
    } finally {
      setIsSaving(false);
    }
  }, [note, noteId]);
  
  // Debounced save
  const debouncedSave = useCallback((title: string, content: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      saveNote(title, content);
    }, 500);
  }, [saveNote]);
  
  // Handle content changes
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    setEditContent(newContent);
    debouncedSave(editTitle, newContent);
  };
  
  // Handle title changes
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setEditTitle(newTitle);
    debouncedSave(newTitle, editContent);
  };
  
  // Window controls
  const handleClose = () => {
    window.electron.window.closeNote();
  };
  
  const handleMinimize = () => {
    window.electron.window.minimize();
  };
  
  const handleToggleAlwaysOnTop = async () => {
    const newValue = await window.electron.window.toggleAlwaysOnTop();
    setIsAlwaysOnTop(newValue);
  };
  
  const handleTogglePinned = async () => {
    await window.electron.vault.togglePinned(noteId);
  };
  
  // Get text color based on background
  const getTextColor = (bgColor: string) => {
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#1a1a2e' : '#ffffff';
  };
  
  if (!note) {
    return (
      <div className="note-window loading">
        <div className="spinner" />
      </div>
    );
  }
  
  const textColor = getTextColor(note.color);
  const darkerColor = note.color.replace(/^#/, '');
  const r = Math.max(0, parseInt(darkerColor.substr(0, 2), 16) - 20);
  const g = Math.max(0, parseInt(darkerColor.substr(2, 2), 16) - 20);
  const b = Math.max(0, parseInt(darkerColor.substr(4, 2), 16) - 20);
  const headerColor = `rgb(${r}, ${g}, ${b})`;
  
  return (
    <div 
      className="note-window"
      style={{ backgroundColor: note.color, color: textColor }}
    >
      {/* Draggable title bar */}
      <header 
        className="note-window-header"
        style={{ backgroundColor: headerColor }}
      >
        <div className="window-controls">
          <button 
            className="window-btn close" 
            onClick={handleClose}
            title="Close"
          >
            ×
          </button>
          <button 
            className="window-btn minimize" 
            onClick={handleMinimize}
            title="Minimize"
          >
            −
          </button>
          <button 
            className={`window-btn pin ${isAlwaysOnTop ? 'active' : ''}`}
            onClick={handleToggleAlwaysOnTop}
            title={isAlwaysOnTop ? 'Disable always on top' : 'Always on top'}
          >
            🔝
          </button>
        </div>
        
        <input
          type="text"
          className="note-title-input"
          value={editTitle}
          onChange={handleTitleChange}
          placeholder="Note title..."
          style={{ color: textColor }}
        />
        
        <div className="window-status">
          {isSaving && <span className="saving-indicator">💾</span>}
          {note.pinned && <span className="pinned-indicator">⭐</span>}
        </div>
      </header>
      
      {/* Note content */}
      <div className="note-window-content">
        <textarea
          ref={textareaRef}
          className="note-textarea"
          value={editContent}
          onChange={handleContentChange}
          onFocus={() => setIsEditing(true)}
          onBlur={() => setIsEditing(false)}
          placeholder="Start typing..."
          style={{ color: textColor }}
        />
      </div>
      
      {/* Footer with actions */}
      <footer className="note-window-footer" style={{ backgroundColor: headerColor }}>
        <button
          className={`footer-btn ${note.pinned ? 'active' : ''}`}
          onClick={handleTogglePinned}
          title={note.pinned ? 'Unpin from dashboard' : 'Pin to dashboard'}
        >
          {note.pinned ? '⭐ Pinned' : '☆ Pin'}
        </button>
        
        <span className="note-meta">
          {new Date(note.updated).toLocaleString()}
        </span>
      </footer>
      
      {/* Resize handle */}
      <div className="resize-handle" />
    </div>
  );
}
