import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  TextInput,
  Modal,
  SafeAreaView,
  StatusBar,
  AppState,
  NativeModules,
  Platform,
  Alert,
  RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

const { WidgetModule } = NativeModules;

// Note type (matches core types)
interface Note {
  id: string;
  title: string;
  content: string;
  created: string;
  updated: string;
  pinned: boolean; // This refers to pinning inside the app list
  color: string;
  tags: string[];
  widgetId?: number; // Valid ID means currently on home screen
}

// Storage keys
const NOTES_KEY = '@stickyvault_notes';

// Note colors
const NOTE_COLORS = ['#FFE066', '#A8E6CF', '#88D8F5', '#FFB3BA', '#E0BBE4', '#FFDAC1'];

import { DropboxService } from './utils/DropboxService';


export default function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Editor State
  const [showEditor, setShowEditor] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editColor, setEditColor] = useState('#FFE066');
  
  // Search State
  const [searchQuery, setSearchQuery] = useState('');

  // Dropbox State
  const [showSettings, setShowSettings] = useState(false);
  const [dropboxToken, setDropboxToken] = useState('');
  const [syncStatus, setSyncStatus] = useState<string>('Idle');
  const [isSyncing, setIsSyncing] = useState(false);
  const [dropboxAppKey, setDropboxAppKey] = useState('');
  const [manualToken, setManualToken] = useState('');

  // Selection State (for delete)
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  
  // Filter State
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);


  // Load notes from storage and sync with widget/dropbox
  const loadNotes = useCallback(async () => {
    try {
      // 1. Load local app notes
      const stored = await AsyncStorage.getItem(NOTES_KEY);
      let localNotes: Note[] = stored ? JSON.parse(stored) : [];

      // 2. Load widget notes if on Android
      if (Platform.OS === 'android' && WidgetModule) {
        try {
          const widgetNotes = await WidgetModule.getAllWidgetNotes();
          let hasChanges = false;
          
          widgetNotes.forEach((wn: any) => {
             // Try to find existing note by noteId first (if widget was created from existing note)
             let existing = wn.noteId ? localNotes.find(n => n.id === wn.noteId) : null;
             
             // If not found, try matching by widgetId or id pattern
             if (!existing) {
               existing = localNotes.find(n => n.widgetId === wn.widgetId);
             }
             if (!existing) {
               existing = localNotes.find(n => n.id === `widget-${wn.widgetId}`);
             }

             if (existing) {
                 // Update existing note with widget data
                 if (existing.title !== wn.title || existing.content !== wn.content || existing.color !== wn.color || !existing.widgetId) {
                     existing.title = wn.title;
                     existing.content = wn.content;
                     existing.color = wn.color;
                     existing.updated = new Date().toISOString(); 
                     existing.widgetId = wn.widgetId;
                     hasChanges = true;
                 }
             } else {
                 // Create new note only if not found
                 const newNote = {
                    id: wn.noteId || Crypto.randomUUID(),  // Use UUID for new notes
                    title: wn.title,
                    content: wn.content,
                    color: wn.color,
                    created: new Date().toISOString(),
                    updated: new Date().toISOString(),
                    pinned: true,
                    tags: ['widget'],
                    widgetId: wn.widgetId
                 };
                 localNotes.push(newNote);
                 hasChanges = true;
             }
          });
          
          if (hasChanges) {
              await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(localNotes));
          }
        } catch (e) {
          console.error("Failed to load widget notes", e);
        }
      }

      setNotes([...localNotes]); // Force refresh
    } catch (error) {
      console.error('Failed to load notes:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load saved notes and dropbox settings on startup
  useEffect(() => {
    loadNotes();
    const initDropbox = async () => {
        const dbx = DropboxService.getInstance();
        const hasToken = await dbx.init();
        const clientId = await dbx.getClientId();
        if (clientId) setDropboxAppKey(clientId);
        
        if (hasToken) {
            const token = await dbx.getAccessToken(); // This might trigger refresh check if detailed
            setDropboxToken(token ? 'Logged In' : '');
            if (token) setSyncStatus('Connected');
        }
    };
    initDropbox();
  }, []);

  const connectToDropbox = async () => {
      // Save App Key first if provided
      if (dropboxAppKey) {
          if (dropboxAppKey.length > 30) {
              Alert.alert('Invalid App Key', 'The App Key is too long. Please use the "App key" (~15 chars), not the Access Token.');
              return;
          }
          await DropboxService.getInstance().setClientId(dropboxAppKey.trim());
      } else {
          Alert.alert('Missing App Key', 'Please enter your Dropbox App Key.');
          return;
      }

      setSyncStatus('Connecting...');
      const success = await DropboxService.getInstance().startAuth();
      if (success) {
          setDropboxToken('Logged In');
          setSyncStatus('Connected');
          // Auto sync after connect
          syncWithDropbox();
      } else {
          setSyncStatus('Connection Failed / Cancelled');
      }
  };

  const disconnectDropbox = async () => {
      await DropboxService.getInstance().disconnect();
      setDropboxToken('');
      setSyncStatus('Disconnected');
  };

  // Sync with Dropbox
  const syncWithDropbox = async () => {
      setIsSyncing(true);
      setSyncStatus('Syncing...');
      
      try {
          const dbx = DropboxService.getInstance();
          if (!dbx.isAuthenticated()) {
              setSyncStatus('Not Authenticated');
              setIsSyncing(false);
              return;
          }

          const result = await dbx.syncWithRemote(notes);
          if (result.error) {
              setSyncStatus(`Error: ${result.error}`);
          } else {
              setSyncStatus(`Synced ${result.syncedCount} notes`);
              if (result.syncedCount > 0 || result.notes.length !== notes.length) {
                  setNotes(result.notes);
                  await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(result.notes));
              }
          }
      } catch (e) {
          setSyncStatus('Sync Failed');
          console.error(e);
      } finally {
          setIsSyncing(false);
      }
  };

  // Listen for AppState changes to auto-sync when returning to app
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        loadNotes();
        // Optional: Auto-sync on resume if connected
        // syncWithDropbox(); 
      }
    });

    return () => {
      subscription.remove();
    };
  }, [loadNotes]);

  // Initial load
  useEffect(() => {
    loadNotes();
  }, [loadNotes]);

  // Save notes to storage
  const saveNotes = useCallback(async (updatedNotes: Note[]) => {
    try {
      await AsyncStorage.setItem(NOTES_KEY, JSON.stringify(updatedNotes));
      setNotes(updatedNotes);
      // Auto-sync in background logic could go here
    } catch (error) {
      console.error('Failed to save notes:', error);
    }
  }, []);

  // Create new note
  const createNote = () => {
    setEditingNote(null);
    setEditTitle('');
    setEditContent('');
    setEditColor(NOTE_COLORS[Math.floor(Math.random() * NOTE_COLORS.length)]);
    setShowEditor(true);
  };

  // Edit existing note
  const openNote = (note: Note) => {
    setEditingNote(note);
    setEditTitle(note.title);
    setEditContent(note.content);
    setEditColor(note.color);
    setShowEditor(true);
  };

  // Save note updates (and update widget if linked)
  const saveNote = async () => {
    const now = new Date().toISOString();
    let updatedNotes = [];

    if (editingNote) {
      // Check if we need to update a widget
      if (editingNote.widgetId && Platform.OS === 'android' && WidgetModule) {
          try {
              await WidgetModule.updateWidget(
                  editingNote.widgetId, 
                  editTitle, 
                  editContent, 
                  editColor
              );
          } catch(e) {
              console.warn("Failed to update remote widget", e);
          }
      }

      // Update existing note
      updatedNotes = notes.map(n =>
        n.id === editingNote.id
          ? { ...n, title: editTitle, content: editContent, color: editColor, updated: now, widgetId: editingNote.widgetId }
          : n
      );
    } else {
      // Create new note
      const newNote: Note = {
        id: Crypto.randomUUID(),  // Use UUID for new notes
        title: editTitle || 'Untitled Note',
        content: editContent,
        created: now,
        updated: now,
        pinned: false,
        color: editColor,
        tags: [],
      };
      updatedNotes = [newNote, ...notes];
    }
    
    await saveNotes(updatedNotes);
    setShowEditor(false);
    
    // Note: Sync will happen automatically via auto-sync interval
    // No immediate sync to avoid rapid uploads
  };

  // Delete note (called after confirmation)
  const deleteNote = async (noteId: string) => {
    const updatedNotes = notes.filter(n => n.id !== noteId);
    await saveNotes(updatedNotes);
    setShowEditor(false);
    
    // Sync deletion with Dropbox
    if (DropboxService.getInstance().isAuthenticated()) {
      // Delete from Dropbox as well
      await DropboxService.getInstance().deleteNote(noteId);
    }
  };

  // Toggle pin
  const togglePin = async (noteId: string) => {
    const updatedNotes = notes.map(n =>
      n.id === noteId ? { ...n, pinned: !n.pinned } : n
    );
    await saveNotes(updatedNotes);
  };

  // Selection mode functions
  const toggleSelection = (noteId: string) => {
    const newSelection = new Set(selectedNotes);
    if (newSelection.has(noteId)) {
      newSelection.delete(noteId);
    } else {
      newSelection.add(noteId);
    }
    setSelectedNotes(newSelection);
    
    // Exit selection mode if no notes selected
    if (newSelection.size === 0) {
      setIsSelectionMode(false);
    }
  };

  const selectAll = () => {
    const allIds = new Set(filteredNotes.map(n => n.id));
    setSelectedNotes(allIds);
  };

  const cancelSelection = () => {
    setIsSelectionMode(false);
    setSelectedNotes(new Set());
  };

  const deleteSelected = async () => {
    if (selectedNotes.size === 0) return;

    Alert.alert(
      'Delete Notes',
      `Delete ${selectedNotes.size} note${selectedNotes.size > 1 ? 's' : ''}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updatedNotes = notes.filter(n => !selectedNotes.has(n.id));
            await saveNotes(updatedNotes);
            cancelSelection();
          },
        },
      ]
    );
  };

  // Dropbox Settings Save
  const saveDropboxSettings = async () => {
      if (dropboxToken) {
          await DropboxService.getInstance().setAccessToken(dropboxToken);
          setSyncStatus('Token Saved');
      } else {
          await DropboxService.getInstance().disconnect();
          setSyncStatus('Disconnected');
      }
  };

  // Confirm and delete a single note
  const confirmDelete = (noteId: string) => {
    Alert.alert(
      'Delete Note',
      'Are you sure you want to delete this note?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteNote(noteId) }
      ]
    );
  };

  // Filter notes by search and pinned filter
  const filteredNotes = notes
    .filter(note => {
      // Apply pinned filter first
      if (showPinnedOnly && !note.pinned) return false;
      // Then apply search filter
      return (
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase())
      );
    })
    .sort((a, b) => {
      // Sort priority: App Pinned > Widget Pinned > Date
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updated).getTime() - new Date(a.updated).getTime();
    });

  // Render note card with modern design
  const renderNoteCard = ({ item }: { item: Note }) => {
    const isWidget = !!item.widgetId;

    const showOptionsMenu = () => {
      const options: any[] = [
        {
          text: item.pinned ? 'Unpin Note' : 'Pin Note',
          onPress: () => togglePin(item.id)
        }
      ];

      // Add widget option
      if (isWidget) {
        options.push({
          text: 'Widget Synced ✓',
          style: 'default'
        });
      } else if (Platform.OS === 'android' && WidgetModule) {
        options.push({
          text: 'Add to Home Screen',
          onPress: async () => {
            try {
              await WidgetModule.requestPinWidget(item.id, item.title, item.content, item.color);
              setTimeout(loadNotes, 1000);
            } catch (e) {
              Alert.alert('Error', 'Could not create widget');
            }
          }
        });
      }

      options.push(
        {
          text: 'Delete Note',
          style: 'destructive',
          onPress: () => confirmDelete(item.id)
        },
        { text: 'Cancel', style: 'cancel' }
      );

      Alert.alert('Note Options', undefined, options);
    };

    return (
      <TouchableOpacity
        style={[styles.noteCard, { backgroundColor: item.color }]}
        onPress={() => openNote(item)}
        onLongPress={showOptionsMenu}
        activeOpacity={0.7}
      >
        {/* Pin & Widget Indicators */}
        <View style={styles.noteIndicators}>
          {item.pinned && <Text style={styles.pinIcon}>📌</Text>}
          {isWidget && <Text style={styles.widgetIcon}>📱</Text>}
        </View>

        {/* Note Content */}
        <Text style={styles.noteTitle} numberOfLines={2}>{item.title || 'Untitled'}</Text>
        <Text style={styles.noteContent} numberOfLines={4}>{item.content}</Text>
        
        {/* Note Footer */}
        <View style={styles.noteFooter}>
          <Text style={styles.noteDate}>
            {new Date(item.updated).toLocaleDateString()}
          </Text>
          {item.tags && item.tags.length > 0 && (
            <View style={styles.tagContainer}>
              <Text style={styles.tag} numberOfLines={1}>
                {item.tags[0]}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };



  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>Loading StickyVault...</Text>
      </View>
    );
  }

  return (
    <LinearGradient
      colors={['#0f0c29', '#302b63', '#24243e']}
      style={styles.gradientContainer}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
        
        {/* Glass Header */}
        <View style={styles.header}>
        <Text style={styles.headerTitle}>📝 StickyVault</Text>
        <View style={styles.headerButtons}>
            <TouchableOpacity style={styles.iconButton} onPress={() => setShowSettings(true)}>
                <Text style={{fontSize: 20}}>⚙️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addButton} onPress={createNote}>
                <Text style={styles.addButtonText}>＋</Text>
            </TouchableOpacity>
        </View>
      </View>
      
      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search notes..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>
      
      {/* Filter Tabs - Like Desktop */}
      <View style={styles.filterTabs}>
        <TouchableOpacity 
          style={[styles.filterTab, !showPinnedOnly && styles.filterTabActive]}
          onPress={() => setShowPinnedOnly(false)}
        >
          <Text style={[styles.filterTabText, !showPinnedOnly && styles.filterTabTextActive]}>
            All ({notes.length})
          </Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.filterTab, showPinnedOnly && styles.filterTabActive]}
          onPress={() => setShowPinnedOnly(true)}
        >
          <Text style={[styles.filterTabText, showPinnedOnly && styles.filterTabTextActive]}>
            📌 Pinned ({notes.filter(n => n.pinned).length})
          </Text>
        </TouchableOpacity>
      </View>
      
      {/* Notes Grid */}
      {filteredNotes.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📝</Text>
          <Text style={styles.emptyTitle}>No notes yet</Text>
          <Text style={styles.emptyText}>Tap + to create your first note</Text>
        </View>
      ) : (
        <FlatList
          data={filteredNotes}
          renderItem={renderNoteCard}
          keyExtractor={item => item.id}
          numColumns={2}
          contentContainerStyle={styles.notesList}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                loadNotes();
              }}
              tintColor="#FFE066"
            />
          }
        />
      )}
      
      {/* Editor Modal */}
      <Modal
        visible={showEditor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEditor(false)}
      >
        <SafeAreaView style={[styles.editorContainer, { backgroundColor: editColor }]}>
          {/* Editor Header */}
          <View style={styles.editorHeader}>
            <TouchableOpacity onPress={() => setShowEditor(false)}>
              <Text style={styles.editorButton}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={saveNote}>
              <Text style={[styles.editorButton, styles.saveButton]}>Save</Text>
            </TouchableOpacity>
          </View>
          
          {/* Color Picker */}
          <View style={styles.colorPicker}>
            {NOTE_COLORS.map(color => (
              <TouchableOpacity
                key={color}
                style={[
                  styles.colorOption,
                  { backgroundColor: color },
                  editColor === color && styles.colorSelected,
                ]}
                onPress={() => setEditColor(color)}
              />
            ))}
          </View>
          
          {/* Title Input */}
          <TextInput
            style={styles.titleInput}
            placeholder="Note title..."
            placeholderTextColor="#666"
            value={editTitle}
            onChangeText={setEditTitle}
          />
          
          {/* Content Input */}
          <TextInput
            style={styles.contentInput}
            placeholder="Start typing..."
            placeholderTextColor="#666"
            value={editContent}
            onChangeText={setEditContent}
            multiline
            textAlignVertical="top"
          />
          
          {/* Delete Button (only for existing notes) */}
          {editingNote && (
            <TouchableOpacity
              style={styles.deleteButton}
              onPress={() => deleteNote(editingNote.id)}
            >
              <Text style={styles.deleteButtonText}>🗑️ Delete Note</Text>
            </TouchableOpacity>
          )}
        </SafeAreaView>
      </Modal>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
            <View style={styles.settingsModal}>
                <Text style={styles.settingsTitle}>Settings</Text>
                
                <Text style={styles.settingsLabel}>Dropbox Connection:</Text>
                
                <Text style={styles.settingsSubLabel}>App Key</Text>
                <TextInput 
                    style={styles.settingsInput}
                    value={dropboxAppKey}
                    onChangeText={setDropboxAppKey}
                    placeholder="Enter Dropbox App Key"
                    placeholderTextColor="#999"
                    editable={!dropboxToken} // Disable if connected (optional, or allow change to switch accounts)
                />

                {dropboxToken ? (
                    <View style={{marginBottom: 15, marginTop: 10}}>
                        <Text style={[styles.settingsLabel, {color: '#A8E6CF'}]}>✓ Connected</Text>
                        <TouchableOpacity style={[styles.saveSettingsButton, {backgroundColor: '#ff6b6b'}]} onPress={disconnectDropbox}>
                            <Text style={styles.saveSettingsText}>Disconnect</Text>
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={{marginTop: 10}}>
                        {/* OAuth Button */}
                        <TouchableOpacity style={[styles.saveSettingsButton, {backgroundColor: '#0061FE'}]} onPress={connectToDropbox}>
                            <Text style={styles.saveSettingsText}>Connect with Dropbox (OAuth)</Text>
                        </TouchableOpacity>
                        
                        {/* OR Divider */}
                        <View style={{flexDirection: 'row', alignItems: 'center', marginVertical: 15}}>
                            <View style={{flex: 1, height: 1, backgroundColor: '#555'}} />
                            <Text style={{color: '#888', marginHorizontal: 10}}>OR</Text>
                            <View style={{flex: 1, height: 1, backgroundColor: '#555'}} />
                        </View>
                        
                        {/* Manual Token Entry */}
                        <Text style={styles.settingsSubLabel}>Access Token (from Dropbox Console)</Text>
                        <TextInput 
                            style={[styles.settingsInput, {height: 80, textAlignVertical: 'top'}]}
                            value={manualToken}
                            onChangeText={setManualToken}
                            placeholder="Paste your Generated Access Token here"
                            placeholderTextColor="#999"
                            multiline
                        />
                        <TouchableOpacity 
                            style={[styles.saveSettingsButton, {backgroundColor: '#4CAF50', marginTop: 8}]} 
                            onPress={async () => {
                                if (manualToken && manualToken.length > 50) {
                                    await DropboxService.getInstance().setAccessToken(manualToken.trim());
                                    setDropboxToken('Logged In (Manual)');
                                    setSyncStatus('Connected (Manual Token)');
                                    setManualToken('');
                                    syncWithDropbox();
                                } else {
                                    Alert.alert('Invalid Token', 'Please paste the full access token from the Dropbox Console.');
                                }
                            }}
                        >
                            <Text style={styles.saveSettingsText}>Save Token</Text>
                        </TouchableOpacity>
                    </View>
                )}

                <View style={styles.divider} />

                <Text style={styles.statusText}>Status: {syncStatus}</Text>

                <TouchableOpacity 
                    style={[styles.syncButton, isSyncing && {opacity: 0.7}]} 
                    onPress={syncWithDropbox}
                    disabled={isSyncing}
                >
                    <Text style={styles.syncButtonText}>{isSyncing ? 'Syncing...' : 'Sync Now'}</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.closeButton} onPress={() => setShowSettings(false)}>
                    <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
            </View>
        </View>
      </Modal>
    </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradientContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: 'transparent', // Let gradient show through
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f0c29',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#FFE066',
    fontSize: 18,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
    // Glass effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#FFE066',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFE066',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#FFE066',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  addButtonText: {
    color: '#0f0c29',
    fontSize: 26,
    fontWeight: 'bold',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    // Glassmorphism effect
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 2,
  },
  filterTabs: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterTabActive: {
    backgroundColor: 'rgba(255, 224, 102, 0.15)',
    borderColor: '#FFE066',
  },
  filterTabText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color: '#FFE066',
    fontWeight: '600',
  },
  notesList: {
    padding: 12,
  },
  noteCard: {
    flex: 1,
    margin: 8,
    padding: 16,
    borderRadius: 20,
    minHeight: 180,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    // Enhanced shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
    // Inner glow effect via opacity
    overflow: 'hidden',
  },
  noteIndicators: {
    flexDirection: 'row',
    position: 'absolute',
    top: 12,
    right: 12,
    gap: 6,
  },
  pinIcon: {
    fontSize: 16,
  },
  widgetIcon: {
    fontSize: 16,
  },
  noteTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a2e',
    marginBottom: 8,
    marginTop: 4,
    letterSpacing: 0.3,
  },
  noteContent: {
    fontSize: 15,
    color: '#333',
    flex: 1,
    lineHeight: 22,
    marginBottom: 8,
  },
  noteFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.08)',
  },
  noteDate: {
    fontSize: 12,
    color: '#666',
    fontWeight: '500',
  },
  tagContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  tag: {
    fontSize: 11,
    color: '#555',
    fontWeight: '600',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 28,
    // Add subtle animation effect via shadow
    textShadowColor: 'rgba(255, 224, 102, 0.3)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 12,
  },
  emptyTitle: {
    color: '#FFE066',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 14,
    textShadowColor: 'rgba(255, 224, 102, 0.2)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    letterSpacing: 0.5,
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 26,
    maxWidth: 260,
  },
  editorContainer: {
    flex: 1,
    padding: 20,
  },
  editorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  editorButton: {
    fontSize: 17,
    color: '#333',
  },
  saveButton: {
    fontWeight: '600',
    color: '#FFE066',
  },
  colorPicker: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 20,
    gap: 12,
  },
  colorOption: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  colorSelected: {
    borderColor: '#1a1a2e',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  titleInput: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#1a1a2e',
    marginBottom: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0,0,0,0.1)',
  },
  contentInput: {
    flex: 1,
    fontSize: 17,
    color: '#1a1a2e',
    lineHeight: 26,
    textAlignVertical: 'top',
  },
  deleteButton: {
    backgroundColor: 'rgba(255,0,0,0.1)',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,0,0,0.2)',
  },
  deleteButtonText: {
    color: '#c00',
    fontSize: 17,
    fontWeight: '600',
  },
  iconButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsModal: {
    width: '88%',
    backgroundColor: '#1a1a2e',
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 224, 102, 0.3)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },
  settingsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#FFE066',
    marginBottom: 24,
    textAlign: 'center',
  },
  settingsLabel: {
    color: '#ddd',
    fontSize: 16,
    marginBottom: 8,
    fontWeight: '600',
  },
  settingsSubLabel: {
    color: '#bbb',
    marginBottom: 5,
    fontSize: 14,
  },
  settingsInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 10,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  saveSettingsButton: {
    backgroundColor: '#FFE066',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: '#FFE066',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  saveSettingsText: {
    color: '#0f0c29',
    fontWeight: 'bold',
    fontSize: 17,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginVertical: 20,
  },
  statusText: {
    color: '#999',
    textAlign: 'center',
    marginBottom: 16,
    fontSize: 14,
  },
  syncButton: {
    backgroundColor: '#4CAF50',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  syncButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 17,
  },
  closeButton: {
    padding: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    color: '#888',
    fontSize: 16,
  },
});
