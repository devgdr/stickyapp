import AsyncStorage from '@react-native-async-storage/async-storage';
import { Buffer } from 'buffer';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri, exchangeCodeAsync, refreshAsync, TokenResponse, TokenResponseConfig } from 'expo-auth-session';
import * as Crypto from 'expo-crypto';

global.Buffer = global.Buffer || Buffer;

const DROPBOX_TOKEN_KEY = '@stickyvault_dropbox_token_data';
const DROPBOX_CLIENT_ID_KEY = '@stickyvault_dropbox_client_id';
import Constants from 'expo-constants'; 

// Note interface (matching App.tsx)
export interface Note {
  id: string;
  title: string;
  content: string;
  created: string;
  updated: string;
  pinned: boolean;
  color: string;
  tags: string[];
  widgetId?: number;
}

export class DropboxService {
  private static instance: DropboxService;
  private tokenResponse: TokenResponse | null = null;
  private clientId: string | null = null;
  private redirectUri: string = '';

  private constructor() {
    // Redirect URI will be set dynamically once clientId is loaded
    console.log('[DropboxService] Service initialized, awaiting clientId for redirect URI');
  }

  static getInstance(): DropboxService {
    if (!DropboxService.instance) {
      DropboxService.instance = new DropboxService();
    }
    return DropboxService.instance;
  }

  // --- Auth ---

  async init(): Promise<boolean> {
    try {
      // Load Client ID
      const storedClientId = await AsyncStorage.getItem(DROPBOX_CLIENT_ID_KEY);
      // Fallback to app.json extra if available
      this.clientId = storedClientId || Constants.expoConfig?.extra?.dropboxAppKey || null;

      const json = await AsyncStorage.getItem(DROPBOX_TOKEN_KEY);
      if (json) {
        const config = JSON.parse(json) as TokenResponseConfig;
        this.tokenResponse = new TokenResponse(config);
        
        // return true if we have a refresh token (assumed valid or refreshable)
        return !!this.tokenResponse.refreshToken;
      }
    } catch (e) {
      console.warn('Failed to load dropbox token', e);
    }
    return false;
  }

  async setClientId(id: string) {
      this.clientId = id;
      await AsyncStorage.setItem(DROPBOX_CLIENT_ID_KEY, id);
  }

  async getClientId(): Promise<string | null> {
      if (!this.clientId) {
           const stored = await AsyncStorage.getItem(DROPBOX_CLIENT_ID_KEY);
           this.clientId = stored || Constants.expoConfig?.extra?.dropboxAppKey || null;
      }
      return this.clientId;
  }

  /**
   * Start the OAuth Authorization Code flow with PKCE
   */
  async startAuth(): Promise<boolean> {
    console.log('===========================================');
    console.log('[DropboxService] startAuth called');
    
    if (!this.clientId) {
        console.error('[DropboxService] ERROR: Dropbox App Key is not set');
        return false;
    }
    
    const clientId = this.clientId;
    console.log('[DropboxService] Using App Key:', clientId);
    
    // Use Dropbox's official redirect URI format for mobile apps
    this.redirectUri = `db-${clientId}://1/connect`;
    console.log('[DropboxService] Redirect URI:', this.redirectUri);
    console.log('[DropboxService] ⚠️ Make sure this EXACT URI is added to your Dropbox App Console!');

    try {
      // Generate PKCE code_verifier and code_challenge (required for public clients)
      const codeVerifier = this.generateRandomString(128);
      const codeChallenge = await this.generateCodeChallenge(codeVerifier);
      
      console.log('[DropboxService] Generated PKCE challenge');
      
      // Build auth URL with PKCE
      const authUrl = `https://www.dropbox.com/oauth2/authorize` +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&response_type=code` +
        `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
        `&token_access_type=offline` +
        `&code_challenge=${encodeURIComponent(codeChallenge)}` +
        `&code_challenge_method=S256`;

      console.log('[DropboxService] Opening Auth Session with PKCE...');
      console.log('[DropboxService] Auth URL:', authUrl);
      
      const result = await WebBrowser.openAuthSessionAsync(authUrl, this.redirectUri);
      
      console.log('[DropboxService] Auth result type:', result.type);

      if (result.type === 'success' && result.url) {
        console.log('[DropboxService] Success! Callback URL:', result.url);
        
        const urlParams = new URLSearchParams(result.url.split('?')[1]);
        const code = urlParams.get('code');
        const error = urlParams.get('error');
        const errorDescription = urlParams.get('error_description');

        console.log('[DropboxService] Parsed code:', code ? `${code.substring(0, 10)}...` : 'null');
        console.log('[DropboxService] Error:', error);
        console.log('[DropboxService] Error Description:', errorDescription);

        if (error) {
          console.error('[DropboxService] Dropbox returned error:', error, errorDescription);
          return false;
        }

        if (code) {
          console.log('[DropboxService] Got code. Exchanging for tokens with PKCE...');
          
          // Exchange code for tokens with PKCE
          const tokenResponse = await fetch('https://api.dropboxapi.com/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              code,
              grant_type: 'authorization_code',
              client_id: clientId,
              redirect_uri: this.redirectUri,
              code_verifier: codeVerifier,
            }).toString(),
          });

          if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            console.error('[DropboxService] Token exchange failed:', errorText);
            return false;
          }

