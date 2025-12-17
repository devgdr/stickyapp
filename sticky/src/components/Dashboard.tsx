/**
 * Dashboard Component
 * Main notes list view with search and filters
 */

import { useState, useMemo, useEffect } from 'react';
import { useNotes } from '../hooks/useNotes';
import NoteCard from './NoteCard';
import Settings from './Settings';
import './Dashboard.css';

const NOTE_COLORS = [
  { name: 'Yellow', value: '#FFE066' },
  { name: 'Green', value: '#A8E6CF' },
  { name: 'Blue', value: '#88D8F5' },
  { name: 'Pink', value: '#FFB3BA' },
  { name: 'Purple', value: '#E0BBE4' },
  { name: 'Peach', value: '#FFDAC1' },
];

export default function Dashboard() {
  const { notes, isLoading, error, createNote, deleteNote, togglePinned, openNote } = useNotes();
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pinned'>('all');
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Listen for open-settings event from system tray
  useEffect(() => {
    const unsubscribe = window.electron.onOpenSettings(() => {
      setShowSettings(true);
    });
    return unsubscribe;
  }, []);
  
  // Filter and sort notes
  const filteredNotes = useMemo(() => {
    let result = [...notes];
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(note =>
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query) ||
        note.tags.some(tag => tag.toLowerCase().includes(query))
      );
    }
    
    // Apply pinned filter
    if (filter === 'pinned') {
      result = result.filter(note => note.pinned);
    }
    
    // Sort: pinned first, then by updated date
    result.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated).getTime() - new Date(a.updated).getTime();
    });
    
    return result;
  }, [notes, searchQuery, filter]);
  
  // Create new note with color
  const handleCreateNote = async (color?: string) => {
    const note = await createNote({
      title: 'New Note',
      content: '',
      color: color || '#FFE066',
    });
    if (note) {
      openNote(note);
    }
    setShowColorPicker(false);
  };
  
  // Handle note actions
  const handleNoteClick = (note: typeof notes[0]) => {
    openNote(note);
  };
  
  const handleNotePinToggle = async (noteId: string) => {
    await togglePinned(noteId);
  };
  
  const handleNoteDelete = async (noteId: string) => {
    if (confirm('Delete this note?')) {
      await deleteNote(noteId);
    }
  };
  
  if (isLoading) {
    return (
      <div className="dashboard loading">
        <div className="spinner" />
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="dashboard error">
        <p>Error: {error.message}</p>
      </div>
    );
  }
  
  return (
    <div className="dashboard">
      {/* Header */}
      <header className="dashboard-header">
        <h1 className="dashboard-title">
          <span className="logo-icon">📝</span>
          StickyVault
        </h1>
        
        <div className="header-actions">
          {/* Settings button */}
          <button
            className="btn btn-ghost settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙️
          </button>
          
          {/* New note button with color picker */}
          <div className="new-note-wrapper">
            <button
              className="btn btn-primary new-note-btn"
              onClick={() => setShowColorPicker(!showColorPicker)}
            >
              <span>+</span> New Note
            </button>
            
            {showColorPicker && (
              <div className="color-picker-dropdown">
                {NOTE_COLORS.map(color => (
                  <button
                    key={color.value}
                    className="color-option"
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                    onClick={() => handleCreateNote(color.value)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </header>
      
      {/* Settings Modal */}
      <Settings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      
      {/* Search and filters */}
      <div className="dashboard-toolbar">
        <div className="search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="input search-input"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => setSearchQuery('')}
            >
              ×
            </button>
          )}
        </div>
        
        <div className="filter-tabs">
          <button
            className={`filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({notes.length})
          </button>
          <button
            className={`filter-tab ${filter === 'pinned' ? 'active' : ''}`}
            onClick={() => setFilter('pinned')}
          >
            📌 Pinned ({notes.filter(n => n.pinned).length})
          </button>
        </div>
      </div>
      
      {/* Notes grid */}
      <div className="notes-container">
        {filteredNotes.length === 0 ? (
          <div className="empty-state">
            {searchQuery ? (
              <>
                <span className="empty-icon">🔍</span>
                <p>No notes match "{searchQuery}"</p>
              </>
            ) : (
              <>
                <span className="empty-icon">📝</span>
                <p>No notes yet</p>
                <button
                  className="btn btn-primary"
                  onClick={() => handleCreateNote()}
                >
                  Create your first note
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="notes-grid">
            {filteredNotes.map(note => (
              <NoteCard
                key={note.id}
                note={note}
                onClick={() => handleNoteClick(note)}
                onPinToggle={() => handleNotePinToggle(note.id)}
                onDelete={() => handleNoteDelete(note.id)}
              />
            ))}
          </div>
        )}
      </div>
      
      {/* Status bar */}
      <footer className="dashboard-footer">
        <span className="text-sm text-muted">
          {notes.length} note{notes.length !== 1 ? 's' : ''}
          {filteredNotes.length !== notes.length && ` (${filteredNotes.length} shown)`}
        </span>
      </footer>
    </div>
  );
}
