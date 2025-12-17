/**
 * Dropbox Sync Manager
 * Handles synchronization of notes with Dropbox
 */

import { Dropbox, DropboxAuth } from 'dropbox';
import { shell, app } from 'electron';
import Store from 'electron-store';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { Note } from '@stickyvault/core';
import { serializeNote, parseNote } from '@stickyvault/core';

// Log file path - lazily initialized when app is ready
let LOG_FILE: string | null = null;

function getLogFilePath(): string {
  if (!LOG_FILE) {
    try {
      LOG_FILE = path.join(app.getPath('userData'), 'dropbox-sync.log');
    } catch {
      // App not ready yet, use a temp fallback
      LOG_FILE = '/tmp/dropbox-sync.log';
    }
  }
  return LOG_FILE;
}

// File logger
function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.log(message);
  try {
    fsSync.appendFileSync(getLogFilePath(), line);
  } catch (e) {
    // Ignore file write errors
  }
}

// Sync status types
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline' | 'not-connected';

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: string[];
  errors: string[];
}

// Store for Dropbox credentials and sync state
const store = new Store({
  name: 'stickyvault-dropbox',
  defaults: {
    accessToken: '',
    refreshToken: '',
    appKey: '',
    isConnected: false,
    noteHashes: {} as Record<string, string>, // Track content hashes to avoid re-uploading
  },
});

export class DropboxSyncManager {
  private dbx: Dropbox | null = null;
  private dbxAuth: DropboxAuth | null = null;
  private status: SyncStatus = 'not-connected';
  private syncInterval: NodeJS.Timeout | null = null;
  private localVaultPath: string = '';
  private onStatusChange: ((status: SyncStatus) => void) | null = null;

  constructor() {
    log('=== DropboxSyncManager starting ===');
    log(`Log file: ${getLogFilePath()}`);
    this.initFromStore();
  }

  /**
   * Initialize from stored credentials
   */
  private initFromStore(): void {
    const accessToken = store.get('accessToken') as string;
    const appKey = store.get('appKey') as string;
    
    if (accessToken) {
      log('[Dropbox] Initializing client with access token');
      this.dbx = new Dropbox({ 
        accessToken, 
        clientId: appKey || undefined,
        fetch: fetch 
      });
      this.status = 'idle';
    } else {
      log('[Dropbox] No access token found, skipping init');
    }
  }

  /**
   * Set the local vault path
   */
  setVaultPath(vaultPath: string): void {
    this.localVaultPath = vaultPath;
    log(`[SYNC] Vault path set to: ${vaultPath}`);
  }

  /**
   * Set status change callback
   */
  onStatusChanged(callback: (status: SyncStatus) => void): void {
    this.onStatusChange = callback;
  }