          const tokenData = await tokenResponse.json();
          
          const config: TokenResponseConfig = {
            accessToken: tokenData.access_token,
            tokenType: tokenData.token_type,
            expiresIn: tokenData.expires_in,
            refreshToken: tokenData.refresh_token,
            scope: tokenData.scope,
          };
          
          this.tokenResponse = new TokenResponse(config);
          await this.saveToken();
          console.log('[DropboxService] Auth successful! Token saved.');
          console.log('===========================================');
          return true;
        }
      } else if (result.type === 'cancel') {
        console.log('[DropboxService] User cancelled auth');
      } else if (result.type === 'dismiss') {
        console.log('[DropboxService] Auth dismissed');
      } else {
        console.log('[DropboxService] Auth result:', JSON.stringify(result));
      }
      
      console.log('===========================================');
      return false;
    } catch (e) {
      console.error('[DropboxService] Auth failed with exception:', e);
      console.log('===========================================');
      return false;
    }
  }

  private generateRandomString(length: number): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let text = '';
    for (let i = 0; i < length; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private async generateCodeChallenge(codeVerifier: string): Promise<string> {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      codeVerifier,
      { encoding: Crypto.CryptoEncoding.BASE64 }
    );
    // Convert to URL-safe base64
    return digest
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  private async saveToken() {
    if (this.tokenResponse) {
      await AsyncStorage.setItem(DROPBOX_TOKEN_KEY, JSON.stringify(this.tokenResponse.getRequestConfig()));
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.tokenResponse) {
        // Try init
        await this.init();
        if (!this.tokenResponse) return null;
    }

    // Check freshness
    if (this.tokenResponse.shouldRefresh()) {
        console.log('[DropboxService] Token expired, refreshing...');
        if (!this.tokenResponse.refreshToken) {
            console.warn('[DropboxService] No refresh token available, please re-login');
            // Force logout?
            return null;
        }

        try {
            const freshToken = await refreshAsync({
                clientId: this.clientId || '', // Should be set if we have tokens
                refreshToken: this.tokenResponse.refreshToken,
            }, {
                tokenEndpoint: 'https://api.dropboxapi.com/oauth2/token'
            });
            
            this.tokenResponse = freshToken;
            await this.saveToken();
            console.log('[DropboxService] Token refreshed');
        } catch (e) {
            console.error('[DropboxService] Failed to refresh token', e);
            return null;
        }
    }

    return this.tokenResponse.accessToken;
  }

  async disconnect(): Promise<void> {
    await AsyncStorage.removeItem(DROPBOX_TOKEN_KEY);
    this.tokenResponse = null;
  }

  /**
   * Set access token manually (fallback for OAuth issues)
   * Use the "Generated access token" from Dropbox Console
   */
  async setAccessToken(token: string): Promise<void> {
    // Create a minimal token response for manual tokens
    // Note: These tokens don't have refresh capability
    const config: TokenResponseConfig = {
      accessToken: token,
      tokenType: 'bearer',
      expiresIn: undefined, // No expiry info for manually generated tokens
      refreshToken: undefined,
      scope: undefined,
    };
    this.tokenResponse = new TokenResponse(config);
    await this.saveToken();
    console.log('[DropboxService] Manual access token saved');
  }

  /**
   * Delete a note from Dropbox
   */
  async deleteNote(noteId: string): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      console.warn('[DropboxService] Cannot delete note - not authenticated');
      return false;
    }

    try {
      const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ path: `/notes/${noteId}.md` })
      });

      if (response.ok) {
        console.log(`[DropboxService] Deleted note ${noteId} from Dropbox`);
        return true;
      } else {
        const errorText = await response.text();
        // Ignore "not found" errors (note may not exist on server yet)
        if (errorText.includes('path_lookup/not_found')) {
          console.log(`[DropboxService] Note ${noteId} not found on server (already deleted or never synced)`);
          return true;
        }
        console.warn('[DropboxService] Delete failed:', errorText);
        return false;
      }
    } catch (e) {
      console.error('[DropboxService] Delete error:', e);
      return false;
    }
  }

  isAuthenticated(): boolean {
    return !!this.tokenResponse;
  }

  // --- Sync Logic (Preserved but using getAccessToken) ---

  // ... (Keep existing parsing/serialization logic) ...
  private parseNote(content: string, filename: string): Note | null {
    try {
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;

      const frontmatter = match[1];
      const body = match[2];

      const data: any = {};
      frontmatter.split('\n').forEach(line => {
        const parts = line.split(':');
        if (parts.length >= 2) {
            const key = parts[0].trim();
            let value = parts.slice(1).join(':').trim();
            if (value.startsWith('[') && value.endsWith(']')) {
                 value = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
            } else if (value === 'true') {
                 value = true;
            } else if (value === 'false') {
                 value = false;
            }
            data[key] = value;
        }
      });

      const id = data.id || filename.replace('.md', '');

      return {
        id,
        title: data.title || 'Untitled',
        content: body.trim(),
        created: data.created || new Date().toISOString(),
        updated: data.updated || new Date().toISOString(),
        pinned: data.pinned === true,
        color: data.color || '#FFE066',
        tags: Array.isArray(data.tags) ? data.tags : [],
      };
    } catch (e) {
      console.warn("Error parsing note", filename, e);
      return null;
    }
  }

  private serializeNote(note: Note): string {
    const tags = note.tags && note.tags.length > 0 
        ? `[${note.tags.map(t => `"${t}"`).join(', ')}]` 
        : '[]';

    return `---
id: ${note.id}
title: ${note.title}
created: ${note.created}
updated: ${note.updated}
pinned: ${note.pinned}
color: ${note.color}
tags: ${tags}
---
${note.content}
`;
  }

  async syncWithRemote(localNotes: Note[]): Promise<{ notes: Note[], syncedCount: number, error?: string }> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return { notes: localNotes, syncedCount: 0, error: 'Not authenticated or failed to refresh token' };

    let syncedCount = 0;
    const mergedNotes = [...localNotes];
    const notesMap = new Map(localNotes.map(n => [n.id, n]));

    try {
        console.log('[SYNC] Starting sync with valid token...');

        // 1. Ensure /notes folder exists
        try {
            const createResponse = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ path: '/notes', autorename: false })
            });
            
            if (!createResponse.ok) {
                // Check if folder exists error
                const errorText = await createResponse.text();
                 if (!errorText.includes('path/conflict/folder')) {
                    console.warn('[SYNC] Folder creation warning:', errorText);
                }
            }
        } catch (e) {
            console.warn('[SYNC] Folder check error (continuing):', e);
        }

        // 2. List Remote Files
        const listResponse = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ path: '/notes' })
        });

        if (!listResponse.ok) {
            const errorText = await listResponse.text();
            throw new Error(`List folder failed: ${errorText}`);
        }

        const listData = await listResponse.json();
        const entries = listData.entries || [];
        
        // 3. Download loop
        for (const entry of entries) {
            if (entry['.tag'] === 'file' && entry.name.endsWith('.md')) {
                const noteId = entry.name.replace('.md', '');
                const localNote = notesMap.get(noteId);
                const remoteDate = new Date(entry.client_modified);

                let shouldDownload = false;

                if (!localNote) {
                    shouldDownload = true;
                } else {
                    const localDate = new Date(localNote.updated);
                    // Remote is significantly newer (>2s)
                    if (remoteDate.getTime() > localDate.getTime() + 2000) {
                        shouldDownload = true;
                    }
                }

                if (shouldDownload) {
                    const downloadResponse = await fetch('https://content.dropboxapi.com/2/files/download', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Dropbox-API-Arg': JSON.stringify({ path: entry.path_lower })
                        }
                    });

                    if (downloadResponse.ok) {
                        const text = await downloadResponse.text();
                        const parsed = this.parseNote(text, entry.name);
                        if (parsed) {
                            if (localNote?.widgetId) parsed.widgetId = localNote.widgetId;
                            notesMap.set(parsed.id, parsed);
                            syncedCount++;
                        }
                    }
                }
            }
        }

        // 4. Build set of remote note IDs for deletion detection
        const remoteNoteIds = new Set<string>();
        for (const entry of entries) {
            if (entry['.tag'] === 'file' && entry.name.endsWith('.md')) {
                remoteNoteIds.add(entry.name.replace('.md', ''));
            }
        }
        
        // 5. Detect notes deleted from cloud (exist locally but not in cloud)
        // Only delete if created more than 30 seconds ago (to avoid deleting brand new local notes)
        const thirtySecondsAgo = Date.now() - 30000;
        for (const localNote of localNotes) {
            if (!remoteNoteIds.has(localNote.id)) {
                const createdTime = new Date(localNote.created).getTime();
                if (createdTime < thirtySecondsAgo) {
                    // This note was deleted from cloud - remove from local map
                    console.log(`[SYNC] Note ${localNote.id} was deleted from cloud, removing locally`);
                    notesMap.delete(localNote.id);
                    syncedCount++;
                }
            }
        }

        // 6. Upload loop (only for notes that exist in map now)
        const currentNotes = Array.from(notesMap.values());
        
        for (const note of currentNotes) {
            const remoteEntry = entries.find((e: any) => e.name === `${note.id}.md`);
            let shouldUpload = false;

            if (!remoteEntry) {
                // Note doesn't exist in cloud - upload only if recently created (new local note)
                const createdTime = new Date(note.created).getTime();
                if (createdTime >= thirtySecondsAgo) {
                    shouldUpload = true;
                    console.log(`[SYNC] Uploading new local note: ${note.id}`);
                }
                // Otherwise, it was deleted from cloud - don't re-upload
            } else {
                const remoteDate = new Date(remoteEntry.client_modified);
                const localDate = new Date(note.updated);
                // Local is significantly newer (>2s)
                if (localDate.getTime() > remoteDate.getTime() + 2000) {
                    shouldUpload = true;
                }
            }

            if (shouldUpload) {
                const content = this.serializeNote(note);
                const uploadResponse = await fetch('https://content.dropboxapi.com/2/files/upload', {
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

                if (uploadResponse.ok) {
                    syncedCount++;
                }
            }
        }

        return { notes: Array.from(notesMap.values()), syncedCount: syncedCount };

    } catch (e: any) {
        console.error('[SYNC] Dropbox Sync Error', e);
        return { notes: Array.from(notesMap.values()), syncedCount, error: e.message || "Sync failed" };
    }
  }
}

