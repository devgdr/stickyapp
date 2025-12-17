/// <reference types="vite/client" />

import type { Note, VaultIndex, VaultEvent } from '@stickyvault/core';

export interface ElectronAPI {
  vault: {
    initialize: (vaultPath: string) => Promise<void>;
    getPath: () => Promise<string | null>;
    getAllNotes: () => Promise<Note[]>;
    getNote: (noteId: string) => Promise<Note | null>;
    getIndex: () => Promise<VaultIndex | null>;
    createNote: (partial: Partial<Note>) => Promise<Note | null>;
    updateNote: (noteId: string, updates: Partial<Note>) => Promise<Note | null>;
    deleteNote: (noteId: string) => Promise<boolean>;
    toggleCheckbox: (noteId: string, lineIndex: number) => Promise<Note | null>;
    togglePinned: (noteId: string) => Promise<Note | null>;
    onEvent: (callback: (event: VaultEvent) => void) => () => void;
  };
  window: {
    openNote: (note: Note) => void;
    closeNote: () => void;
    toggleAlwaysOnTop: () => Promise<boolean>;
    minimize: () => void;
  };
  settings: {
    get: <T>(key: string) => Promise<T | undefined>;
    set: (key: string, value: unknown) => Promise<void>;
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
  onNoteUpdated: (callback: (note: Note) => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}

export {};