  /**
   * Update and broadcast status
   */
  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.onStatusChange?.(status);
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return this.status;
  }

  /**
   * Check if connected to Dropbox
   */
  isConnected(): boolean {
    return store.get('isConnected') as boolean;
  }

  /**
   * Get stored app key
   */
  getAppKey(): string {
    return store.get('appKey') as string;
  }

  /**
   * Set Dropbox App Key
   */
  setAppKey(appKey: string): void {
    store.set('appKey', appKey);
    this.dbxAuth = new DropboxAuth({ clientId: appKey, fetch: fetch });
  }

  /**
   * Start OAuth flow - opens browser for user to authorize
   */
  async startOAuth(): Promise<string> {
    const appKey = store.get('appKey') as string;
    if (!appKey) {
      throw new Error('App Key not set. Please enter your Dropbox App Key in settings.');
    }

    this.dbxAuth = new DropboxAuth({ clientId: appKey, fetch: fetch });
    
    // Generate OAuth URL
    const redirectUri = 'stickyvault://oauth/callback';
    const authUrl = await this.dbxAuth.getAuthenticationUrl(
      redirectUri,
      undefined,
      'code',
      'offline',
      undefined,
      undefined,
      true
    );

    // Open in browser
    shell.openExternal(authUrl as string);

    return authUrl as string;
  }

  /**
   * Complete OAuth with authorization code
   */
  async completeOAuth(code: string): Promise<boolean> {
    if (!this.dbxAuth) {
      // Re-initialize auth if needed (e.g. app restart during flow)
      const appKey = store.get('appKey') as string;
      if (appKey) {
        this.dbxAuth = new DropboxAuth({ clientId: appKey, fetch: fetch });
      } else {
         throw new Error('OAuth not started and no App Key found');
      }
    }

    try {
      // ... same logic
      const redirectUri = 'stickyvault://oauth/callback';
      const response = await this.dbxAuth.getAccessTokenFromCode(redirectUri, code);
      
      const result = response.result as {
        access_token: string;
        refresh_token?: string;
      };

      store.set('accessToken', result.access_token);
      if (result.refresh_token) {
        store.set('refreshToken', result.refresh_token);
      }
      store.set('isConnected', true);

      this.dbx = new Dropbox({ accessToken: result.access_token, fetch: fetch });
      this.setStatus('idle');

      return true;
    } catch (error) {
      console.error('OAuth error:', JSON.stringify(error));
      return false;
    }
  }

  /**
   * Set access token directly (for testing or manual entry)
   */
  setAccessToken(token: string): void {
    store.set('accessToken', token);
    store.set('isConnected', true);
    this.dbx = new Dropbox({ accessToken: token, fetch: fetch });
    this.setStatus('idle');
  }

  /**
   * Disconnect from Dropbox
   */
  disconnect(): void {
    store.set('accessToken', '');
    store.set('refreshToken', '');
    store.set('isConnected', false);
    this.dbx = null;
    this.setStatus('not-connected');
    this.stopAutoSync();
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<boolean> {
    const refreshToken = store.get('refreshToken') as string;
    const appKey = store.get('appKey') as string;

    if (!refreshToken || !appKey) {
      log('[AUTH] Cannot refresh: missing refresh token or app key');
      return false;
    }

    try {
      log('[AUTH] Refreshing access token...');
      
      const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: appKey,
        }).toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(`[AUTH] Token refresh failed: ${response.status} ${errorText}`);
        // Clear invalid tokens
        this.disconnect();
        return false;
      }

      const result = await response.json() as {
        access_token: string;
        refresh_token?: string;
      };

      // Update stored tokens
      store.set('accessToken', result.access_token);
      if (result.refresh_token) {
        store.set('refreshToken', result.refresh_token);
      }

      // Reinitialize Dropbox client with new token
      this.dbx = new Dropbox({ accessToken: result.access_token, fetch: fetch });
      log('[AUTH] Access token refreshed successfully');
      
      return true;
    } catch (error) {
      log(`[AUTH] Token refresh error: ${error}`);
      this.disconnect();
      return false;
    }
  }

  /**
   * Ensure we have a valid access token, refresh if needed
   */
  private async ensureValidToken(): Promise<boolean> {
    const accessToken = store.get('accessToken') as string;
    
    if (!accessToken) {
      return false;
    }

    // Try a lightweight API call to check if token is valid
    try {
      if (this.dbx) {
        await this.dbx.usersGetCurrentAccount();
        return true; // Token is valid
      }
    } catch (error: any) {
      // Check if it's an auth error
      if (error?.status === 401 || error?.error?.error_summary?.includes('expired')) {
        log('[AUTH] Access token expired, attempting refresh...');
        return await this.refreshAccessToken();
      }
      // Other errors - token might still be valid
      return true;
    }
    
    return false;
  }

  private getNotesCallback: (() => Note[]) | null = null;

  /**
   * Set callback to get notes for sync
   */
  setGetNotesCallback(callback: () => Note[]): void {
    this.getNotesCallback = callback;
  }

  /**
   * Start automatic sync (runs every interval)
   */
  startAutoSync(intervalMs: number = 60000): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    const intervalMinutes = Math.round(intervalMs / 60000);
    log(`[SYNC] Auto-sync started: every ${intervalMinutes} minute(s)`);
    
    // Schedule periodic sync
    this.syncInterval = setInterval(async () => {
      if (this.getNotesCallback) {
        const notes = this.getNotesCallback();
        log(`[AUTO-SYNC] Running scheduled sync for ${notes.length} notes...`);
        await this.syncAllNotes(notes);
      }
    }, intervalMs);
  }

  /**
   * Stop automatic sync
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }

  /**
   * Perform full sync
   */
  async sync(): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: 0,
      downloaded: 0,
      conflicts: [],
      errors: [],
    };

    if (!this.dbx || !this.localVaultPath) {
      return result;
    }

    this.setStatus('syncing');

    try {
      // Download from Dropbox
      const downloadResult = await this.downloadFromDropbox();
      result.downloaded = downloadResult.downloaded;
      result.conflicts.push(...downloadResult.conflicts);

      // Upload to Dropbox
      const uploadResult = await this.uploadToDropbox();
      result.uploaded = uploadResult.uploaded;
      result.errors.push(...uploadResult.errors);

      this.setStatus('idle');
    } catch (error) {
      console.error('Sync error:', error);
      this.setStatus('error');
      result.errors.push(String(error));
    }

    return result;
  }

  private notesFolderCreated = false;

  /**
   * Ensure the /notes folder exists in Dropbox
   */
  private async ensureNotesFolder(): Promise<void> {
    if (this.notesFolderCreated) return;
    
    const accessToken = store.get('accessToken') as string;
    if (!accessToken) return;

    try {
      console.log('[SYNC] Ensuring /notes folder exists...');
      const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: '/notes',
          autorename: false
        })
      });

      if (response.ok) {
        log('[SYNC] Created /notes folder');
        this.notesFolderCreated = true;
      } else {
        const errorText = await response.text();
        // Folder already exists is not an error
        if (errorText.includes('path/conflict/folder')) {
          log('[SYNC] /notes folder already exists');
          this.notesFolderCreated = true;
        } else {
          log(`[SYNC] Failed to create /notes folder: ${errorText}`);
        }
      }
    } catch (error) {
      log(`[SYNC] Error creating /notes folder: ${error}`);
    }
  }

  /**
   * Calculate content hash for a note
   */
  private getContentHash(note: Note): string {
    // Use serialized format for hash consistency with actual file content
    const content = serializeNote(note);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Upload a single note to Dropbox using direct API call
   */
  async uploadNote(note: Note): Promise<boolean> {
    const accessToken = store.get('accessToken') as string;
    if (!accessToken) {
      log('[SYNC] No access token, skipping upload');
      return false;
    }

    // Check hash to avoid re-uploading unchanged notes
    const currentHash = this.getContentHash(note);
    const storedHashes = store.get('noteHashes') as Record<string, string>;
    if (storedHashes[note.id] === currentHash) {
      log(`[SYNC] Note ${note.id} unchanged (hash match), skipping upload`);
      return true;
    }

    try {
      // Ensure we have a valid token before uploading
      const hasValidToken = await this.ensureValidToken();
      if (!hasValidToken) {
        log('[SYNC] No valid token available, skipping upload');
        return false;
      }

      // Get fresh access token
      const accessToken = store.get('accessToken') as string;

      // Ensure /notes folder exists before uploading
      await this.ensureNotesFolder();

      // Use core library serialization for YAML frontmatter format
      const markdown = serializeNote(note);
      const content = Buffer.from(markdown, 'utf-8');
      
      log(`[SYNC] Uploading note ${note.id} to Dropbox...`);
      
      const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({
            path: `/notes/${note.id}.md`,
            mode: 'overwrite',
            autorename: false,
            mute: false
          })
        },
        body: content
      });

      if (!response.ok) {
        const errorText = await response.text();
        log(`[SYNC] Upload failed: ${response.status} ${errorText}`);
        return false;
      }

      const result = await response.json();
      log(`[SYNC] Uploaded note ${note.id} successfully. Rev: ${result.rev}`);
      
      // Save hash
      storedHashes[note.id] = currentHash;
      store.set('noteHashes', storedHashes);
      
      return true;
    } catch (error) {
      log(`[SYNC] Upload note error: ${error}`);
      return false;
    }
  }

  /**
   * Delete a note from Dropbox using direct API call
   */
  async deleteNote(noteId: string): Promise<boolean> {
    const accessToken = store.get('accessToken') as string;
    if (!accessToken) return false;

    try {
      // Ensure valid token
      const hasValidToken = await this.ensureValidToken();
      if (!hasValidToken) return false;

      const accessToken = store.get('accessToken') as string;
      log(`[SYNC] Deleting note ${noteId} from Dropbox...`);
      
      const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          path: `/notes/${noteId}.md`
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        if (errorText.includes('path_lookup/not_found')) {
          log(`[SYNC] Note ${noteId} not found in Dropbox (already deleted)`);
          return true;
        }
        log(`[SYNC] Delete failed: ${response.status} ${errorText}`);
        return false;
      }

      // Remove hash for deleted note
      const storedHashes = store.get('noteHashes') as Record<string, string>;
      delete storedHashes[noteId];
      store.set('noteHashes', storedHashes);

      log(`[SYNC] Deleted note ${noteId} successfully.`);
      return true;
    } catch (error) {
      log(`[SYNC] Delete note error: ${error}`);
      return false;
    }
  }

  /**
   * Sync ALL existing notes from vault to Dropbox
   * This syncs all local notes, using hash to skip unchanged ones
   */
  async syncAllNotes(notes: Note[]): Promise<{ uploaded: number; skipped: number; errors: number }> {
    const result = { uploaded: 0, skipped: 0, errors: 0 };
    const accessToken = store.get('accessToken') as string;
    
    if (!accessToken) {
      log('[SYNC] No access token, cannot sync all notes');
      return result;
    }

    log(`[SYNC] === Starting full sync of ${notes.length} notes ===`);
    
    for (const note of notes) {
      const currentHash = this.getContentHash(note);
      const storedHashes = store.get('noteHashes') as Record<string, string>;
      
      if (storedHashes[note.id] === currentHash) {
        result.skipped++;
        continue; // Skip unchanged notes (don't log each one to reduce noise)
      }

      const success = await this.uploadNote(note);
      if (success) {
        result.uploaded++;
      } else {
        result.errors++;
      }
    }

    log(`[SYNC] === Full sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors ===`);
    return result;
  }

  /**
   * Download all notes from Dropbox
   */
  private async downloadFromDropbox(): Promise<{ downloaded: number; conflicts: string[]; deleted: number }> {
    const result = { downloaded: 0, conflicts: [] as string[], deleted: 0 };
    
    if (!this.dbx) return result;

    try {
      // List files in Dropbox /notes folder
      const response = await this.dbx.filesListFolder({ path: '/notes' });
      
      // Build set of remote note IDs for deletion detection
      const remoteNoteIds = new Set<string>();
      
      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file' && entry.name.endsWith('.md')) {
          const noteId = entry.name.replace('.md', '');
          remoteNoteIds.add(noteId);
          const localPath = path.join(this.localVaultPath, entry.name);
          
          // Check if local file exists and compare YAML timestamps (not file mtime)
          let shouldDownload = true;
          try {
            // Parse local note to get YAML updated timestamp
            const localContent = await fs.readFile(localPath, 'utf-8');
            const localNote = parseNote(localContent);
            const localDate = new Date(localNote.updated);
            const remoteDate = new Date((entry as any).client_modified);
            
            // Use 2-second buffer for timestamp comparison (matches mobile)
            const timeDiff = Math.abs(remoteDate.getTime() - localDate.getTime());
            
            if (timeDiff < 2000) {
              // Timestamps essentially the same, skip
              shouldDownload = false;
            } else if (localDate > remoteDate) {
              // Local is newer, don't download (will upload later)
              shouldDownload = false;
            }
            // If remote is newer by >2s, download
          } catch {
            // Local file doesn't exist or parse failed, download
          }

          if (shouldDownload) {
            // Download file
            const fileResponse = await this.dbx.filesDownload({ path: entry.path_lower! });
            const fileContent = (fileResponse.result as any).fileBlob || (fileResponse.result as any).fileBinary;
            
            if (fileContent) {
              await fs.writeFile(localPath, fileContent);
              result.downloaded++;
            }
          }
        }
      }
      
      // Detect and delete local notes that were removed from cloud
      // (Local files that don't exist in the remote list)
      try {
        const localFiles = await fs.readdir(this.localVaultPath);
        for (const file of localFiles) {
          if (file.endsWith('.md')) {
            const noteId = file.replace('.md', '');
            if (!remoteNoteIds.has(noteId)) {
              // This note was deleted from cloud - check if it's old enough to be considered deleted
              // (not a brand new local note - use file stat ctime/mtime > 30 seconds ago)
              const localPath = path.join(this.localVaultPath, file);
              try {
                const stat = await fs.stat(localPath);
                const fileAge = Date.now() - stat.ctimeMs; // Use ctime (creation/change time)
                if (fileAge > 30000) { // File is older than 30 seconds
                  log(`[SYNC] Note ${noteId} was deleted from cloud, removing locally`);
                  await fs.unlink(localPath);
                  
                  // Also remove from hash store
                  const storedHashes = store.get('noteHashes') as Record<string, string>;
                  delete storedHashes[noteId];
                  store.set('noteHashes', storedHashes);
                  
                  result.deleted++;
                }
              } catch {
                // File stat failed, skip
              }
            }
          }
        }
      } catch {
        // Directory read failed, skip deletion detection
      }
      
    } catch (error: any) {
      // Folder might not exist yet
      if (error?.error?.error_summary?.includes('path/not_found')) {
        // Create the folder
        await this.dbx.filesCreateFolderV2({ path: '/notes' });
      } else {
        throw error;
      }
    }

    return result;
  }

  /**
   * Upload all local notes to Dropbox
   */
  private async uploadToDropbox(): Promise<{ uploaded: number; errors: string[] }> {
    const result = { uploaded: 0, errors: [] as string[] };
    
    if (!this.dbx) return result;

    try {
      const files = await fs.readdir(this.localVaultPath);
      
      for (const file of files) {
        if (file.endsWith('.md')) {
          const localPath = path.join(this.localVaultPath, file);
          
          try {
            // Check if file exists before reading
            await fs.access(localPath);
            const content = await fs.readFile(localPath);
            
            console.log(`[SYNC] Auto-uploading ${file}...`);
            await this.dbx.filesUpload({
              path: `/notes/${file}`,
              contents: content,
              mode: { '.tag': 'overwrite' } as any,
            });
            result.uploaded++;
          } catch (fileError: any) {
            if (fileError.code === 'ENOENT') {
              console.log(`[SYNC] Skipping ${file} - file not found (may have been deleted)`);
            } else {
              result.errors.push(`Failed to upload ${file}: ${fileError}`);
              console.error(`[SYNC] Failed to upload ${file}:`, fileError);
            }
          }
        }
      }
    } catch (error) {
      result.errors.push(`Failed to read local notes: ${error}`);
    }

    return result;
  }

  /**
   * Test connection to Dropbox
   */
  async testConnection(): Promise<{ success: boolean; accountName?: string; error?: string }> {
    if (!this.dbx) {
      return { success: false, error: 'Not connected to Dropbox' };
    }

    try {
      const response = await this.dbx.usersGetCurrentAccount();
      return {
        success: true,
        accountName: response.result.name.display_name,
      };
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }
}

// Singleton instance
export const dropboxSync = new DropboxSyncManager();
