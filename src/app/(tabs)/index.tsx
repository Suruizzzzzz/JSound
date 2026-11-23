import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  BackHandler,
  Animated,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
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
  updatePlaylistName,
  updatePlaylistCover,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
  getPlaylistsContainingTrack,
  getSetting,
  setSetting,
} from '@/lib/database';
import {
  sharePlaylist,
  syncSharedPlaylistTracks,
  togglePlaylistPublic,
} from '@/services/playlistSyncService';
import { useSyncProgressStore } from '@/store/syncProgressStore';
import TrackItem from '@/components/TrackItem';
import ConfirmModal from '@/components/ConfirmModal';
import ImportPlaylistModal from '@/components/ImportPlaylistModal';
import { Track, Playlist } from '@/types/music';
import { registerGuideTarget, useGuideStore } from '@/store/guideStore';
import { createStyles } from '@/styles/index.styles';

type LibraryTab = 'songs' | 'playlists';

export type SortChoice = 'last_download' | 'first_download' | 'title_asc' | 'artist_asc' | 'custom';

function getSortLabel(choice: SortChoice): string {
  switch (choice) {
    case 'last_download':
      return 'Last Download';
    case 'first_download':
      return 'First Download';
    case 'title_asc':
      return 'Title A-Z';
    case 'artist_asc':
      return 'Artist A-Z';
    case 'custom':
      return 'Custom';
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function LibraryScreen() {
  const tracks = usePlayerStore((state) => state.tracks);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const reorderTracks = usePlayerStore((state) => state.reorderTracks);
  const removeTrackFromStore = usePlayerStore((state) => state.removeTrack);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const currentTrack = usePlayerStore((state) => state.currentTrack);

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

  // Guide demo store bindings & Library highlight / safe auto-play
  const demoAction = useGuideStore((state) => state.demoAction);
  const demoNonce = useGuideStore((state) => state.demoNonce);
  const [pulseAnim] = useState(() => new Animated.Value(0));
  const autoPlayedDemoNonceRef = useRef<number>(-1);

  const demoTargetTrack = useMemo(() => {
    if (demoAction !== 'highlight_saved_library') return null;
    return (
      tracks.find((t) => {
        const title = (t.title || '').toLowerCase();
        const artist = (t.artist || '').toLowerCase();
        const matches =
          title.includes('about you') && (artist.includes('1975') || title.includes('1975'));
        return matches && !!t.local_audio_uri;
      }) || null
    );
  }, [demoAction, tracks]);

  const highlightedTrackId = useMemo(() => {
    if (demoAction !== 'highlight_saved_library') return null;
    if (demoTargetTrack) return demoTargetTrack.id;
    const fallback = tracks.find((t) => {
      const title = (t.title || '').toLowerCase();
      const artist = (t.artist || '').toLowerCase();
      return title.includes('about you') && (artist.includes('1975') || title.includes('1975'));
    });
    return fallback ? fallback.id : (tracks[0]?.id ?? null);
  }, [demoAction, demoTargetTrack, tracks]);

  useEffect(() => {
    if (highlightedTrackId) {
      pulseAnim.setValue(0);
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: false,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0,
            duration: 900,
            useNativeDriver: false,
          }),
        ])
      );
      pulseLoop.start();
      return () => pulseLoop.stop();
    } else {
      pulseAnim.setValue(0);
    }
  }, [highlightedTrackId, pulseAnim]);

  // Safe auto-play for Step 5 after short 250ms transition delay
  useEffect(() => {
    if (
      demoAction === 'highlight_saved_library' &&
      demoTargetTrack &&
      demoTargetTrack.local_audio_uri &&
      autoPlayedDemoNonceRef.current !== demoNonce
    ) {
      autoPlayedDemoNonceRef.current = demoNonce;
      const timer = setTimeout(async () => {
        try {
          const currentOfflineTracks = usePlayerStore.getState().tracks;
          await playTrack(demoTargetTrack, currentOfflineTracks, {
            type: 'library',
            name: 'Local Offline Tracks',
          });
        } catch (playErr) {
          console.warn('[DemoAutoplay] Failed to play demo track:', playErr);
        }
      }, 250);

      return () => clearTimeout(timer);
    }
  }, [demoAction, demoNonce, demoTargetTrack, playTrack]);

  const animatedBorderColor = useMemo(
    () =>
      pulseAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [theme.border, theme.primary],
      }),
    [pulseAnim, theme.border, theme.primary]
  );

  // Scanner & library states
  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showAddMusicModal, setShowAddMusicModal] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [showBatchAddToPlaylistModal, setShowBatchAddToPlaylistModal] = useState(false);
  const [showAddSongsToPlaylistModal, setShowAddSongsToPlaylistModal] = useState(false);
  const [selectedAddSongIds, setSelectedAddSongIds] = useState<Set<string>>(new Set());
  const [sortChoice, setSortChoice] = useState<SortChoice>('last_download');
  const [showSortModal, setShowSortModal] = useState(false);

  // Playlists States
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [selectedPlaylistTracks, setSelectedPlaylistTracks] = useState<Track[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);

  // Create Playlist Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistCoverUri, setNewPlaylistCoverUri] = useState<string | null>(null);
  const [newPlaylistIsPublic, setNewPlaylistIsPublic] = useState(false);

  // Edit Playlist Name Modal State
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editPlaylistNameInput, setEditPlaylistNameInput] = useState('');

  // Share Playlist State
  const [isSharingPlaylist, setIsSharingPlaylist] = useState(false);

  // Import Shared Playlist Modal State
  const [showImportModal, setShowImportModal] = useState(false);

  // Live Cloud Sync Progress
  const syncDownloading = useSyncProgressStore((state) => state.isDownloading);
  const syncCurrentIndex = useSyncProgressStore((state) => state.currentIndex);
  const syncTotalCount = useSyncProgressStore((state) => state.totalCount);
  const syncCurrentTitle = useSyncProgressStore((state) => state.currentTitle);
  const syncProgressPct = useSyncProgressStore((state) => state.currentProgress);
  const cancelSyncDownload = useSyncProgressStore((state) => state.cancelSyncDownload);

  // Selected Playlist Cover Action Modal State
  const [showPlaylistCoverActionModal, setShowPlaylistCoverActionModal] = useState(false);

  // Playlist Options Menu Action Sheet Modal State
  const [showPlaylistMenuModal, setShowPlaylistMenuModal] = useState(false);

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

  // Sort helper function
  const applySort = useCallback((list: Track[], choice: SortChoice): Track[] => {
    const sorted = [...list];
    if (choice === 'last_download') {
      return sorted.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeB - timeA;
      });
    } else if (choice === 'first_download') {
      return sorted.sort((a, b) => {
        const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
        return timeA - timeB;
      });
    } else if (choice === 'title_asc') {
      return sorted.sort((a, b) =>
        (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
      );
    } else if (choice === 'artist_asc') {
      return sorted.sort((a, b) =>
        (a.artist || '').localeCompare(b.artist || '', undefined, { sensitivity: 'base' })
      );
    }
    return sorted;
  }, []);

  // Load playlists helper
  const loadPlaylists = useCallback(async () => {
    try {
      const stored = await getAllPlaylists();
      setPlaylists(stored);
    } catch (e) {
      console.warn('Failed to load playlists:', e);
    }
  }, []);

  // Auto-dismiss scan message after 4s
  useEffect(() => {
    if (scanMessage) {
      const timer = setTimeout(() => setScanMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [scanMessage]);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const storedTracks = await getAllTracks();
        const savedSort = ((await getSetting('library_sort')) as SortChoice) || 'last_download';
        if (isMounted) {
          setSortChoice(savedSort);
          const sorted = savedSort !== 'custom' ? applySort(storedTracks, savedSort) : storedTracks;
          setTracks(sorted);
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
  }, [setTracks, loadPlaylists, applySort]);

  // Refresh library and maintain Last Download sort order when returning to Library tab
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      (async () => {
        try {
          const stored = await getAllTracks();
          const savedSort = ((await getSetting('library_sort')) as SortChoice) || 'last_download';
          if (isMounted) {
            setSortChoice(savedSort);
            const sorted = savedSort !== 'custom' ? applySort(stored, savedSort) : stored;
            setTracks(sorted);
          }
        } catch (e) {
          console.warn('Failed to refresh tracks on tab focus:', e);
        }
      })();
      return () => {
        isMounted = false;
      };
    }, [applySort, setTracks])
  );

  // Hook up Add Music modal triggers for the interactive walkthrough guide
  useEffect(() => {
    useGuideStore.getState().setRequestOpenAddMusicModal(() => setShowAddMusicModal(true));
    useGuideStore.getState().setRequestCloseAddMusicModal(() => setShowAddMusicModal(false));
    return () => {
      useGuideStore.getState().setRequestOpenAddMusicModal(undefined);
      useGuideStore.getState().setRequestCloseAddMusicModal(undefined);
    };
  }, []);

  // Handle Android hardware back button cleanly on Library screen
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const onBackPress = () => {
        // 1. If any modal or open sheet is visible, dismiss it first
        if (showAddMusicModal) {
          setShowAddMusicModal(false);
          return true;
        }
        if (showSortModal) {
          setShowSortModal(false);
          return true;
        }
        if (showAddSongsToPlaylistModal) {
          setShowAddSongsToPlaylistModal(false);
          return true;
        }
        if (showBatchAddToPlaylistModal) {
          setShowBatchAddToPlaylistModal(false);
          return true;
        }
        if (showCreateModal) {
          setShowCreateModal(false);
          return true;
        }
        if (showEditNameModal) {
          setShowEditNameModal(false);
          return true;
        }
        if (showImportModal) {
          setShowImportModal(false);
          return true;
        }
        if (showPlaylistCoverActionModal) {
          setShowPlaylistCoverActionModal(false);
          return true;
        }
        if (showPlaylistMenuModal) {
          setShowPlaylistMenuModal(false);
          return true;
        }
        if (trackToAddToPlaylist) {
          setTrackToAddToPlaylist(null);
          return true;
        }
        if (confirmConfig.visible) {
          setConfirmConfig((prev) => ({ ...prev, visible: false }));
          return true;
        }
        if (selectionMode) {
          setSelectionMode(false);
          setSelectedTrackIds(new Set());
          return true;
        }
        if (selectedPlaylist) {
          setSelectedPlaylist(null);
          return true;
        }
        const guideState = useGuideStore.getState();
        if (guideState.isOpen) {
          guideState.closeGuide();
          return true;
        }
        const playerState = usePlayerStore.getState();
        if (playerState.isModalOpen) {
          playerState.setModalOpen(false);
          return true;
        }

        // 2. When at the root Library view with no open modals, cleanly exit app
        BackHandler.exitApp();
        return true;
      };

      const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
      return () => subscription.remove();
    }, [
      showAddMusicModal,
      showSortModal,
      showAddSongsToPlaylistModal,
      showBatchAddToPlaylistModal,
      showCreateModal,
      showEditNameModal,
      showImportModal,
      showPlaylistCoverActionModal,
      showPlaylistMenuModal,
      trackToAddToPlaylist,
      confirmConfig.visible,
      selectionMode,
      selectedPlaylist,
    ])
  );

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

      // Walkthrough Tour Branching:
      const guideState = useGuideStore.getState();
      if (guideState.isOpen && guideState.currentStep === 1) {
        if (scanned.length > 0) {
          // Branch A: tracks found -> Step 3 (Play Instantly)
          guideState.setNoTracksFound(false);
          guideState.setStep(2);
        } else {
          // Branch B: 0 tracks found -> Skip Step 3 and advance directly to Step 4 (Search Tab)
          guideState.setNoTracksFound(true);
          guideState.setStep(3);
        }
      }
    } catch (error: any) {
      const guideState = useGuideStore.getState();
      if (guideState.isOpen && guideState.currentStep === 1) {
        guideState.setNoTracksFound(true);
        guideState.setStep(3);
      }
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

  const handleSelectSort = async (choice: SortChoice) => {
    setSortChoice(choice);
    setShowSortModal(false);
    await setSetting('library_sort', choice);
    Haptics.selectionAsync();

    if (choice !== 'custom') {
      const sorted = applySort(tracks, choice);
      setTracks(sorted);
      await reorderTracks(sorted);
    }
  };

  const handleMoveTrack = async (fromIndex: number, toIndex: number) => {
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tracks.length ||
      toIndex >= tracks.length ||
      fromIndex === toIndex
    )
      return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = [...tracks];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    setTracks(updated);
    setSortChoice('custom');
    await setSetting('library_sort', 'custom');
    await reorderTracks(updated);
  };

  const handleRowLongPress = useCallback((trackId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSelectionMode(true);
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      next.add(trackId);
      return next;
    });
  }, []);

  const handleToggleSelectTrack = useCallback((trackId: string) => {
    Haptics.selectionAsync();
    setSelectedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }, []);

  const isAllSelected = tracks.length > 0 && selectedTrackIds.size === tracks.length;

  const handleToggleSelectAll = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isAllSelected) {
      setSelectedTrackIds(new Set());
    } else {
      setSelectedTrackIds(new Set(tracks.map((t) => t.id)));
    }
  }, [isAllSelected, tracks]);

  const handleExitSelectionMode = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectionMode(false);
    setSelectedTrackIds(new Set());
  }, []);

  const handleBatchDeleteConfirm = () => {
    if (selectedTrackIds.size === 0) return;
    const count = selectedTrackIds.size;
    setConfirmConfig({
      visible: true,
      title: 'Delete Songs',
      message: `Are you sure you want to remove ${count} song${count === 1 ? '' : 's'} from your offline library? This will delete the local audio files.`,
      icon: 'trash-outline',
      confirmText: `Delete ${count} Song${count === 1 ? '' : 's'}`,
      cancelText: 'Cancel',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmConfig((prev) => ({ ...prev, visible: false }));
        try {
          const idsToDelete = Array.from(selectedTrackIds);
          for (const id of idsToDelete) {
            await removeTrackFromDb(id);
            await removeTrackFromStore(id);
          }
          await loadPlaylists();
          handleExitSelectionMode();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch (e) {
          console.warn('Failed to batch delete tracks:', e);
        }
      },
    });
  };

  const handleBatchAddTracksToPlaylist = async (playlist: Playlist) => {
    try {
      const idsToAdd = Array.from(selectedTrackIds);
      let addedCount = 0;
      for (const trackId of idsToAdd) {
        try {
          await addTrackToPlaylist(playlist.id, trackId);
          addedCount++;
        } catch {
          // Track already in playlist, continue
        }
      }
      await loadPlaylists();
      setShowBatchAddToPlaylistModal(false);
      handleExitSelectionMode();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Automatically re-sync cloud playlist in background if already shared
      if (playlist.share_code) {
        syncSharedPlaylistTracks(playlist.id).catch(() => {});
      }

      setScanMessage(
        `Added ${addedCount} song${addedCount === 1 ? '' : 's'} to "${playlist.name}"`
      );
    } catch (e) {
      console.warn('Failed to batch add tracks to playlist:', e);
    }
  };

  // Add Songs to Playlist Modal Helpers (inside Playlist Detail)
  const availableSongsForPlaylist = useMemo(() => {
    if (!selectedPlaylist) return [];
    const existingIds = new Set(selectedPlaylistTracks.map((t) => t.id));
    return tracks.filter((t) => !existingIds.has(t.id));
  }, [tracks, selectedPlaylist, selectedPlaylistTracks]);

  const isAllAddSongsSelected =
    availableSongsForPlaylist.length > 0 &&
    selectedAddSongIds.size === availableSongsForPlaylist.length;

  const handleOpenAddSongsModal = () => {
    if (!selectedPlaylist) return;
    setSelectedAddSongIds(new Set());
    setShowAddSongsToPlaylistModal(true);
  };

  const handleToggleAddSongSelection = (trackId: string) => {
    Haptics.selectionAsync();
    setSelectedAddSongIds((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  };

  const handleToggleSelectAllAddSongs = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isAllAddSongsSelected) {
      setSelectedAddSongIds(new Set());
    } else {
      setSelectedAddSongIds(new Set(availableSongsForPlaylist.map((t) => t.id)));
    }
  };

  const handleConfirmAddSongsToPlaylist = async () => {
    if (!selectedPlaylist || selectedAddSongIds.size === 0) return;
    try {
      const idsToAdd = Array.from(selectedAddSongIds);
      for (const trackId of idsToAdd) {
        try {
          await addTrackToPlaylist(selectedPlaylist.id, trackId);
        } catch {
          // ignore duplicate
        }
      }
      const updated = await getPlaylistTracks(selectedPlaylist.id);
      setSelectedPlaylistTracks(updated);
      await loadPlaylists();
      setShowAddSongsToPlaylistModal(false);
      setSelectedAddSongIds(new Set());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Automatically re-sync cloud playlist in background if already shared
      if (selectedPlaylist.share_code) {
        syncSharedPlaylistTracks(selectedPlaylist.id).catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to add songs to playlist:', e);
    }
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
        await playTrack(pTracks[0], pTracks, { type: 'playlist', name: playlist.name });
      } else {
        handleOpenPlaylist(playlist);
      }
    } catch (e) {
      console.warn('Failed to play playlist:', e);
    }
  };

  const handlePlayAllInSelectedPlaylist = async () => {
    if (selectedPlaylistTracks.length > 0 && selectedPlaylist) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await playTrack(selectedPlaylistTracks[0], selectedPlaylistTracks, {
        type: 'playlist',
        name: selectedPlaylist.name,
      });
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

      // Automatically re-sync cloud playlist in background if already shared
      syncSharedPlaylistTracks(selectedPlaylist.id).catch(() => {});
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
      await createPlaylist(
        cleanName,
        newPlaylistCoverUri,
        null,
        undefined,
        'local_guest',
        newPlaylistIsPublic
      );
      await loadPlaylists();
      setNewPlaylistName('');
      setNewPlaylistCoverUri(null);
      setNewPlaylistIsPublic(false);
      setShowCreateModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('Failed to create playlist:', e);
    }
  };

  const handleOpenEditPlaylistName = () => {
    if (!selectedPlaylist) return;
    setEditPlaylistNameInput(selectedPlaylist.name);
    setShowEditNameModal(true);
  };

  const handleSaveEditPlaylistName = async () => {
    if (!selectedPlaylist) return;
    const cleanName = editPlaylistNameInput.trim();
    if (!cleanName) return;

    try {
      await updatePlaylistName(selectedPlaylist.id, cleanName);
      setSelectedPlaylist((prev) => (prev ? { ...prev, name: cleanName } : null));
      await loadPlaylists();
      setShowEditNameModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      console.warn('Failed to update playlist name:', e);
    }
  };

  const handleSharePlaylist = async () => {
    if (!selectedPlaylist) return;
    setIsSharingPlaylist(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const result = await sharePlaylist(selectedPlaylist.id);
      setIsSharingPlaylist(false);

      if (result.success && result.shareCode) {
        setSelectedPlaylist((prev) => (prev ? { ...prev, share_code: result.shareCode } : null));
        await loadPlaylists();
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        setConfirmConfig({
          visible: true,
          title: 'Playlist Link Copied!',
          message: `Share Code: ${result.shareCode}\n\nThe link "${result.shareUrl}" has been copied to your clipboard. Friends can use this code or link to import your playlist into JStream.`,
          icon: 'checkmark-circle-outline',
          confirmText: 'Awesome',
          cancelText: '',
          isDestructive: false,
          onConfirm: () => setConfirmConfig((prev) => ({ ...prev, visible: false })),
        });
      } else {
        setConfirmConfig({
          visible: true,
          title: 'Share Playlist',
          message: result.error || 'Failed to share playlist.',
          icon: 'alert-circle-outline',
          confirmText: 'Got It',
          cancelText: '',
          isDestructive: false,
          onConfirm: () => setConfirmConfig((prev) => ({ ...prev, visible: false })),
        });
      }
    } catch (err: any) {
      setIsSharingPlaylist(false);
      setConfirmConfig({
        visible: true,
        title: 'Share Playlist',
        message: err.message || 'An error occurred while sharing the playlist.',
        icon: 'alert-circle-outline',
        confirmText: 'OK',
        cancelText: '',
        isDestructive: false,
        onConfirm: () => setConfirmConfig((prev) => ({ ...prev, visible: false })),
      });
    }
  };

  const handleToggleSelectedPlaylistPublic = async () => {
    if (!selectedPlaylist) return;
    const newStatus = !selectedPlaylist.is_public;
    try {
      await togglePlaylistPublic(selectedPlaylist.id, newStatus);
      setSelectedPlaylist((prev) => (prev ? { ...prev, is_public: newStatus ? 1 : 0 } : null));
      await loadPlaylists();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setScanMessage(
        newStatus
          ? `"${selectedPlaylist.name}" is now public in Community Playlists.`
          : `"${selectedPlaylist.name}" is now private.`
      );
    } catch (e) {
      console.warn('Failed to toggle playlist public status:', e);
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

      // Automatically re-sync cloud playlist in background if already shared
      syncSharedPlaylistTracks(playlistId).catch(() => {});
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
  // Render: All Songs List Header Content
  // -------------------------------------------------------------

  const renderSongsHeader = () => (
    <View style={{ marginTop: 2 }}>
      {/* Row 1: Section Heading on left, + Add Music flush right */}
      <View style={styles.libraryMetaRow}>
        <View>
          <Text style={styles.libraryTitle}>Your Library</Text>
          <Text style={styles.trackCountText}>
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
          </Text>
        </View>

        {/* + Add Music Trigger Button */}
        <TouchableOpacity
          ref={(ref) => registerGuideTarget('add_music_button', ref)}
          style={styles.addMusicButton}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowAddMusicModal(true);
            const guideState = useGuideStore.getState();
            if (guideState.isOpen && guideState.currentStep === 0) {
              guideState.nextStep();
            }
          }}
          disabled={isScanning || isImporting}
          activeOpacity={0.8}
          accessibilityLabel="Add music to library"
        >
          {isScanning || isImporting ? (
            <ActivityIndicator size="small" color={theme.onPrimary} />
          ) : (
            <Ionicons name="add" size={16} color={theme.onPrimary} />
          )}
          <Text style={styles.addMusicButtonText}>
            {isScanning ? 'Scanning...' : isImporting ? 'Importing...' : 'Add Music'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Row 2: Sort Cleanly Underneath */}
      <View style={styles.filterControlsRow}>
        {/* Sort Button */}
        <TouchableOpacity
          style={styles.sortButton}
          onPress={() => setShowSortModal(true)}
          activeOpacity={0.7}
          accessibilityLabel="Sort songs"
        >
          <Ionicons name="filter-outline" size={13} color={theme.textSecondary} />
          <Text style={styles.sortButtonText} numberOfLines={1}>
            {getSortLabel(sortChoice)}
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
    <View style={styles.playlistHeaderRow}>
      <View>
        <Text style={styles.libraryTitle}>Playlists</Text>
        <Text style={styles.trackCountText}>
          {playlists.length} custom collection{playlists.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.playlistHeaderActions}>
        <TouchableOpacity
          style={styles.importPlaylistButton}
          onPress={() => setShowImportModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="globe-outline" size={15} color={theme.textPrimary} />
          <Text style={styles.importPlaylistButtonText}>Community &amp; Import</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.newPlaylistButton}
          onPress={() => {
            setNewPlaylistName('');
            setNewPlaylistCoverUri(null);
            setNewPlaylistIsPublic(false);
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
              playbackContext={{ type: 'playlist', name: selectedPlaylist.name }}
              onDelete={handleRemoveTrackFromCurrentPlaylist}
              onAddToPlaylist={handleOpenAddToPlaylist}
            />
          )}
          ListHeaderComponent={
            <View style={styles.playlistDetailHeader}>
              {/* Top Bar: Back button on left, ••• menu button on right */}
              <View style={styles.playlistDetailNavRow}>
                <TouchableOpacity
                  style={styles.playlistDetailBackBtn}
                  onPress={() => setSelectedPlaylist(null)}
                  activeOpacity={0.7}
                  accessibilityLabel="Back to all playlists"
                >
                  <Ionicons name="arrow-back" size={17} color={theme.textPrimary} />
                  <Text style={styles.playlistDetailBackText}>Playlists</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.playlistDetailMenuBtn}
                  onPress={() => setShowPlaylistMenuModal(true)}
                  activeOpacity={0.7}
                  accessibilityLabel="Playlist menu options"
                >
                  <Ionicons name="ellipsis-horizontal" size={20} color={theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {/* Centered Hero Header */}
              <View style={styles.playlistHeroContainer}>
                {/* 160x160 Rounded Cover Art */}
                <TouchableOpacity
                  style={styles.playlistHeroCover}
                  onPress={() => setShowPlaylistCoverActionModal(true)}
                  activeOpacity={0.8}
                  accessibilityLabel="Change or remove playlist cover"
                >
                  {selectedPlaylist.cover_uri ? (
                    <Image
                      source={{ uri: selectedPlaylist.cover_uri }}
                      style={styles.playlistHeroCoverImage}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.playlistHeroCoverPlaceholder}>
                      <Ionicons name="musical-notes" size={60} color={theme.textSecondary} />
                    </View>
                  )}
                </TouchableOpacity>

                {/* Bold Playlist Title */}
                <Text style={styles.playlistHeroTitle} numberOfLines={2}>
                  {selectedPlaylist.name}
                </Text>

                {/* Subtitle & Status Badges */}
                <View style={styles.playlistHeroSubtitleRow}>
                  <Text style={styles.playlistHeroSubtitle}>
                    {selectedPlaylistTracks.length} song{selectedPlaylistTracks.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={[styles.playlistHeroSubtitle, { opacity: 0.5 }]}>•</Text>
                  <View style={styles.playlistStatusBadge}>
                    <Ionicons
                      name={selectedPlaylist.is_synced ? 'cloud-done-outline' : 'phone-portrait-outline'}
                      size={12}
                      color={theme.textSecondary}
                    />
                    <Text style={styles.playlistStatusBadgeText}>
                      {selectedPlaylist.is_synced ? 'Synced' : 'Offline'}
                    </Text>
                  </View>
                  <View style={styles.playlistStatusBadge}>
                    <Ionicons
                      name={selectedPlaylist.is_public ? 'globe-outline' : 'lock-closed-outline'}
                      size={12}
                      color={theme.textSecondary}
                    />
                    <Text style={styles.playlistStatusBadgeText}>
                      {selectedPlaylist.is_public ? 'Public' : 'Private'}
                    </Text>
                  </View>
                  {selectedPlaylist.share_code && (
                    <View style={styles.playlistStatusBadge}>
                      <Ionicons name="link-outline" size={12} color={theme.textSecondary} />
                      <Text style={styles.playlistStatusBadgeText}>{selectedPlaylist.share_code}</Text>
                    </View>
                  )}
                </View>

                {/* Button Row: Play All + Add Songs + Share */}
                <View style={styles.playlistHeroButtonRow}>
                  <TouchableOpacity
                    style={styles.playlistHeroPlayAllBtn}
                    onPress={handlePlayAllInSelectedPlaylist}
                    activeOpacity={0.8}
                    accessibilityLabel="Play all songs in playlist"
                  >
                    <Ionicons name="play" size={17} color={theme.onPrimary} />
                    <Text style={styles.playlistHeroPlayAllText}>Play All</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playlistHeroShareBtn}
                    onPress={handleOpenAddSongsModal}
                    activeOpacity={0.7}
                    accessibilityLabel="Add songs to playlist"
                  >
                    <Ionicons name="add-circle-outline" size={17} color={theme.textPrimary} />
                    <Text style={styles.playlistHeroShareText}>Add Songs</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.playlistHeroShareBtn}
                    onPress={handleSharePlaylist}
                    activeOpacity={0.7}
                    disabled={isSharingPlaylist}
                    accessibilityLabel="Share playlist"
                  >
                    {isSharingPlaylist ? (
                      <ActivityIndicator size="small" color={theme.textPrimary} />
                    ) : (
                      <Ionicons name="share-social-outline" size={17} color={theme.textPrimary} />
                    )}
                    <Text style={styles.playlistHeroShareText}>Share</Text>
                  </TouchableOpacity>
                </View>
              </View>
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
                  Tap below to add songs from your library to this playlist.
                </Text>
                <TouchableOpacity
                  style={[styles.addMusicButton, { marginTop: 14 }]}
                  onPress={handleOpenAddSongsModal}
                  activeOpacity={0.8}
                >
                  <Ionicons name="add" size={16} color={theme.onPrimary} />
                  <Text style={styles.addMusicButtonText}>Add Songs</Text>
                </TouchableOpacity>
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

      {/* FIXED TOP HEADER (Branding, Segmented Tabs & Section Header) */}
      {(!selectedPlaylist || activeTab === 'songs') && (
        <View style={styles.fixedHeader}>
          {renderTopBranding()}
          {activeTab === 'songs' && renderSongsHeader()}
          {activeTab === 'playlists' && !selectedPlaylist && renderPlaylistsHeader()}
        </View>
      )}

      {/* Live Background Sync Download Progress Banner */}
      {syncDownloading && (
        <View style={styles.liveDownloadBanner}>
          <View style={styles.liveDownloadBannerHeader}>
            <View style={styles.liveDownloadBannerTitleRow}>
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.liveDownloadBannerTitle}>
                Downloading Cloud Tracks ({syncCurrentIndex}/{syncTotalCount})
              </Text>
            </View>
            <TouchableOpacity
              onPress={cancelSyncDownload}
              style={styles.liveDownloadCancelBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle-outline" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.liveDownloadBannerSub} numberOfLines={1}>
            {syncCurrentTitle || 'Preparing track...'} • {syncProgressPct}%
          </Text>
          <View style={styles.progressBarTrack}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${
                    syncTotalCount > 0
                      ? Math.round(
                          ((syncCurrentIndex - 1 + syncProgressPct / 100) / syncTotalCount) * 100
                        )
                      : 0
                  }%`,
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Main Tab Views */}
      {activeTab === 'songs' ? (
        <FlatList
          data={tracks}
          keyExtractor={(item) => item.id}
          renderItem={({ item, index }) => {
            const isHighlighted = highlightedTrackId === item.id;
            const isSelected = selectedTrackIds.has(item.id);
            return (
              <Animated.View
                ref={(r) => {
                  if (index === 0) registerGuideTarget('first_track_item', r);
                }}
                collapsable={false}
                style={[
                  styles.trackRowContainer,
                  isHighlighted && {
                    borderWidth: 1.5,
                    borderColor: animatedBorderColor,
                    borderRadius: 10,
                    marginHorizontal: 6,
                    marginVertical: 2,
                    backgroundColor: theme.primary + '11',
                  },
                ]}
              >
                <TrackItem
                  track={item}
                  queue={tracks}
                  playbackContext={{ type: 'library', name: 'Local Offline Tracks' }}
                  onDelete={handleDeleteTrack}
                  selectionMode={selectionMode}
                  isSelected={isSelected}
                  onToggleSelect={handleToggleSelectTrack}
                  index={index}
                  totalTracks={tracks.length}
                  onMoveTrack={handleMoveTrack}
                  onLongPress={() => handleRowLongPress(item.id)}
                  onAddToPlaylist={handleOpenAddToPlaylist}
                  onPlay={() => {
                    const guideState = useGuideStore.getState();
                    if (guideState.isOpen && guideState.currentStep === 4) {
                      guideState.closeGuide();
                    }
                  }}
                />
              </Animated.View>
            );
          }}
          ListEmptyComponent={renderEmptySongsState}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        renderPlaylistsTab()
      )}

      {/* Floating Multi-Select Action Bar */}
      {selectionMode && activeTab === 'songs' && (
        <View
          style={[
            styles.floatingActionBar,
            {
              bottom: currentTrack
                ? Platform.OS === 'ios'
                  ? 148
                  : 124
                : Platform.OS === 'ios'
                ? 96
                : 74,
            },
          ]}
        >
          {/* Select All / Deselect All + Count */}
          <TouchableOpacity
            style={styles.floatingActionSelectAll}
            onPress={handleToggleSelectAll}
            activeOpacity={0.7}
          >
            <Ionicons
              name={isAllSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={isAllSelected ? theme.primary : theme.textSecondary}
            />
            <Text style={styles.floatingActionCountText}>
              {selectedTrackIds.size} selected
            </Text>
          </TouchableOpacity>

          {/* Action Buttons: + Playlist, Delete, Close */}
          <View style={styles.floatingActionButtonsGroup}>
            <TouchableOpacity
              style={[
                styles.floatingActionButton,
                selectedTrackIds.size === 0 && styles.floatingActionBtnDisabled,
              ]}
              onPress={() => setShowBatchAddToPlaylistModal(true)}
              disabled={selectedTrackIds.size === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="bookmark-outline"
                size={16}
                color={selectedTrackIds.size === 0 ? theme.textMuted : theme.textPrimary}
              />
              <Text
                style={[
                  styles.floatingActionBtnText,
                  selectedTrackIds.size === 0 && styles.floatingActionBtnTextDisabled,
                ]}
              >
                + Playlist
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.floatingActionButton,
                selectedTrackIds.size === 0 && styles.floatingActionBtnDisabled,
              ]}
              onPress={handleBatchDeleteConfirm}
              disabled={selectedTrackIds.size === 0}
              activeOpacity={0.7}
            >
              <Ionicons
                name="trash-outline"
                size={16}
                color={selectedTrackIds.size === 0 ? theme.textMuted : '#FF453A'}
              />
              <Text
                style={[
                  styles.floatingActionBtnText,
                  { color: selectedTrackIds.size === 0 ? theme.textMuted : '#FF453A' },
                ]}
              >
                Delete
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.floatingActionCloseBtn}
              onPress={handleExitSelectionMode}
              activeOpacity={0.7}
            >
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Add Music Modal (Inline Overlay with zIndex 500 so NewcomerGuideModal at zIndex 9999 renders cleanly above it) */}
      {showAddMusicModal && (
        <View style={styles.inlineModalWrapper}>
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowAddMusicModal(false)}
          >
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              <View style={styles.addMusicIconBadge}>
                <Ionicons name="musical-notes" size={24} color={theme.textPrimary} />
              </View>

              <Text style={styles.modalTitle}>Add Music</Text>
              <Text style={styles.modalSubtitle}>
                Import audio into your on-device offline music library
              </Text>

              {/* Option 1: Scan Device Storage */}
              <View
                ref={(r) => registerGuideTarget('scan_storage_button', r)}
                collapsable={false}
              >
                <TouchableOpacity
                  style={styles.addMusicOptionRow}
                  onPress={() => {
                    setShowAddMusicModal(false);
                    handleScanMusic();
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.addMusicOptionIconWrap}>
                    <Ionicons name="refresh" size={18} color={theme.textPrimary} />
                  </View>
                  <View style={styles.addMusicOptionTextGroup}>
                    <Text style={styles.addMusicOptionTitle}>Scan Device Storage</Text>
                    <Text style={styles.addMusicOptionSubtitle}>
                      Auto-detect audio files from your device folders
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>

              {/* Option 2: Import Audio Files */}
              <TouchableOpacity
                style={styles.addMusicOptionRow}
                onPress={() => {
                  setShowAddMusicModal(false);
                  handleImportAudio();
                }}
                activeOpacity={0.7}
              >
                <View style={styles.addMusicOptionIconWrap}>
                  <Ionicons name="folder-open-outline" size={18} color={theme.textPrimary} />
                </View>
                <View style={styles.addMusicOptionTextGroup}>
                  <Text style={styles.addMusicOptionTitle}>Import Audio Files</Text>
                  <Text style={styles.addMusicOptionSubtitle}>
                    Browse &amp; pick audio files via system file picker
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
              </TouchableOpacity>

              <View style={[styles.modalButtons, { marginTop: 8 }]}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowAddMusicModal(false)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* Sort Choice Modal */}
      <Modal
        visible={showSortModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSortModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowSortModal(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Sort Songs</Text>
            <Text style={styles.modalSubtitle}>Choose how your offline songs are ordered</Text>

            <TouchableOpacity
              style={[
                styles.sortOptionRow,
                sortChoice === 'last_download' && styles.sortOptionRowActive,
              ]}
              onPress={() => handleSelectSort('last_download')}
              activeOpacity={0.7}
            >
              <View style={styles.sortOptionLeft}>
                <View style={styles.sortOptionIconWrap}>
                  <Ionicons name="time-outline" size={17} color={theme.textPrimary} />
                </View>
                <View>
                  <Text style={styles.sortOptionText}>Last Download</Text>
                  <Text style={styles.sortOptionSubtext}>Newest downloaded songs first</Text>
                </View>
              </View>
              {sortChoice === 'last_download' && (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortOptionRow,
                sortChoice === 'first_download' && styles.sortOptionRowActive,
              ]}
              onPress={() => handleSelectSort('first_download')}
              activeOpacity={0.7}
            >
              <View style={styles.sortOptionLeft}>
                <View style={styles.sortOptionIconWrap}>
                  <Ionicons name="calendar-outline" size={17} color={theme.textPrimary} />
                </View>
                <View>
                  <Text style={styles.sortOptionText}>First Download</Text>
                  <Text style={styles.sortOptionSubtext}>Oldest downloaded songs first</Text>
                </View>
              </View>
              {sortChoice === 'first_download' && (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortOptionRow,
                sortChoice === 'title_asc' && styles.sortOptionRowActive,
              ]}
              onPress={() => handleSelectSort('title_asc')}
              activeOpacity={0.7}
            >
              <View style={styles.sortOptionLeft}>
                <View style={styles.sortOptionIconWrap}>
                  <Ionicons name="text-outline" size={17} color={theme.textPrimary} />
                </View>
                <View>
                  <Text style={styles.sortOptionText}>Title (A – Z)</Text>
                  <Text style={styles.sortOptionSubtext}>Alphabetical by song title</Text>
                </View>
              </View>
              {sortChoice === 'title_asc' && (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortOptionRow,
                sortChoice === 'artist_asc' && styles.sortOptionRowActive,
              ]}
              onPress={() => handleSelectSort('artist_asc')}
              activeOpacity={0.7}
            >
              <View style={styles.sortOptionLeft}>
                <View style={styles.sortOptionIconWrap}>
                  <Ionicons name="person-outline" size={17} color={theme.textPrimary} />
                </View>
                <View>
                  <Text style={styles.sortOptionText}>Artist (A – Z)</Text>
                  <Text style={styles.sortOptionSubtext}>Alphabetical by artist name</Text>
                </View>
              </View>
              {sortChoice === 'artist_asc' && (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.sortOptionRow,
                sortChoice === 'custom' && styles.sortOptionRowActive,
              ]}
              onPress={() => handleSelectSort('custom')}
              activeOpacity={0.7}
            >
              <View style={styles.sortOptionLeft}>
                <View style={styles.sortOptionIconWrap}>
                  <Ionicons name="reorder-two-outline" size={17} color={theme.textPrimary} />
                </View>
                <View>
                  <Text style={styles.sortOptionText}>Custom Order</Text>
                  <Text style={styles.sortOptionSubtext}>Manually organized list</Text>
                </View>
              </View>
              {sortChoice === 'custom' && (
                <Ionicons name="checkmark-circle" size={20} color={theme.primary} />
              )}
            </TouchableOpacity>

            <View style={[styles.modalButtons, { marginTop: 12 }]}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSortModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

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

            {/* Public / Private Discovery Toggle */}
            <TouchableOpacity
              style={styles.publicToggleRow}
              onPress={() => {
                Haptics.selectionAsync();
                setNewPlaylistIsPublic((prev) => !prev);
              }}
              activeOpacity={0.7}
            >
              <View style={styles.publicToggleLeft}>
                <Ionicons
                  name={newPlaylistIsPublic ? 'globe-outline' : 'lock-closed-outline'}
                  size={18}
                  color={newPlaylistIsPublic ? theme.primary : theme.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.publicToggleTitle}>
                    {newPlaylistIsPublic ? 'Public Playlist' : 'Private Playlist'}
                  </Text>
                  <Text style={styles.publicToggleSubtitle}>
                    {newPlaylistIsPublic
                      ? 'Discoverable by all users in Community Playlists'
                      : 'Only visible to you and users with your share code'}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.publicToggleSwitch,
                  newPlaylistIsPublic && styles.publicToggleSwitchActive,
                ]}
              >
                <View
                  style={[
                    styles.publicToggleThumb,
                    newPlaylistIsPublic && styles.publicToggleThumbActive,
                  ]}
                />
              </View>
            </TouchableOpacity>

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

      {/* Edit Playlist Name Modal */}
      <Modal
        visible={showEditNameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowEditNameModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Rename Playlist</Text>
            <Text style={styles.modalSubtitle}>
              Enter a new title for this playlist
            </Text>

            <TextInput
              style={styles.modalInput}
              value={editPlaylistNameInput}
              onChangeText={setEditPlaylistNameInput}
              placeholder="Playlist name"
              placeholderTextColor={theme.textMuted}
              maxLength={40}
              autoFocus
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowEditNameModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveEditPlaylistName}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Theme-Aware Import Shared Playlist Modal */}
      <ImportPlaylistModal
        visible={showImportModal}
        onClose={() => setShowImportModal(false)}
        onImportSuccess={async (imported) => {
          await loadPlaylists();
          handleOpenPlaylist(imported);
        }}
      />

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

      {/* Playlist Options Action Sheet Modal (••• Menu) */}
      <Modal
        visible={showPlaylistMenuModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPlaylistMenuModal(false)}
      >
        <TouchableOpacity
          style={styles.menuSheetOverlay}
          activeOpacity={1}
          onPress={() => setShowPlaylistMenuModal(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.menuSheetContent}>
            <View style={styles.menuSheetHandle} />
            <Text style={styles.menuSheetTitle} numberOfLines={1}>
              {selectedPlaylist?.name || 'Playlist Options'}
            </Text>

            {/* Edit Playlist Title */}
            <TouchableOpacity
              style={styles.menuSheetOption}
              onPress={() => {
                setShowPlaylistMenuModal(false);
                handleOpenEditPlaylistName();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="pencil-outline" size={20} color={theme.textPrimary} />
              <Text style={styles.menuSheetOptionText}>Edit Playlist Name</Text>
            </TouchableOpacity>

            {/* Change Cover Artwork */}
            <TouchableOpacity
              style={styles.menuSheetOption}
              onPress={() => {
                setShowPlaylistMenuModal(false);
                setShowPlaylistCoverActionModal(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="image-outline" size={20} color={theme.textPrimary} />
              <Text style={styles.menuSheetOptionText}>Change Cover Artwork</Text>
            </TouchableOpacity>

            {/* Share Playlist */}
            <TouchableOpacity
              style={styles.menuSheetOption}
              onPress={() => {
                setShowPlaylistMenuModal(false);
                handleSharePlaylist();
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="share-social-outline" size={20} color={theme.textPrimary} />
              <Text style={styles.menuSheetOptionText}>Share Playlist Link</Text>
            </TouchableOpacity>

            {/* Toggle Public / Private Playlist Discovery */}
            <TouchableOpacity
              style={styles.menuSheetOption}
              onPress={() => {
                setShowPlaylistMenuModal(false);
                handleToggleSelectedPlaylistPublic();
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={selectedPlaylist?.is_public ? 'lock-closed-outline' : 'globe-outline'}
                size={20}
                color={theme.textPrimary}
              />
              <Text style={styles.menuSheetOptionText}>
                {selectedPlaylist?.is_public ? 'Make Playlist Private' : 'Make Playlist Public'}
              </Text>
            </TouchableOpacity>

            {/* Sync / Update Shared Playlist */}
            {Boolean(selectedPlaylist?.share_code) && (
              <TouchableOpacity
                style={styles.menuSheetOption}
                onPress={() => {
                  setShowPlaylistMenuModal(false);
                  handleSharePlaylist();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="cloud-upload-outline" size={20} color={theme.primary} />
                <Text style={[styles.menuSheetOptionText, { color: theme.primary, fontWeight: '700' }]}>
                  Sync / Update Shared Playlist
                </Text>
              </TouchableOpacity>
            )}

            {/* Delete Playlist */}
            <TouchableOpacity
              style={styles.menuSheetOption}
              onPress={() => {
                setShowPlaylistMenuModal(false);
                if (selectedPlaylist) {
                  handleDeletePlaylistConfirm(selectedPlaylist);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={20} color="#FF453A" />
              <Text style={styles.menuSheetOptionTextDestructive}>Delete Playlist</Text>
            </TouchableOpacity>

            {/* Cancel */}
            <TouchableOpacity
              style={styles.menuSheetCancelBtn}
              onPress={() => setShowPlaylistMenuModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.menuSheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Batch Add to Playlist Modal (from Library Multi-Select Action Bar) */}
      <Modal
        visible={showBatchAddToPlaylistModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowBatchAddToPlaylistModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowBatchAddToPlaylistModal(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Add to Playlist</Text>
            <Text style={styles.modalSubtitle}>
              Select destination playlist for {selectedTrackIds.size} song
              {selectedTrackIds.size === 1 ? '' : 's'}
            </Text>

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
                playlists.map((pl) => (
                  <TouchableOpacity
                    key={pl.id}
                    style={styles.playlistItemPicker}
                    onPress={() => handleBatchAddTracksToPlaylist(pl)}
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

                    <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowBatchAddToPlaylistModal(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Multi-Select Batch Add Songs to Playlist Modal (inside Playlist Detail) */}
      <Modal
        visible={showAddSongsToPlaylistModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAddSongsToPlaylistModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowAddSongsToPlaylistModal(false)}
        >
          <View style={styles.addSongsModalContent} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Add Songs</Text>
            <Text style={styles.modalSubtitle} numberOfLines={1}>
              {selectedPlaylist?.name}
            </Text>

            {/* Select All Toggle Header */}
            <View style={styles.addSongsHeaderRow}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
                onPress={handleToggleSelectAllAddSongs}
                disabled={availableSongsForPlaylist.length === 0}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={isAllAddSongsSelected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={isAllAddSongsSelected ? theme.primary : theme.textSecondary}
                />
                <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textPrimary }}>
                  {isAllAddSongsSelected ? 'Deselect All' : 'Select All'}
                </Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                {selectedAddSongIds.size} of {availableSongsForPlaylist.length} selected
              </Text>
            </View>

            {/* Scrollable Song List with Checkboxes */}
            <ScrollView style={{ maxHeight: 300 }} nestedScrollEnabled>
              {availableSongsForPlaylist.length === 0 ? (
                <Text
                  style={{
                    color: theme.textSecondary,
                    textAlign: 'center',
                    paddingVertical: 24,
                    fontSize: 13,
                  }}
                >
                  All offline songs are already in this playlist.
                </Text>
              ) : (
                availableSongsForPlaylist.map((song) => {
                  const isChecked = selectedAddSongIds.has(song.id);
                  return (
                    <TouchableOpacity
                      key={song.id}
                      style={styles.addSongsTrackRow}
                      onPress={() => handleToggleAddSongSelection(song.id)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name={isChecked ? 'checkmark-circle' : 'ellipse-outline'}
                        size={20}
                        color={isChecked ? theme.primary : theme.textMuted}
                      />
                      <View style={{ flex: 1, marginLeft: 2 }}>
                        <Text
                          style={{
                            fontSize: 14,
                            fontWeight: '600',
                            color: theme.textPrimary,
                          }}
                          numberOfLines={1}
                        >
                          {song.title}
                        </Text>
                        <Text
                          style={{
                            fontSize: 12,
                            color: theme.textSecondary,
                            marginTop: 1,
                          }}
                          numberOfLines={1}
                        >
                          {song.artist}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 11, color: theme.textMuted }}>
                        {formatDuration(song.duration)}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {/* Sticky Bottom Actions: Cancel + Add X Songs */}
            <View style={styles.addSongsStickyFooter}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAddSongsToPlaylistModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalSaveBtn,
                  selectedAddSongIds.size === 0 && { opacity: 0.4 },
                ]}
                onPress={handleConfirmAddSongsToPlaylist}
                disabled={selectedAddSongIds.size === 0}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSaveText}>
                  Add {selectedAddSongIds.size} Song{selectedAddSongIds.size === 1 ? '' : 's'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
