/**
 * Settings Component
 * Configure Dropbox API, app preferences, and view app info
 */

import { useState, useEffect } from 'react';
import './Settings.css';

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AppSettings {
  dropboxAppKey: string;
  dropboxToken: string;
  autoStart: boolean;
  startMinimized: boolean;
  syncInterval: number;
  vaultPath: string;
}

export default function Settings({ isOpen, onClose }: SettingsProps) {
  const [settings, setSettings] = useState<AppSettings>({
    dropboxAppKey: '',
    dropboxToken: '',
    autoStart: false,
    startMinimized: false,
    syncInterval: 15,
    vaultPath: '',
  });
  const [activeTab, setActiveTab] = useState<'general' | 'dropbox' | 'about'>('general');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  // Listen for OAuth completion
  useEffect(() => {
    const unsubscribe = window.electron.onDropboxConnected(() => {
      console.log('[Settings] Received dropbox-connected event');
      setIsConnected(true);
      setSaveMessage('✅ Connected to Dropbox!');
      // Refresh status from backend
      window.electron.dropbox.getStatus().then(status => {
        console.log('[Settings] Updated status:', status);
        setIsConnected(status.isConnected);
      });
    });
    return unsubscribe;
  }, []);
  
  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      const [
        dropboxAppKey,
        dropboxToken,
        autoStart,
        startMinimized,
        syncInterval,
        vaultPath,
        dropboxStatus,
      ] = await Promise.all([
        window.electron.settings.get<string>('dropboxAppKey'),
        window.electron.settings.get<string>('dropboxToken'),
        window.electron.settings.get<boolean>('autoStart'),
        window.electron.settings.get<boolean>('startMinimized'),
        window.electron.settings.get<number>('syncInterval'),
        window.electron.vault.getPath(),
        window.electron.dropbox.getStatus(),
      ]);
      
      setSettings({
        dropboxAppKey: dropboxAppKey || '',
        dropboxToken: dropboxToken || '',
        autoStart: autoStart || false,
        startMinimized: startMinimized || false,
        syncInterval: syncInterval || 15,
        vaultPath: vaultPath || '',
      });
      setIsConnected(dropboxStatus.isConnected);
    }
    
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);
  
  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    
    try {
      await Promise.all([
        window.electron.settings.set('autoStart', settings.autoStart),
        window.electron.settings.set('startMinimized', settings.startMinimized),
        window.electron.settings.set('syncInterval', settings.syncInterval),
      ]);
      
      // Set Dropbox credentials if provided
      if (settings.dropboxAppKey) {
        await window.electron.dropbox.setAppKey(settings.dropboxAppKey);
      }
      if (settings.dropboxToken) {
        await window.electron.dropbox.setAccessToken(settings.dropboxToken);
        
        // Auto-test connection after saving token
        setSaveMessage('Testing connection...');
        const result = await window.electron.dropbox.testConnection();
        if (result.success) {
          setSaveMessage(`✅ Connected as: ${result.accountName}`);
          // Trigger initial sync
          window.electron.dropbox.sync();
        } else {
          setSaveMessage(`❌ Connection failed: ${result.error}`);
        }
        setTimeout(() => setSaveMessage(null), 5000);
        return;
      }
      
      setSaveMessage('Settings saved successfully!');
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (error) {
      setSaveMessage('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleTestConnection = async () => {
    setSaveMessage('Testing connection...');
    try {
      const result = await window.electron.dropbox.testConnection();
      if (result.success) {
        setSaveMessage(`✅ Connected as: ${result.accountName}`);
      } else {
        setSaveMessage(`❌ Connection failed: ${result.error}`);
      }
    } catch (error) {
      setSaveMessage('❌ Connection test failed');
    }
    setTimeout(() => setSaveMessage(null), 5000);
  };
  
  const handleSyncNow = async () => {
    try {
      await window.electron.dropbox.sync();
      // Silent sync - no notification needed
    } catch (error) {
      console.error('Sync failed:', error);
    }
  };
  
  const handleDisconnect = async () => {
    await window.electron.dropbox.disconnect();
    setSettings(s => ({ ...s, dropboxToken: '' }));
    setIsConnected(false);
    setSaveMessage('Disconnected from Dropbox');
    setTimeout(() => setSaveMessage(null), 3000);
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="settings-header">
          <h2>⚙️ Settings</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </header>
        
        {/* Tabs */}
        <nav className="settings-tabs">
          <button
            className={`tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >
            General
          </button>
          <button
            className={`tab ${activeTab === 'dropbox' ? 'active' : ''}`}
            onClick={() => setActiveTab('dropbox')}
          >
            Dropbox Sync
          </button>
          <button
            className={`tab ${activeTab === 'about' ? 'active' : ''}`}
            onClick={() => setActiveTab('about')}
          >
            About
          </button>
        </nav>
        
        {/* Content */}
        <div className="settings-content">
          {activeTab === 'general' && (
            <div className="settings-section">
              <div className="form-group">
                <label>Vault Location</label>
                <div className="input-with-button">
                  <input
                    type="text"
                    className="input"
                    value={settings.vaultPath}
                    readOnly
                    placeholder="Not configured"
                  />
                  <button className="btn btn-secondary" disabled>
                    Browse
                  </button>
                </div>
                <p className="form-hint">
                  This is the folder where your notes are stored and synced.
                </p>
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.autoStart}
                    onChange={(e) => setSettings(s => ({ ...s, autoStart: e.target.checked }))}
                  />
                  <span>Start StickyVault on system login</span>
                </label>
              </div>
              
              <div className="form-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={settings.startMinimized}
                    onChange={(e) => setSettings(s => ({ ...s, startMinimized: e.target.checked }))}
                  />
                  <span>Start minimized to system tray</span>
                </label>
              </div>
              
              <div className="form-group">
                <label>Sync Interval (minutes)</label>
                <select
                  className="input"
                  value={settings.syncInterval}
                  onChange={(e) => setSettings(s => ({ ...s, syncInterval: Number(e.target.value) }))}
                >
                  <option value={1}>1 minute</option>
                  <option value={5}>5 minutes</option>
                  <option value={15}>15 minutes</option>
                  <option value={30}>30 minutes</option>
                  <option value={60}>1 hour</option>
                </select>
              </div>
            </div>
          )}
          
          {activeTab === 'dropbox' && (
            <div className="settings-section">
              <div className="info-box">
                <span className="info-icon">ℹ️</span>
                <p>
                  Connect your Dropbox account to sync notes across devices.
                </p>
              </div>
              
              <div className="form-group">
                <label>Dropbox App Key</label>
                <input
                  type="text"
                  className="input"
                  value={settings.dropboxAppKey}
                  onChange={(e) => setSettings(s => ({ ...s, dropboxAppKey: e.target.value }))}
                  placeholder="Enter your Dropbox App Key"
                />
                <p className="form-hint">
                  Found in your Dropbox App Console.
                </p>
              </div>

               {!isConnected ? (
                <div className="form-group">
                  <button
                    className="btn btn-primary btn-block"
                    onClick={async () => {
                      setSaveMessage('Opening Dropbox login...');
                      try {
                        // Save app key first if changed
                        if (settings.dropboxAppKey) {
                          await window.electron.dropbox.setAppKey(settings.dropboxAppKey);
                        }
                        await window.electron.dropbox.startOAuth();
                        setSaveMessage('Waiting for authorization...');
                      } catch (error) {
                        setSaveMessage(`Error: ${error}`);
                      }
                    }}
                    disabled={!settings.dropboxAppKey}
                  >
                    Connect with Dropbox
                  </button>
                  <p className="form-hint" style={{ marginTop: '10px' }}>
                    This will open your browser to authorize Stickynote.
                  </p>
                </div>
              ) : (
                <div className="connected-state">
                  <div className="success-message">
                    ✅ Account Connected
                  </div>
                  <div className="form-actions-inline">
                    <button
                      className="btn btn-primary"
                      onClick={handleSyncNow}
                    >
                      🔄 Sync Now
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={handleDisconnect}
                    >
                      ❌ Disconnect
                    </button>
                  </div>
                </div>
              )}
              
              {/* OR Divider */}
              <div style={{ display: 'flex', alignItems: 'center', margin: '20px 0' }}>
                <div style={{ flex: 1, height: '1px', background: '#444' }} />
                <span style={{ margin: '0 12px', color: '#888', fontSize: '12px' }}>OR</span>
                <div style={{ flex: 1, height: '1px', background: '#444' }} />
              </div>

              {/* Manual Token Entry - Always Visible */}
              <div className="form-group">
                <label>Access Token (from Dropbox Console)</label>
                <textarea
                  className="input"
                  style={{ height: '80px', resize: 'vertical', fontFamily: 'monospace', fontSize: '11px' }}
                  value={settings.dropboxToken}
                  onChange={(e) => setSettings(s => ({ ...s, dropboxToken: e.target.value }))}
                  placeholder="Paste your Generated Access Token from Dropbox Console here"
                />
                <p className="form-hint">
                  Fallback if OAuth fails. Go to Dropbox Console → Generate access token → paste here.
                </p>
              </div>
            </div>
          )}
          
          {activeTab === 'about' && (
            <div className="settings-section about-section">
              <div className="app-info">
                <div className="app-logo">📝</div>
                <h3>StickyVault</h3>
                <p className="version">Version 1.0.0</p>
              </div>
              
              <div className="about-description">
                <p>
                  A Dropbox-synced sticky notes system for Linux, Windows, and Android.
                  Notes are stored as Markdown files with YAML frontmatter for full control
                  and portability.
                </p>
              </div>
              
              <div className="about-links">
                <a href="https://github.com/stickyvault" target="_blank" rel="noopener">
                  🐙 GitHub
                </a>
                <a href="https://stickyvault.app" target="_blank" rel="noopener">
                  🌐 Website
                </a>
              </div>
              
              <div className="about-credits">
                <p className="text-muted">
                  Built with Electron, React, and ❤️
                </p>
              </div>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <footer className="settings-footer">
          {saveMessage && (
            <span className={`save-message ${saveMessage.includes('Failed') ? 'error' : 'success'}`}>
              {saveMessage}
            </span>
          )}
          <div className="footer-buttons">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
