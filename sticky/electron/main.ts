/**
 * Electron Main Process
 * Manages the main window, tray, and note windows
 */

import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import Store from 'electron-store';
import { createVaultManager, type Note, type VaultEvent } from '@stickyvault/core';
import { dropboxSync } from './dropbox-sync';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Persistent store for window states and settings
const store = new Store({
  name: 'stickyvault-settings',
  defaults: {
    vaultPath: '',
    windowStates: {} as Record<string, { x: number; y: number; width: number; height: number; alwaysOnTop: boolean }>,
    openNotes: [] as string[],
    startMinimized: true, // Start minimized to tray by default
    autoStart: false,
    autoOpenPinned: true, // Auto-open pinned notes on startup
  },
});

// Global references
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const noteWindows: Map<string, BrowserWindow> = new Map();
let vaultManager: ReturnType<typeof createVaultManager> | null = null;

// Development mode check - use function to defer app.isPackaged access
function isDev(): boolean {
  try {
    return process.env.NODE_ENV === 'development' || !app.isPackaged;
  } catch {
    return true; // If app is not ready, assume dev
  }
}

/**
 * Create the main window (notes list/dashboard)
 */
function createMainWindow(): void {
  // Always start hidden - we show via tray or when user opens
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    frame: true,
    show: false, // Always start hidden, notes appear directly
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
  });

  // Load the app
  if (isDev()) {
    mainWindow.loadURL('http://localhost:5173');
    // Only open dev tools when explicitly in development mode
    if (process.env.NODE_ENV === 'development') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    // Hide instead of close if tray is active
    if (tray && !(app as any).isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Create a sticky note window for a specific note
 */
function createNoteWindow(note: Note): BrowserWindow {
  const savedState = store.get(`windowStates.${note.id}`) as { x: number; y: number; width: number; height: number; alwaysOnTop: boolean } | undefined;
  
  // Default position - cascade from top right
  const display = screen.getPrimaryDisplay();
  const existingCount = noteWindows.size;
  const defaultX = display.workArea.width - 320 - (existingCount * 30);
  const defaultY = 50 + (existingCount * 30);
  
  const noteWindow = new BrowserWindow({
    width: savedState?.width ?? 300,
    height: savedState?.height ?? 350,
    x: savedState?.x ?? defaultX,
    y: savedState?.y ?? defaultY,
    minWidth: 200,
    minHeight: 150,
    frame: false,
    transparent: false,
    alwaysOnTop: savedState?.alwaysOnTop ?? false,
    skipTaskbar: false,
    backgroundColor: note.color,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Load the note view
  const noteUrl = isDev()
    ? `http://localhost:5173/#/note/${note.id}`
    : `file://${path.join(__dirname, '../dist/index.html')}#/note/${note.id}`;
  
  noteWindow.loadURL(noteUrl);

  // Save window state on move/resize
  const saveWindowState = () => {
    if (noteWindow.isDestroyed()) return;
    const bounds = noteWindow.getBounds();
    console.log(`Saving window state for ${note.id}:`, bounds);
    store.set(`windowStates.${note.id}`, {
      ...bounds,
      alwaysOnTop: noteWindow.isAlwaysOnTop(),
    });
  };
  
  noteWindow.on('moved', saveWindowState);
  noteWindow.on('resized', saveWindowState);
  
  noteWindow.on('close', () => {
    // Save position before close
    saveWindowState();
  });
  
  noteWindow.on('closed', () => {
    noteWindows.delete(note.id);
    // Update open notes list
    const openNotes = store.get('openNotes') as string[];
    store.set('openNotes', openNotes.filter(id => id !== note.id));
  });

  noteWindows.set(note.id, noteWindow);
  
  // Track open note
  const openNotes = store.get('openNotes') as string[];
  if (!openNotes.includes(note.id)) {
    store.set('openNotes', [...openNotes, note.id]);
  }
  
  return noteWindow;
}

/**
 * Create or focus a note window
 */
function openNoteWindow(note: Note): void {
  const existing = noteWindows.get(note.id);
  if (existing) {
    existing.focus();
    return;
  }
  createNoteWindow(note);
}

/**
 * Create system tray
 */
function createTray(): void {
  // Load tray icon from assets
  const iconPath = path.join(__dirname, '../assets/tray-icon.png');
  let icon: Electron.NativeImage;
  
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) throw new Error('Icon file empty or not found');
  } catch {
    // Create a simple 16x16 yellow square icon as fallback
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      canvas[i * 4] = 255;     // R
      canvas[i * 4 + 1] = 224; // G
      canvas[i * 4 + 2] = 102; // B
      canvas[i * 4 + 3] = 255; // A
    }
    icon = nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }
  
  tray = new Tray(icon);
  tray.setToolTip('StickyVault - Click to open');
  
  updateTrayMenu();
  
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

/**
 * Update tray context menu (can include dynamic items like pinned notes)
 */
function updateTrayMenu(): void {
  if (!tray) return;
  
  const pinnedNotes = vaultManager?.getAllNotes().filter(n => n.pinned) ?? [];
  
  const pinnedNotesMenu: Electron.MenuItemConstructorOptions[] = pinnedNotes.length > 0
    ? [
        { type: 'separator' },
        { label: '📌 Pinned Notes', enabled: false },
        ...pinnedNotes.slice(0, 5).map(note => ({
          label: `  ${note.title}`,
          click: () => openNoteWindow(note),
        })),
      ]
    : [];
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: '📊 Show Dashboard', 
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      }
    },
    { 
      label: '📝 New Note', 
      click: () => createNewNote() 
    },
    ...pinnedNotesMenu,
    { type: 'separator' },
    { 
      label: '🔄 Sync Now', 
      click: async () => {
        if (!vaultManager) return;
        const allNotes = vaultManager.getAllNotes();
        console.log(`[TRAY] Manual sync triggered for ${allNotes.length} notes`);
        const result = await dropboxSync.syncAllNotes(allNotes);
        console.log(`[TRAY] Sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped`);
      }
    },
    { 
      label: '⚙️ Settings', 
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        mainWindow?.webContents.send('open-settings');
      }
    },
    { type: 'separator' },
    { 
      label: '❌ Quit StickyVault', 
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      }
    },
  ]);
  
  tray.setContextMenu(contextMenu);
}

