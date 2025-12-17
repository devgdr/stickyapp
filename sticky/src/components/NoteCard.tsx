/**
 * NoteCard Component
 * Card preview of a note for the dashboard grid
 */

import type { Note } from '@stickyvault/core';
import './NoteCard.css';

interface NoteCardProps {
  note: Note;
  onClick: () => void;
  onPinToggle: () => void;
  onDelete: () => void;
}

export default function NoteCard({ note, onClick, onPinToggle, onDelete }: NoteCardProps) {
  // Get a preview of the content
  const preview = note.content
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s*/gm, '☐ ')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .slice(0, 150);
  
  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };
  
  // Determine text color based on background
  const getTextColor = (bgColor: string) => {
    // Simple luminance calculation
    const hex = bgColor.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5 ? '#1a1a2e' : '#ffffff';
  };
  
  const textColor = getTextColor(note.color);
  
  return (
    <div
      className={`note-card ${note.pinned ? 'pinned' : ''}`}
      style={{ backgroundColor: note.color, color: textColor }}
      onClick={onClick}
    >
      {/* Pin indicator */}
      {note.pinned && <div className="pin-indicator">📌</div>}
      
      {/* Title */}
      <h3 className="note-card-title">{note.title}</h3>
      
      {/* Content preview */}
      <p className="note-card-preview">
        {preview || <span className="empty-note">Empty note</span>}
      </p>
      
      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="note-card-tags">
          {note.tags.slice(0, 3).map(tag => (
            <span key={tag} className="tag">#{tag}</span>
          ))}
          {note.tags.length > 3 && (
            <span className="tag more">+{note.tags.length - 3}</span>
          )}
        </div>
      )}
      
      {/* Footer */}
      <div className="note-card-footer">
        <span className="note-date">{formatDate(note.updated)}</span>
        
        <div className="note-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="action-btn"
            title={note.pinned ? 'Unpin' : 'Pin'}
            onClick={(e) => { e.stopPropagation(); onPinToggle(); }}
          >
            {note.pinned ? '📌' : '📍'}
          </button>
          <button
            className="action-btn delete"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
          >
            🗑️
          </button>
        </div>
      </div>
      
      {/* Reminders indicator */}
      {note.reminders.length > 0 && (
        <div className="reminder-indicator" title={`${note.reminders.length} reminder(s)`}>
          🔔
        </div>
      )}
    </div>
  );
}
