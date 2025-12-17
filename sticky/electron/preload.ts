/**
 * Electron Preload Script
 * Exposes a safe API to the renderer process
 */

import { contextBridge, ipcRenderer } from 'electron';

// Types for the exposed API
export interface ElectronAPI {
  vault: {
    initialize: (vaultPath: string) => Promise<boolean>;
    getPath: () => Promise<string>;
    getAllNotes: () => Promise<import('@stickyvault/core').Note[]>;
    getNote: (noteId: string) => Promise<import('@stickyvault/core').Note | null>;
    getIndex: () => Promise<import('@stickyvault/core').VaultIndex | null>;
    createNote: (partial?: Partial<import('@stickyvault/core').Note>) => Promise<import('@stickyvault/core').Note | null>;
    updateNote: (noteId: string, updates: Partial<import('@stickyvault/core').Note>) => Promise<import('@stickyvault/core').Note | null>;
    deleteNote: (noteId: string) => Promise<boolean>;
    toggleCheckbox: (noteId: string, lineIndex: number) => Promise<import('@stickyvault/core').Note | null>;
    togglePinned: (noteId: string) => Promise<import('@stickyvault/core').Note | null>;
    onEvent: (callback: (event: import('@stickyvault/core').VaultEvent) => void) => () => void;
  };
  window: {
    openNote: (note: import('@stickyvault/core').Note) => void;
    closeNote: () => void;
    toggleAlwaysOnTop: () => Promise<boolean>;
    minimize: () => void;
  };
  settings: {
    get: <T>(key: string) => Promise<T>;
    set: (key: string, value: unknown) => void;
  };
  dropbox: {
    getStatus: () => Promise<{ status: string; isConnected: boolean; appKey: string }>;
    setAppKey: (appKey: string) => Promise<void>;
    setAccessToken: (token: string) => Promise<void>;
    startOAuth: () => Promise<string>;
    completeOAuth: (code: string) => Promise<boolean>;
    disconnect: () => Promise<void>;
    sync: () => Promise<{ uploaded: number; downloaded: number; conflicts: string[]; errors: string[] }>;
    testConnection: () => Promise<{ success: boolean; accountName?: string; error?: string }>;
  };
  onNoteUpdated: (callback: (note: import('@stickyvault/core').Note) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onDropboxConnected: (callback: () => void) => () => void;
}

// Expose the API to the renderer
contextBridge.exposeInMainWorld('electron', {
  vault: {
    initialize: (vaultPath: string) => ipcRenderer.invoke('vault:initialize', vaultPath),
    getPath: () => ipcRenderer.invoke('vault:getPath'),
    getAllNotes: () => ipcRenderer.invoke('vault:getAllNotes'),
    getNote: (noteId: string) => ipcRenderer.invoke('vault:getNote', noteId),
    getIndex: () => ipcRenderer.invoke('vault:getIndex'),
    createNote: (partial) => ipcRenderer.invoke('vault:createNote', partial),
    updateNote: (noteId, updates) => ipcRenderer.invoke('vault:updateNote', noteId, updates),
    deleteNote: (noteId) => ipcRenderer.invoke('vault:deleteNote', noteId),
    toggleCheckbox: (noteId, lineIndex) => ipcRenderer.invoke('vault:toggleCheckbox', noteId, lineIndex),
    togglePinned: (noteId) => ipcRenderer.invoke('vault:togglePinned', noteId),
    onEvent: (callback) => {
      const handler = (_: Electron.IpcRendererEvent, event: import('@stickyvault/core').VaultEvent) => callback(event);
      ipcRenderer.on('vault-event', handler);
      return () => ipcRenderer.removeListener('vault-event', handler);
    },
  },
  window: {
    openNote: (note) => ipcRenderer.invoke('window:openNote', note),
    closeNote: () => ipcRenderer.invoke('window:closeNote'),
    toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
  },
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  },
  dropbox: {
    getStatus: () => ipcRenderer.invoke('dropbox:getStatus'),
    setAppKey: (appKey) => ipcRenderer.invoke('dropbox:setAppKey', appKey),
    setAccessToken: (token) => ipcRenderer.invoke('dropbox:setAccessToken', token),
    startOAuth: () => ipcRenderer.invoke('dropbox:startOAuth'),
    completeOAuth: (code) => ipcRenderer.invoke('dropbox:completeOAuth', code),
    disconnect: () => ipcRenderer.invoke('dropbox:disconnect'),
    sync: () => ipcRenderer.invoke('dropbox:sync'),
    testConnection: () => ipcRenderer.invoke('dropbox:testConnection'),
  },
  onNoteUpdated: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, note: import('@stickyvault/core').Note) => callback(note);
    ipcRenderer.on('note-updated', handler);
    return () => ipcRenderer.removeListener('note-updated', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },
  onDropboxConnected: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('dropbox-connected', handler);
    return () => ipcRenderer.removeListener('dropbox-connected', handler);
  },
} as ElectronAPI);

// Type declaration for window.electron
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