/**
 * Create a new empty note
 */
async function createNewNote(): Promise<void> {
  if (!vaultManager) return;
  
  const note = await vaultManager.createNote({
    title: 'New Note',
    content: '',
    pinned: false,
  });
  
  openNoteWindow(note);
}

/**
 * Initialize the vault manager
 */
async function initializeVault(vaultPath: string): Promise<void> {
  if (vaultManager) {
    await vaultManager.destroy();
  }
  
  vaultManager = createVaultManager({ vaultPath, watchFiles: true });
  await vaultManager.initialize();
  
  // Subscribe to vault events and forward to renderer
  vaultManager.on((event: VaultEvent) => {
    console.log('[VAULT EVENT]', event.type, event.type === 'note-deleted' ? event.noteId : event.note?.id);
    mainWindow?.webContents.send('vault-event', event);
    
    // Update open note windows
    if (event.type === 'note-created' || event.type === 'note-updated') {
      const noteWindow = noteWindows.get(event.note.id);
      noteWindow?.webContents.send('note-updated', event.note);
      
      // Auto-upload to Dropbox on note update/creation
      console.log('[SYNC CHECK] isConnected:', dropboxSync.isConnected());
      if (dropboxSync.isConnected()) {
        console.log('[SYNC] Triggering uploadNote for:', event.note.id);
        dropboxSync.uploadNote(event.note).catch(err => console.error('[SYNC] Upload failed:', err));
      }
    } else if (event.type === 'note-deleted') {
      const noteWindow = noteWindows.get(event.noteId);
      noteWindow?.close();
      
      // Delete from Dropbox
      if (dropboxSync.isConnected()) {
        dropboxSync.deleteNote(event.noteId).catch(console.error);
      }
    }
  });
  
  store.set('vaultPath', vaultPath);
  
  // Initialize Dropbox sync with vault path
  dropboxSync.setVaultPath(vaultPath);
  
  // Forward sync status to renderer
  dropboxSync.onStatusChanged((status) => {
    mainWindow?.webContents.send('dropbox-status', status);
  });
  
  // Set up callback for auto-sync to get notes
  dropboxSync.setGetNotesCallback(() => vaultManager!.getAllNotes());
  
  // Start auto-sync if connected (every 1 minute)
  if (dropboxSync.isConnected()) {
    dropboxSync.startAutoSync(1 * 60 * 1000); // 1 minute
    
    // Sync ALL existing notes on startup!
    const allNotes = vaultManager.getAllNotes();
    console.log(`[STARTUP SYNC] Syncing ${allNotes.length} existing notes...`);
    dropboxSync.syncAllNotes(allNotes).then(result => {
      console.log(`[STARTUP SYNC] Done: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`);
    }).catch(err => {
      console.error('[STARTUP SYNC] Failed:', err);
    });
  }
}

/**
 * Restore previously open notes and auto-open pinned notes
 */
async function restoreOpenNotes(): Promise<void> {
  if (!vaultManager) return;
  
  const autoOpenPinned = store.get('autoOpenPinned') as boolean;
  const openNotes = store.get('openNotes') as string[];
  const allNotes = vaultManager.getAllNotes();
  
  // First, restore previously open notes
  for (const noteId of openNotes) {
    const note = vaultManager.getNote(noteId);
    if (note) {
      createNoteWindow(note);
    }
  }
  
  // Then, auto-open all pinned notes if enabled
  if (autoOpenPinned) {
    for (const note of allNotes) {
      if (note.pinned && !noteWindows.has(note.id)) {
        createNoteWindow(note);
      }
    }
  }
}

