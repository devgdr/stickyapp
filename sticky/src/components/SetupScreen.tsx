/**
 * Setup Screen Component
 * Initial configuration to select the vault folder
 */

import { useState } from 'react';
import './SetupScreen.css';

interface SetupScreenProps {
  onComplete: (vaultPath: string) => void;
}

export default function SetupScreen({ onComplete }: SetupScreenProps) {
  const [vaultPath, setVaultPath] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!vaultPath.trim()) {
      setError('Please enter a vault path');
      return;
    }
    
    setIsValidating(true);
    setError(null);
    
    try {
      // The vault will be initialized by the parent
      onComplete(vaultPath.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize vault');
    } finally {
      setIsValidating(false);
    }
  };
  
  const suggestedPath = '~/Dropbox/StickyVault';
  
  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-header">
          <div className="setup-logo">📝</div>
          <h1>Welcome to StickyVault</h1>
          <p className="setup-subtitle">Your Dropbox-synced sticky notes</p>
        </div>
        
        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label htmlFor="vault-path">Vault Location</label>
            <p className="form-hint">
              Choose a folder inside your Dropbox to store notes.
              This will be synced across all your devices.
            </p>
            <input
              id="vault-path"
              type="text"
              className="input"
              placeholder={suggestedPath}
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              disabled={isValidating}
            />
            <button
              type="button"
              className="btn btn-ghost suggested-btn"
              onClick={() => setVaultPath(suggestedPath)}
            >
              Use suggested: {suggestedPath}
            </button>
          </div>
          
          {error && (
            <div className="error-message">
              {error}
            </div>
          )}
          
          <button
            type="submit"
            className="btn btn-primary w-full"
            disabled={isValidating}
          >
            {isValidating ? 'Setting up...' : 'Get Started'}
          </button>
        </form>
        
        <div className="setup-footer">
          <p className="text-sm text-muted">
            Notes are stored as Markdown files for easy access
          </p>
        </div>
      </div>
    </div>
  );
}
