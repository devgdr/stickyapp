/**
 * Main App component with routing
 * Vault is auto-initialized on Electron startup, so we always show Dashboard
 */

import { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import NoteWindow from './components/NoteWindow';

function App() {
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  
  // Check if we're in a note window (hash route)
  useEffect(() => {
    const hash = window.location.hash;
    const noteMatch = hash.match(/^#\/note\/(.+)$/);
    if (noteMatch) {
      setCurrentNoteId(noteMatch[1]);
    }
    // Short delay to ensure Electron vault is ready
    const timer = setTimeout(() => setIsReady(true), 100);
    return () => clearTimeout(timer);
  }, []);
  
  if (!isReady) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p>Loading StickyVault...</p>
      </div>
    );
  }
  
  // Note window view
  if (currentNoteId) {
    return <NoteWindow noteId={currentNoteId} />;
  }
  
  // Main dashboard (vault is auto-initialized by Electron)
  return <Dashboard />;
}

export default App;