// IPC Handlers
function setupIpcHandlers(): void {
  // Vault operations
  ipcMain.handle('vault:initialize', async (_, vaultPath: string) => {
    await initializeVault(vaultPath);
    return true;
  });
  
  ipcMain.handle('vault:getPath', () => store.get('vaultPath'));
  
  ipcMain.handle('vault:getAllNotes', () => {
    return vaultManager?.getAllNotes() ?? [];
  });
  
  ipcMain.handle('vault:getNote', (_, noteId: string) => {
    return vaultManager?.getNote(noteId) ?? null;
  });
  
  ipcMain.handle('vault:getIndex', () => {
    return vaultManager?.getIndex() ?? null;
  });
  
  ipcMain.handle('vault:createNote', async (_, partial) => {
    return vaultManager?.createNote(partial) ?? null;
  });
  
  ipcMain.handle('vault:updateNote', async (_, noteId: string, updates) => {
    return vaultManager?.updateNote(noteId, updates) ?? null;
  });
  
  ipcMain.handle('vault:deleteNote', async (_, noteId: string) => {
    return vaultManager?.deleteNote(noteId) ?? false;
  });
  
  ipcMain.handle('vault:toggleCheckbox', async (_, noteId: string, lineIndex: number) => {
    return vaultManager?.toggleCheckbox(noteId, lineIndex) ?? null;
  });
  
  ipcMain.handle('vault:togglePinned', async (_, noteId: string) => {
    return vaultManager?.togglePinned(noteId) ?? null;
  });
  
  // Window operations
  ipcMain.handle('window:openNote', (_, note: Note) => {
    openNoteWindow(note);
  });
  
  ipcMain.handle('window:closeNote', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });
  
  ipcMain.handle('window:toggleAlwaysOnTop', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      const newValue = !win.isAlwaysOnTop();
      win.setAlwaysOnTop(newValue);
      return newValue;
    }
    return false;
  });
  
  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });
  
  // Settings
  ipcMain.handle('settings:get', (_, key: string) => {
    return store.get(key);
  });
  
  ipcMain.handle('settings:set', (_, key: string, value: unknown) => {
    store.set(key, value);
  });
  
  // Dropbox sync handlers
  ipcMain.handle('dropbox:getStatus', () => {
    return {
      status: dropboxSync.getStatus(),
      isConnected: dropboxSync.isConnected(),
      appKey: dropboxSync.getAppKey(),
    };
  });
  
  ipcMain.handle('dropbox:setAppKey', (_, appKey: string) => {
    dropboxSync.setAppKey(appKey);
  });
  
  ipcMain.handle('dropbox:setAccessToken', (_, token: string) => {
    dropboxSync.setAccessToken(token);
  });
  
  ipcMain.handle('dropbox:startOAuth', async () => {
    return dropboxSync.startOAuth();
  });
  
  ipcMain.handle('dropbox:completeOAuth', async (_, code: string) => {
    return dropboxSync.completeOAuth(code);
  });
  
  ipcMain.handle('dropbox:disconnect', () => {
    dropboxSync.disconnect();
  });
  
  ipcMain.handle('dropbox:sync', async () => {
    if (!vaultManager) {
      return { uploaded: 0, skipped: 0, errors: 1 };
    }
    const allNotes = vaultManager.getAllNotes();
    return dropboxSync.syncAllNotes(allNotes);
  });
  
  ipcMain.handle('dropbox:testConnection', async () => {
    return dropboxSync.testConnection();
  });
}

// App lifecycle
app.whenReady().then(async () => {
  setupIpcHandlers();
  createMainWindow();
  createTray();
  
  // Get default vault path - use app's userData directory
  const defaultVaultPath = path.join(app.getPath('userData'), 'notes');
  
  // Always initialize vault at default location
  try {
    await initializeVault(defaultVaultPath);
    await restoreOpenNotes();
  } catch (error) {
    console.error('Failed to initialize vault:', error);
  }
  
  // Handle deep link URL from process.argv (Linux support)
  // On Linux, when app is launched via URL, the URL is passed as an argument
  const deepLinkUrl = process.argv.find(arg => arg.startsWith('stickyvault://'));
  if (deepLinkUrl) {
    console.log('[Deep Link] Found URL in argv:', deepLinkUrl);
    // Delay handling to ensure app is fully ready
    setTimeout(() => handleOpenUrl(deepLinkUrl), 500);
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });


});

// Handle deep links (for OAuth)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('stickyvault', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('stickyvault');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    
    // Handle deep link on Windows
    const url = commandLine.find(arg => arg.startsWith('stickyvault://'));
    if (url) {
      handleOpenUrl(url);
    }
  });

  // Handle deep link on macOS
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleOpenUrl(url);
  });
}

function handleOpenUrl(url: string) {
  console.log('Received URL:', url);
  
  if (url.startsWith('stickyvault://oauth/callback')) {
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get('code');
    
    if (code) {
      dropboxSync.completeOAuth(code)
        .then(success => {
          if (success) {
            mainWindow?.webContents.send('dropbox-connected');
            if (mainWindow && !mainWindow.isVisible()) {
              mainWindow.show();
            }
          }
        })
        .catch(console.error);
    }
  }
}

app.on('window-all-closed', () => {
  // Don't quit if tray is active
  if (process.platform !== 'darwin' && !tray) {
    app.quit();
  }
});

app.on('before-quit', () => {
  (app as any).isQuitting = true;
});

