import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  PanResponder,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { scanLocalMusic, pickAndImportAudioFiles } from '@/services/localScannerService';
import { getAllTracks, deleteTrack as removeTrackFromDb } from '@/repositories/trackRepository';
import {
  createPlaylist,
  getAllPlaylists,
  deletePlaylist as removePlaylistFromDb,
  updatePlaylistCover,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
  getPlaylistsContainingTrack,
} from '@/lib/database';
import TrackItem from '@/components/TrackItem';
import ConfirmModal from '@/components/ConfirmModal';
import { Track, Playlist } from '@/types/music';
import { createStyles } from '@/styles/index.styles';

type LibraryTab = 'songs' | 'playlists';

export default function LibraryScreen() {
  const tracks = usePlayerStore((state) => state.tracks);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const reorderTracks = usePlayerStore((state) => state.reorderTracks);
  const removeTrackFromStore = usePlayerStore((state) => state.removeTrack);
  const playTrack = usePlayerStore((state) => state.playTrack);

  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);

  const styles = useMemo(() => createStyles(theme), [theme]);

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  // Tab State: 'songs' | 'playlists'
  const [activeTab, setActiveTab] = useState<LibraryTab>('songs');

  // Scanner & library states
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  // Playlists States
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [selectedPlaylistTracks, setSelectedPlaylistTracks] = useState<Track[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);

  // Create Playlist Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistCoverUri, setNewPlaylistCoverUri] = useState<string | null>(null);

  // Selected Playlist Cover Action Modal State
  const [showPlaylistCoverActionModal, setShowPlaylistCoverActionModal] = useState(false);

  // Add to Playlist Modal State
  const [trackToAddToPlaylist, setTrackToAddToPlaylist] = useState<Track | null>(null);
  const [assignedPlaylistIds, setAssignedPlaylistIds] = useState<string[]>([]);

  // Confirm / Alert Modal State
  const [confirmConfig, setConfirmConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon?: keyof typeof Ionicons.glyphMap;
    confirmText?: string;
    cancelText?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
  }>({
    visible: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const dragStartIndexRef = useRef<number | null>(null);
  const currentTargetRef = useRef<number | null>(null);
  const currentOrderRef = useRef<Track[]>([]);

  // Load playlists helper
  const loadPlaylists = useCallback(async () => {
    try {
      const stored = await getAllPlaylists();
      setPlaylists(stored);
    } catch (e) {
      console.warn('Failed to load playlists:', e);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const storedTracks = await getAllTracks();
        if (isMounted) {
          setTracks(storedTracks);
        }
      } catch (error) {
        console.warn('Failed to load tracks from DB:', error);
      }
      if (isMounted) {
        await loadPlaylists();
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [setTracks, loadPlaylists]);

  const handleScanMusic = async () => {
    if (isScanning || isImporting) return;
    setIsScanning(true);
    setScanMessage(null);

    try {
      const scanned = await scanLocalMusic();
      setTracks(scanned);
      setScanMessage(
        `Scan complete! ${scanned.length} track${scanned.length === 1 ? '' : 's'} imported.`
      );
    } catch (error: any) {
      if (error?.message === 'PERMISSION_RESTRICTED') {
        setConfirmConfig({
          visible: true,
          title: 'Storage Access Restricted',
          message:
            'Media library permission is restricted or running inside Expo Go. Would you like to select and import your audio files directly using Android file picker?',
          icon: 'folder-open-outline',
          confirmText: 'Import Files',
          cancelText: 'Cancel',
          isDestructive: false,
          onConfirm: () => {
            setConfirmConfig((prev) => ({ ...prev, visible: false }));
            handleImportAudio();
          },
        });
      } else {
        setConfirmConfig({
          visible: true,
          title: 'Scan Local Music',
          message: error?.message || 'Could not scan local music.',
          icon: 'alert-circle-outline',
          confirmText: 'OK',
          cancelText: '',
          isDestructive: false,
          onConfirm: () => setConfirmConfig((prev) => ({ ...prev, visible: false })),
        });
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleImportAudio = async () => {
    if (isImporting || isScanning) return;
    setIsImporting(true);
    setScanMessage(null);

    try {
      const imported = await pickAndImportAudioFiles();
      setTracks(imported);
      setScanMessage(
        `Import complete! ${imported.length} track${imported.length === 1 ? '' : 's'} available.`
      );
    } catch (error: any) {
      console.warn('Audio import failed:', error);
      setConfirmConfig({
        visible: true,
        title: 'Import Audio Files',
        message: error?.message || 'Could not import selected files.',
        icon: 'alert-circle-outline',
        confirmText: 'OK',
        cancelText: '',
        isDestructive: false,
        onConfirm: () => setConfirmConfig((prev) => ({ ...prev, visible: false })),
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteTrack = async (id: string) => {
    try {
      await removeTrackFromDb(id);
      await removeTrackFromStore(id);
      await loadPlaylists();
    } catch (error) {
      console.warn('Failed to delete track:', error);
    }
  };

  // Reordering PanResponder for songs list
  const getRowPanResponder = (index: number) => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 3,
      onPanResponderGrant: () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setDraggingIndex(index);
        dragStartIndexRef.current = index;
        currentTargetRef.current = index;
        currentOrderRef.current = [...tracks];
      },
      onPanResponderMove: (_, gesture) => {
        const startIndex = dragStartIndexRef.current;
        if (startIndex === null) return;
        const ROW_HEIGHT = 64;
        const offset = Math.round(gesture.dy / ROW_HEIGHT);
        const newTarget = Math.max(
          0,
          Math.min(currentOrderRef.current.length - 1, startIndex + offset)
        );

        if (newTarget !== currentTargetRef.current) {
          currentTargetRef.current = newTarget;
          Haptics.selectionAsync();
          const updated = [...currentOrderRef.current];
          const [moved] = updated.splice(startIndex, 1);
          updated.splice(newTarget, 0, moved);
          setTracks(updated);
        }
      },
      onPanResponderRelease: async () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setDraggingIndex(null);
        dragStartIndexRef.current = null;
        currentTargetRef.current = null;
        const currentTracks = usePlayerStore.getState().tracks;
        await reorderTracks(currentTracks);
      },
      onPanResponderTerminate: async () => {
        setDraggingIndex(null);
        dragStartIndexRef.current = null;
        currentTargetRef.current = null;
        const currentTracks = usePlayerStore.getState().tracks;
        await reorderTracks(currentTracks);
      },
    });
  };

  const handleRowLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsReordering(true);
  };

  // -------------------------------------------------------------
  // Playlist Handlers
  // -------------------------------------------------------------

  const handleOpenPlaylist = async (playlist: Playlist) => {
    setSelectedPlaylist(playlist);
    setIsLoadingPlaylistTracks(true);
    try {
      const pTracks = await getPlaylistTracks(playlist.id);
      setSelectedPlaylistTracks(pTracks);
    } catch (e) {
      console.warn('Failed to load playlist tracks:', e);
    } finally {
      setIsLoadingPlaylistTracks(false);
    }
  };

  const handlePlayPlaylist = async (playlist: Playlist) => {
    try {
      const pTracks = await getPlaylistTracks(playlist.id);
      if (pTracks.length > 0) {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        await playTrack(pTracks[0], pTracks);
      } else {
        handleOpenPlaylist(playlist);
      }
    } catch (e) {
      console.warn('Failed to play playlist:', e);
    }
  };

  const handlePlayAllInSelectedPlaylist = async () => {
    if (selectedPlaylistTracks.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await playTrack(selectedPlaylistTracks[0], selectedPlaylistTracks);
    }
  };

  const handleRemoveTrackFromCurrentPlaylist = async (trackId: string) => {
    if (!selectedPlaylist) return;
    try {
      await removeTrackFromPlaylist(selectedPlaylist.id, trackId);
      const updated = selectedPlaylistTracks.filter((t) => t.id !== trackId);
      setSelectedPlaylistTracks(updated);
      await loadPlaylists();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {
      console.warn('Failed to remove track from playlist:', e);
    }
  };

  const handleDeletePlaylistConfirm = (playlist: Playlist) => {
    setConfirmConfig({
      visible: true,
      title: 'Delete Playlist',
      message: `Are you sure you want to delete "${playlist.name}"? Songs will remain in your offline library.`,
      icon: 'trash-outline',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmConfig((prev) => ({ ...prev, visible: false }));
        try {
          await removePlaylistFromDb(playlist.id);
          if (selectedPlaylist?.id === playlist.id) {
            setSelectedPlaylist(null);
            setSelectedPlaylistTracks([]);
          }
          await loadPlaylists();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          console.warn('Failed to delete playlist:', e);
        }
      },
    });
  };

  const handlePickPlaylistCover = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const pickedUri = result.assets[0].uri;
        const docDir = FileSystem.documentDirectory;
        if (docDir) {
          const artDir = `${docDir}jstream_artwork/`;
          const dirInfo = await FileSystem.getInfoAsync(artDir);
          if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(artDir, { intermediates: true });
          }
          const targetUri = `${artDir}playlist_cover_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: pickedUri, to: targetUri });
          setNewPlaylistCoverUri(targetUri);
        } else {
          setNewPlaylistCoverUri(pickedUri);
        }
      }
    } catch (e) {
      console.warn('Failed to pick playlist cover:', e);
    }
  };

  const handleCreatePlaylist = async () => {
    const cleanName = newPlaylistName.trim();
    if (!cleanName) return;

    try {
      await createPlaylist(cleanName, newPlaylistCoverUri);
      await loadPlaylists();
      setNewPlaylistName('');
      setNewPlaylistCoverUri(null);
      setShowCreateModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('Failed to create playlist:', e);
    }
  };

  const handleChangeSelectedPlaylistCover = async () => {
    if (!selectedPlaylist) return;
    setShowPlaylistCoverActionModal(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const pickedUri = result.assets[0].uri;
        const docDir = FileSystem.documentDirectory;
        if (docDir) {
          const artDir = `${docDir}jstream_artwork/`;
          const dirInfo = await FileSystem.getInfoAsync(artDir);
          if (!dirInfo.exists) {
            await FileSystem.makeDirectoryAsync(artDir, { intermediates: true });
          }
          const targetUri = `${artDir}playlist_cover_${selectedPlaylist.id}_${Date.now()}.jpg`;
          await FileSystem.copyAsync({ from: pickedUri, to: targetUri });

          await updatePlaylistCover(selectedPlaylist.id, targetUri);
          setSelectedPlaylist((prev) => (prev ? { ...prev, cover_uri: targetUri } : null));
          await loadPlaylists();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } catch (e) {
      console.warn('Failed to update playlist cover:', e);
    }
  };

  const handleRemoveSelectedPlaylistCover = async () => {
    if (!selectedPlaylist) return;
    setShowPlaylistCoverActionModal(false);
    try {
      if (
        selectedPlaylist.cover_uri &&
        selectedPlaylist.cover_uri.startsWith('file://')
      ) {
        try {
          await FileSystem.deleteAsync(selectedPlaylist.cover_uri, { idempotent: true });
        } catch {
          // non-fatal
        }
      }
      await updatePlaylistCover(selectedPlaylist.id, null);
      setSelectedPlaylist((prev) => (prev ? { ...prev, cover_uri: null } : null));
      await loadPlaylists();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('Failed to remove playlist cover:', e);
    }
  };

  // -------------------------------------------------------------
  // Add to Playlist Modal Handlers
  // -------------------------------------------------------------

  const handleOpenAddToPlaylist = async (track: Track) => {
    setTrackToAddToPlaylist(track);
    try {
      const containedIds = await getPlaylistsContainingTrack(track.id);
      setAssignedPlaylistIds(containedIds);
    } catch (e) {
      console.warn('Failed to get playlists for track:', e);
    }
  };

  const handleToggleTrackInPlaylist = async (playlistId: string) => {
    if (!trackToAddToPlaylist) return;

    const isAssigned = assignedPlaylistIds.includes(playlistId);
    try {
      if (isAssigned) {
        await removeTrackFromPlaylist(playlistId, trackToAddToPlaylist.id);
        setAssignedPlaylistIds((prev) => prev.filter((id) => id !== playlistId));
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } else {
        await addTrackToPlaylist(playlistId, trackToAddToPlaylist.id);
        setAssignedPlaylistIds((prev) => [...prev, playlistId]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      await loadPlaylists();
    } catch (e) {
      console.warn('Failed to toggle track in playlist:', e);
    }
  };

  // -------------------------------------------------------------
  // Render: Top Branding Header
  // -------------------------------------------------------------

  const renderTopBranding = () => (
    <View>
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Image source={logoSource} style={styles.logoImage} resizeMode="contain" />
          <View>
            <Text style={styles.appTitle}>JStream</Text>
            <Text style={styles.appTagline}>PERSONAL MUSIC</Text>
          </View>
        </View>

        <View style={styles.topActions}>
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={12} color={theme.textSecondary} />
            <Text style={styles.offlineBadgeText}>Offline</Text>
          </View>
        </View>
      </View>

      {/* Segmented Tab Selector ("All Songs" | "Playlists") */}
      <View style={styles.tabBarContainer}>
        <TouchableOpacity
          style={[styles.tabBarItem, activeTab === 'songs' && styles.tabBarItemActive]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab('songs');
            setSelectedPlaylist(null);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="musical-notes-outline"
            size={16}
            color={activeTab === 'songs' ? theme.textPrimary : theme.textSecondary}
          />
          <Text
            style={[
              styles.tabBarItemText,
              activeTab === 'songs' && styles.tabBarItemTextActive,
            ]}
          >
            All Songs
          </Text>
          <View style={[styles.tabBadge, activeTab === 'songs' && styles.tabBadgeActive]}>
            <Text
              style={[
                styles.tabBadgeText,
                activeTab === 'songs' && styles.tabBadgeTextActive,
              ]}
            >
              {tracks.length}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBarItem, activeTab === 'playlists' && styles.tabBarItemActive]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setActiveTab('playlists');
            setSelectedPlaylist(null);
          }}
          activeOpacity={0.7}
        >
          <Ionicons
            name="albums-outline"
            size={16}
            color={activeTab === 'playlists' ? theme.textPrimary : theme.textSecondary}
          />
          <Text
            style={[
              styles.tabBarItemText,
              activeTab === 'playlists' && styles.tabBarItemTextActive,
            ]}
          >
            Playlists
          </Text>
          <View
            style={[
              styles.tabBadge,
              activeTab === 'playlists' && styles.tabBadgeActive,
            ]}
          >
            <Text
              style={[
                styles.tabBadgeText,
                activeTab === 'playlists' && styles.tabBadgeTextActive,
              ]}
            >
              {playlists.length}
            </Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );

  // -------------------------------------------------------------
  // Render: All Songs List Header
  // -------------------------------------------------------------

  const renderSongsHeader = () => (
    <View style={styles.header}>
      {renderTopBranding()}

      {/* Library Stats & Section Heading */}
      <View style={styles.libraryMetaRow}>
        <View>
          <Text style={styles.libraryTitle}>Your Library</Text>
          <Text style={styles.trackCountText}>
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
          </Text>
        </View>

        {tracks.length > 1 && (
          <TouchableOpacity
            style={[styles.reorderToggleButton, isReordering && styles.reorderToggleActive]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setIsReordering((prev) => !prev);
            }}
            activeOpacity={0.7}
            accessibilityLabel={isReordering ? 'Finish reordering' : 'Reorder library tracks'}
          >
            <Ionicons
              name={isReordering ? 'checkmark' : 'swap-vertical'}
              size={15}
              color={isReordering ? theme.onPrimary : theme.textSecondary}
            />
            <Text
              style={[
                styles.reorderToggleText,
                isReordering && styles.reorderToggleTextActive,
              ]}
            >
              {isReordering ? 'Done' : 'Reorder'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Action Buttons: Scan Device Storage + Import Audio Files */}
      <View style={styles.actionButtonsRow}>
        <TouchableOpacity
          style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
          onPress={handleScanMusic}
          disabled={isScanning || isImporting}
          activeOpacity={0.8}
        >
          {isScanning ? (
            <ActivityIndicator size="small" color={theme.onPrimary} />
          ) : (
            <Ionicons name="refresh" size={16} color={theme.onPrimary} />
          )}
          <Text style={styles.scanButtonText}>
            {isScanning ? 'Scanning...' : 'Scan Music'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.importButton}
          onPress={handleImportAudio}
          disabled={isImporting || isScanning}
          activeOpacity={0.8}
        >
          {isImporting ? (
            <ActivityIndicator size="small" color={theme.textPrimary} />
          ) : (
            <Ionicons name="folder-open-outline" size={16} color={theme.textPrimary} />
          )}
          <Text style={styles.importButtonText}>
            {isImporting ? 'Importing...' : 'Import Files'}
          </Text>
        </TouchableOpacity>
      </View>

      {scanMessage && (
        <View style={styles.messageBox}>
          <Ionicons name="checkmark-circle-outline" size={16} color={theme.textPrimary} />
          <Text style={styles.messageText}>{scanMessage}</Text>
        </View>
      )}
    </View>
  );

  // -------------------------------------------------------------
  // Render: Playlists Tab View
  // -------------------------------------------------------------

  const renderPlaylistsHeader = () => (
    <View style={styles.header}>
      {renderTopBranding()}

      <View style={styles.playlistHeaderRow}>
        <View>
          <Text style={styles.libraryTitle}>Playlists</Text>
          <Text style={styles.trackCountText}>
            {playlists.length} custom collection{playlists.length === 1 ? '' : 's'}
          </Text>
        </View>

        <TouchableOpacity
          style={styles.newPlaylistButton}
          onPress={() => {
            setNewPlaylistName('');
            setNewPlaylistCoverUri(null);
            setShowCreateModal(true);
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="add" size={16} color={theme.onPrimary} />
          <Text style={styles.newPlaylistButtonText}>New Playlist</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderPlaylistsTab = () => {
    // If a playlist is selected, render the Playlist Detail Screen
    if (selectedPlaylist) {
      return (
        <FlatList
          data={selectedPlaylistTracks}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TrackItem
              track={item}
              queue={selectedPlaylistTracks}
              onDelete={handleRemoveTrackFromCurrentPlaylist}
              onAddToPlaylist={handleOpenAddToPlaylist}
            />
          )}
          ListHeaderComponent={
            <View style={styles.playlistDetailHeader}>
              {/* Back button & Delete button */}
              <View style={styles.playlistDetailNavRow}>
                <TouchableOpacity
                  style={styles.playlistDetailBackBtn}
                  onPress={() => setSelectedPlaylist(null)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="arrow-back" size={18} color={theme.textPrimary} />
                  <Text style={styles.playlistDetailBackText}>All Playlists</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.playlistDetailDeleteBtn}
                  onPress={() => handleDeletePlaylistConfirm(selectedPlaylist)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={18} color={theme.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Playlist Summary Card */}
              <View style={styles.playlistDetailCard}>
                <TouchableOpacity
                  style={styles.playlistDetailCover}
                  onPress={() => setShowPlaylistCoverActionModal(true)}
                  activeOpacity={0.8}
                  accessibilityLabel="Change or remove playlist cover"
                >
                  {selectedPlaylist.cover_uri ? (
                    <Image
                      source={{ uri: selectedPlaylist.cover_uri }}
                      style={styles.playlistCoverImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <Ionicons name="albums-outline" size={36} color={theme.textSecondary} />
                  )}
                </TouchableOpacity>

                <View style={styles.playlistDetailInfo}>
                  <Text style={styles.playlistDetailTitle} numberOfLines={1}>
                    {selectedPlaylist.name}
                  </Text>
                  <Text style={styles.playlistDetailSubtitle}>
                    {selectedPlaylistTracks.length} song
                    {selectedPlaylistTracks.length === 1 ? '' : 's'} • Offline
                  </Text>
                </View>
              </View>

              {/* Play All Button */}
              {selectedPlaylistTracks.length > 0 && (
                <TouchableOpacity
                  style={styles.playlistDetailPlayAllBtn}
                  onPress={handlePlayAllInSelectedPlaylist}
                  activeOpacity={0.8}
                >
                  <Ionicons name="play" size={18} color={theme.onPrimary} />
                  <Text style={styles.playlistDetailPlayAllText}>Play All</Text>
                </TouchableOpacity>
              )}
            </View>
          }
          ListEmptyComponent={
            isLoadingPlaylistTracks ? (
              <View style={styles.emptyContainer}>
                <ActivityIndicator size="large" color={theme.primary} />
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <View style={styles.emptyIconCircle}>
                  <Ionicons name="musical-notes-outline" size={36} color={theme.textMuted} />
                </View>
                <Text style={styles.emptyTitle}>Playlist is empty</Text>
                <Text style={styles.emptySubtitle}>
                  Tap the bookmark icon on any song in your library to add it to this playlist.
                </Text>
              </View>
            )
          }
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      );
    }

    // Otherwise render Playlists Collection List
    return (
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.playlistCard}
            onPress={() => handleOpenPlaylist(item)}
            activeOpacity={0.7}
          >
            <View style={styles.playlistCoverContainer}>
              {item.cover_uri ? (
                <Image
                  source={{ uri: item.cover_uri }}
                  style={styles.playlistCoverImage}
                  resizeMode="cover"
                />
              ) : (
                <Ionicons name="albums-outline" size={24} color={theme.textSecondary} />
              )}
            </View>

            <View style={styles.playlistCardInfo}>
              <Text style={styles.playlistCardTitle} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.playlistCardMeta}>
                {item.track_count ?? 0} track{(item.track_count ?? 0) === 1 ? '' : 's'}
              </Text>
            </View>

            <View style={styles.playlistCardActions}>
              <TouchableOpacity
                style={styles.playlistCardPlayBtn}
                onPress={() => handlePlayPlaylist(item)}
                activeOpacity={0.8}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="play" size={16} color={theme.textPrimary} style={{ marginLeft: 2 }} />
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        )}
        ListHeaderComponent={renderPlaylistsHeader}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="albums-outline" size={40} color={theme.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No offline playlists yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap &ldquo;New Playlist&rdquo; to create your first custom playlist collection.
            </Text>
          </View>
        }
        contentContainerStyle={styles.playlistListContent}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  const renderEmptySongsState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconCircle}>
        <Ionicons name="musical-notes-outline" size={40} color={theme.textMuted} />
      </View>
      <Text style={styles.emptyTitle}>No offline tracks found</Text>
      <Text style={styles.emptySubtitle}>
        Tap &ldquo;Scan Music&rdquo; to detect audio files or &ldquo;Import Files&rdquo; to pick songs from your device storage.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Subtle JS Monogram Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image source={logoSource} style={styles.watermarkImage} resizeMode="contain" />
      </View>

      {/* Main Tab Views */}
      {activeTab === 'songs' ? (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const isDragging = draggingIndex === index;
            const panResponder = getRowPanResponder(index);

            return (
              <View
                style={[
                  styles.trackRowContainer,
                  isDragging && styles.trackRowDragging,
                ]}
              >
                <TrackItem
                  track={item}
                  queue={tracks}
                  onDelete={handleDeleteTrack}
                  showDragHandle={isReordering}
                  dragHandleProps={panResponder.panHandlers}
                  onLongPress={handleRowLongPress}
                  onAddToPlaylist={handleOpenAddToPlaylist}
                />
              </View>
            );
          }}
          ListHeaderComponent={renderSongsHeader}
          ListEmptyComponent={renderEmptySongsState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        renderPlaylistsTab()
      )}

      {/* Custom Monochrome Confirmation & Alert Modal */}
      <ConfirmModal
        visible={confirmConfig.visible}
        title={confirmConfig.title}
        message={confirmConfig.message}
        icon={confirmConfig.icon}
        confirmText={confirmConfig.confirmText}
        cancelText={confirmConfig.cancelText}
        isDestructive={confirmConfig.isDestructive}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig((prev) => ({ ...prev, visible: false }))}
      />

      {/* Create Playlist Modal */}
      <Modal
        visible={showCreateModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCreateModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create Playlist</Text>
            <Text style={styles.modalSubtitle}>
              Create a custom offline playlist for your songs
            </Text>

            {/* Optional Cover Picker */}
            <View style={{ alignSelf: 'center', position: 'relative' }}>
              <TouchableOpacity
                style={styles.modalCoverPicker}
                onPress={handlePickPlaylistCover}
                activeOpacity={0.8}
              >
                {newPlaylistCoverUri ? (
                  <Image
                    source={{ uri: newPlaylistCoverUri }}
                    style={styles.modalCoverImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Ionicons name="camera-outline" size={26} color={theme.textSecondary} />
                )}
              </TouchableOpacity>
              {newPlaylistCoverUri ? (
                <TouchableOpacity
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    backgroundColor: theme.surface,
                    borderRadius: 12,
                  }}
                  onPress={() => setNewPlaylistCoverUri(null)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Remove cover image"
                >
                  <Ionicons name="close-circle" size={22} color={theme.error} />
                </TouchableOpacity>
              ) : null}
            </View>

            <TextInput
              style={styles.modalInput}
              value={newPlaylistName}
              onChangeText={setNewPlaylistName}
              placeholder="Playlist name (e.g. Chill Beats)"
              placeholderTextColor={theme.textMuted}
              maxLength={40}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowCreateModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleCreatePlaylist}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSaveText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Add to Playlist Modal */}
      <Modal
        visible={trackToAddToPlaylist !== null}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setTrackToAddToPlaylist(null)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add to Playlist</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              {trackToAddToPlaylist?.title}
            </Text>

            {/* Inline Quick Create Playlist Button */}
            <TouchableOpacity
              style={styles.inlineNewPlaylistBtn}
              onPress={() => {
                setNewPlaylistName('');
                setNewPlaylistCoverUri(null);
                setShowCreateModal(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={18} color={theme.primary} />
              <Text style={styles.inlineNewPlaylistText}>New Playlist</Text>
            </TouchableOpacity>

            <ScrollView style={styles.playlistPickerList}>
              {playlists.length === 0 ? (
                <Text
                  style={{
                    color: theme.textSecondary,
                    textAlign: 'center',
                    paddingVertical: 18,
                    fontSize: 13,
                  }}
                >
                  No playlists created yet.
                </Text>
              ) : (
                playlists.map((pl) => {
                  const isAssigned = assignedPlaylistIds.includes(pl.id);
                  return (
                    <TouchableOpacity
                      key={pl.id}
                      style={[
                        styles.playlistItemPicker,
                        isAssigned && styles.playlistItemPickerSelected,
                      ]}
                      onPress={() => handleToggleTrackInPlaylist(pl.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.playlistItemPickerLeft}>
                        <View style={styles.playlistItemPickerIcon}>
                          {pl.cover_uri ? (
                            <Image
                              source={{ uri: pl.cover_uri }}
                              style={styles.playlistCoverImage}
                              resizeMode="cover"
                            />
                          ) : (
                            <Ionicons name="albums-outline" size={16} color={theme.textSecondary} />
                          )}
                        </View>
                        <View>
                          <Text style={styles.playlistItemPickerTitle} numberOfLines={1}>
                            {pl.name}
                          </Text>
                          <Text style={styles.playlistItemPickerMeta}>
                            {pl.track_count ?? 0} tracks
                          </Text>
                        </View>
                      </View>

                      <Ionicons
                        name={isAssigned ? 'checkmark-circle' : 'ellipse-outline'}
                        size={22}
                        color={isAssigned ? theme.primary : theme.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={() => setTrackToAddToPlaylist(null)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSaveText}>Done</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Selected Playlist Cover Action Modal (Choose / Remove) */}
      <Modal
        visible={showPlaylistCoverActionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPlaylistCoverActionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Playlist Cover</Text>
            <Text style={styles.modalSubtitle}>
              Change or remove cover artwork for &ldquo;{selectedPlaylist?.name}&rdquo;
            </Text>

            <TouchableOpacity
              onPress={handleChangeSelectedPlaylistCover}
              activeOpacity={0.7}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderRadius: 10,
                backgroundColor: theme.surfaceElevated,
                borderWidth: 1,
                borderColor: theme.border,
                marginBottom: 8,
              }}
            >
              <Ionicons name="images-outline" size={20} color={theme.textPrimary} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: theme.textPrimary }}>
                Choose from Photos
              </Text>
            </TouchableOpacity>

            {selectedPlaylist?.cover_uri ? (
              <TouchableOpacity
                onPress={handleRemoveSelectedPlaylistCover}
                activeOpacity={0.7}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: theme.surfaceElevated,
                  borderWidth: 1,
                  borderColor: theme.border,
                  marginBottom: 8,
                }}
              >
                <Ionicons name="trash-outline" size={20} color={theme.error} />
                <Text style={{ fontSize: 14, fontWeight: '600', color: theme.error }}>
                  Remove Cover Image
                </Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowPlaylistCoverActionModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
