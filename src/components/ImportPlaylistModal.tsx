import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  ScrollView,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { getAllTracks } from '@/repositories/trackRepository';
import { getAllPlaylists } from '@/lib/database';
import {
  fetchSharedPlaylist,
  importSharedPlaylist,
  fetchPublicPlaylists,
  normalizeShareCode,
  togglePlaylistLike,
  SharedPlaylistData,
} from '@/services/playlistSyncService';
import { downloadTrackToOfflineLibrary, OnlineTrackResult } from '@/services/musicDownloadService';
import { Playlist } from '@/types/music';
import { createStyles } from './ImportPlaylistModal.styles';

export interface ImportPlaylistModalProps {
  visible: boolean;
  onClose: () => void;
  onImportSuccess: (importedPlaylist: Playlist) => void;
}

type ImportTab = 'code' | 'community';

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function ImportPlaylistModal({
  visible,
  onClose,
  onImportSuccess,
}: ImportPlaylistModalProps) {
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const isDark = mode === 'dark';
  const styles = useMemo(() => createStyles(theme), [theme]);

  const [activeTab, setActiveTab] = useState<ImportTab>('code');
  const [importCodeInput, setImportCodeInput] = useState('');
  const [isSearchingShared, setIsSearchingShared] = useState(false);
  const [sharedPreview, setSharedPreview] = useState<SharedPlaylistData | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportingShared, setIsImportingShared] = useState(false);
  const [isDownloadingShared, setIsDownloadingShared] = useState(false);
  const [downloadSharedProgress, setDownloadSharedProgress] = useState({
    current: 0,
    total: 0,
    title: '',
    pct: 0,
  });

  // Community Playlists Discovery
  const [communityPlaylists, setCommunityPlaylists] = useState<SharedPlaylistData[]>([]);
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false);
  const [communitySort, setCommunitySort] = useState<'top' | 'newest'>('top');
  const [communitySearchQuery, setCommunitySearchQuery] = useState('');
  const [localPlaylists, setLocalPlaylists] = useState<Playlist[]>([]);
  const [importingCardId, setImportingCardId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      getAllPlaylists().then(setLocalPlaylists).catch(() => {});
    }
  }, [visible]);

  const existingShareCodes = useMemo(() => {
    const codeSet = new Set<string>();
    for (const pl of localPlaylists) {
      if (pl.share_code) {
        codeSet.add(normalizeShareCode(pl.share_code));
      }
    }
    return codeSet;
  }, [localPlaylists]);

  const isSharedPreviewImported = useMemo(() => {
    if (!sharedPreview?.share_code) return false;
    return existingShareCodes.has(normalizeShareCode(sharedPreview.share_code));
  }, [sharedPreview, existingShareCodes]);

  const [likingInFlight, setLikingInFlight] = useState<Set<string>>(new Set());

  const cleanBadge = useMemo(() => {
    const raw = importCodeInput.trim();
    if (!raw) return null;
    const norm = normalizeShareCode(raw);
    return norm.startsWith('JST-') && norm.length === 8 ? norm : null;
  }, [importCodeInput]);

  const handleToggleLike = useCallback(async (item: SharedPlaylistData) => {
    if (likingInFlight.has(item.id)) return;
    setLikingInFlight((prev) => new Set(prev).add(item.id));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const currentlyLiked = Boolean(item.is_liked);
    const nextLiked = !currentlyLiked;
    const nextCount = Math.max(0, (item.likes_count ?? 0) + (nextLiked ? 1 : -1));

    // Optimistic UI updates
    setCommunityPlaylists((prev) =>
      prev.map((p) =>
        p.id === item.id ? { ...p, is_liked: nextLiked, likes_count: nextCount } : p
      )
    );

    setSharedPreview((prev) =>
      prev && prev.id === item.id
        ? { ...prev, is_liked: nextLiked, likes_count: nextCount }
        : prev
    );

    try {
      const res = await togglePlaylistLike(item.id, currentlyLiked);
      setCommunityPlaylists((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, is_liked: res.liked, likes_count: res.likes_count } : p
        )
      );
      setSharedPreview((prev) =>
        prev && prev.id === item.id
          ? { ...prev, is_liked: res.liked, likes_count: res.likes_count }
          : prev
      );
    } catch (err) {
      console.warn('Failed to toggle like:', err);
    } finally {
      setLikingInFlight((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [likingInFlight]);

  // Filtered & Sorted Community Playlists
  const filteredCommunityPlaylists = useMemo(() => {
    let lists = [...communityPlaylists];

    if (communitySort === 'top') {
      lists = lists.sort((a, b) => {
        const diff = (b.likes_count ?? 0) - (a.likes_count ?? 0);
        if (diff !== 0) return diff;
        const timeB = b.updated_at
          ? new Date(b.updated_at).getTime()
          : new Date(b.created_at).getTime();
        const timeA = a.updated_at
          ? new Date(a.updated_at).getTime()
          : new Date(a.created_at).getTime();
        return timeB - timeA;
      });
    } else {
      lists = lists.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const q = communitySearchQuery.trim().toLowerCase();
    if (!q) return lists;

    return lists.filter((p) => {
      const matchName = (p.name || '').toLowerCase().includes(q);
      const matchCode = (p.share_code || '').toLowerCase().includes(q);
      return matchName || matchCode;
    });
  }, [communityPlaylists, communitySort, communitySearchQuery]);

  // Load community playlists when switching to community tab, sort change, or when modal opens
  const loadCommunityPlaylists = useCallback(async (sortChoice?: 'top' | 'newest') => {
    setIsLoadingCommunity(true);
    try {
      const targetSort = sortChoice ?? communitySort;
      const publicLists = await fetchPublicPlaylists(30, targetSort);
      setCommunityPlaylists(publicLists);
      const stored = await getAllPlaylists().catch(() => []);
      setLocalPlaylists(stored);
    } catch (e) {
      console.warn('Failed to fetch community playlists:', e);
    } finally {
      setIsLoadingCommunity(false);
    }
  }, [communitySort]);

  const handleDirectImportCommunity = useCallback(
    async (item: SharedPlaylistData) => {
      if (importingCardId) return;
      setImportingCardId(item.id);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      try {
        const imported = await importSharedPlaylist(item);
        const stored = await getAllPlaylists().catch(() => []);
        setLocalPlaylists(stored);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onImportSuccess(imported);
      } catch (err: any) {
        console.warn('Failed to import community playlist directly:', err);
      } finally {
        setImportingCardId(null);
      }
    },
    [importingCardId, onImportSuccess]
  );

  const handleClose = useCallback(() => {
    setImportCodeInput('');
    setSharedPreview(null);
    setImportError(null);
    setIsImportingShared(false);
    setIsDownloadingShared(false);
    setCommunitySearchQuery('');
    setActiveTab('code');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    let isCancelled = false;
    (async () => {
      try {
        const publicLists = await fetchPublicPlaylists(30, communitySort);
        if (!isCancelled) {
          setCommunityPlaylists(publicLists);
        }
      } catch (e) {
        console.warn('Failed to fetch community playlists:', e);
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [visible, communitySort]);

  const handleSearchShared = async (targetCode?: string) => {
    const codeToSearch = (targetCode || importCodeInput).trim();
    if (!codeToSearch) {
      setImportError('Please enter a share code or playlist link.');
      return;
    }

    setImportError(null);
    setIsSearchingShared(true);

    try {
      const data = await fetchSharedPlaylist(codeToSearch);
      setSharedPreview(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setImportError(e.message || 'Could not find playlist with this code.');
      setSharedPreview(null);
    } finally {
      setIsSearchingShared(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const clipboardContent = await Clipboard.getStringAsync();
      if (!clipboardContent) return;
      Haptics.selectionAsync();

      const normalized = normalizeShareCode(clipboardContent);
      setImportCodeInput(normalized);
      setImportError(null);
      handleSearchShared(normalized);
    } catch (e) {
      console.warn('Failed to paste from clipboard:', e);
    }
  };

  const handleConfirmImportOnly = async () => {
    if (!sharedPreview || sharedPreview.tracks.length === 0) return;
    setIsImportingShared(true);

    try {
      const imported = await importSharedPlaylist(sharedPreview);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onImportSuccess(imported);
      handleClose();
    } catch (e: any) {
      setImportError(e.message || 'Failed to import playlist.');
    } finally {
      setIsImportingShared(false);
    }
  };

  const handleDownloadAndImport = async () => {
    if (!sharedPreview || sharedPreview.tracks.length === 0) return;
    setIsDownloadingShared(true);
    setDownloadSharedProgress({
      current: 0,
      total: sharedPreview.tracks.length,
      title: 'Preparing...',
      pct: 0,
    });

    try {
      const imported = await importSharedPlaylist(sharedPreview);

      const currentOfflineTracks = await getAllTracks().catch(() => []);
      for (let i = 0; i < sharedPreview.tracks.length; i++) {
        const track = sharedPreview.tracks[i];
        setDownloadSharedProgress({
          current: i + 1,
          total: sharedPreview.tracks.length,
          title: track.title,
          pct: 0,
        });

        // Zero-duplicate check
        const normTitle = (track.title || '').trim().toLowerCase();
        const normArtist = (track.artist || '').trim().toLowerCase();
        const alreadyDownloaded = currentOfflineTracks.find((loc) => {
          if (loc.id === track.id && loc.local_audio_uri) return true;
          if (track.youtube_id && loc.youtube_id === track.youtube_id && loc.local_audio_uri) return true;
          const locTitle = (loc.title || '').trim().toLowerCase();
          const locArtist = (loc.artist || '').trim().toLowerCase();
          return locTitle === normTitle && locArtist === normArtist && !!loc.local_audio_uri;
        });

        if (alreadyDownloaded) {
          continue;
        }

        const onlineId =
          track.youtube_id ||
          (track.id.startsWith('online_youtube_')
            ? track.id.replace('online_youtube_', '')
            : track.id.startsWith('track_yt_')
            ? track.id.replace(/^track_yt_/, '')
            : track.id.startsWith('yt_')
            ? track.id.replace(/^yt_/, '')
            : null);

        if (onlineId || track.title) {
          try {
            const onlineTrack: OnlineTrackResult = {
              id: onlineId || `query_${encodeURIComponent(track.title)}`,
              title: track.title,
              artist: track.artist || 'Unknown Artist',
              duration: track.duration || 0,
              thumbnailUrl: track.local_artwork_uri,
              source: 'youtube',
            };
            await downloadTrackToOfflineLibrary(
              onlineTrack,
              (pct) => {
                setDownloadSharedProgress((prev) => ({
                  ...prev,
                  pct: Math.min(100, Math.max(0, Math.round(pct))),
                }));
              },
              { isPlaylistOnly: true, targetTrackId: track.id }
            );
          } catch (dlErr) {
            console.warn(`[ImportShared] Could not download "${track.title}":`, dlErr);
          }
        }
      }

      // Re-read personal offline library (which filters WHERE is_playlist_only = 0)
      const allPersonalTracks = await getAllTracks().catch(() => []);
      usePlayerStore.getState().setTracks(allPersonalTracks);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onImportSuccess(imported);
      handleClose();
    } catch (e: any) {
      setImportError(e.message || 'Failed to download and import playlist.');
    } finally {
      setIsDownloadingShared(false);
    }
  };

  const handleSelectCommunityPlaylist = useCallback((item: SharedPlaylistData) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharedPreview(item);
    setActiveTab('code');
    setImportCodeInput(item.share_code);
    setImportError(null);
  }, []);

  const renderCommunityCard = useCallback(
    ({ item, index }: { item: SharedPlaylistData; index: number }) => {
      const isTopRank = communitySort === 'top' && !communitySearchQuery.trim();
      const isTop1 = isTopRank && index === 0 && (item.likes_count ?? 0) > 0;
      const isTop2 = isTopRank && index === 1 && (item.likes_count ?? 0) > 0;
      const isTop3 = isTopRank && index === 2 && (item.likes_count ?? 0) > 0;
      const isPlImported = item.share_code
        ? existingShareCodes.has(normalizeShareCode(item.share_code))
        : false;

      return (
        <TouchableOpacity
          style={styles.communityCard}
          onPress={() => handleSelectCommunityPlaylist(item)}
          activeOpacity={0.7}
        >
          {/* Left: 48x48 Rounded Cover Thumbnail */}
          <View style={styles.communityCover}>
            {item.cover_url ? (
              <Image
                source={{ uri: item.cover_url }}
                style={styles.communityCoverImage}
                resizeMode="cover"
              />
            ) : item.tracks.length > 0 && item.tracks[0].local_artwork_uri ? (
              <Image
                source={{ uri: item.tracks[0].local_artwork_uri }}
                style={styles.communityCoverImage}
                resizeMode="cover"
              />
            ) : (
              <Ionicons name="musical-notes-outline" size={22} color={theme.textSecondary} />
            )}
          </View>

          {/* Middle: 2-Line Column */}
          <View style={styles.communityInfo}>
            {/* Line 1: Full Playlist Title */}
            <Text style={styles.communityTitle} numberOfLines={1}>
              {item.name}
            </Text>

            {/* Line 2: Inline Metadata (Rank badge if top 3 + song count • share code) */}
            <View style={styles.communityMetaRow}>
              {isTop1 && (
                <View style={styles.rankBadge}>
                  <Text style={styles.rankBadgeText}>#1</Text>
                </View>
              )}
              {isTop2 && (
                <View style={styles.rankBadge}>
                  <Text style={styles.rankBadgeText}>#2</Text>
                </View>
              )}
              {isTop3 && (
                <View style={styles.rankBadge}>
                  <Text style={styles.rankBadgeText}>#3</Text>
                </View>
              )}
              <Text style={styles.communityMeta} numberOfLines={1}>
                {item.tracks.length} song{item.tracks.length === 1 ? '' : 's'} • {item.share_code}
              </Text>
            </View>
          </View>

          {/* Right: Aligned Pill Controls */}
          <View style={styles.communityActionsRow}>
            {/* Interactive Heart Pill */}
            <TouchableOpacity
              style={styles.communityHeartBtn}
              onPress={() => handleToggleLike(item)}
              activeOpacity={0.7}
              disabled={likingInFlight.has(item.id)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              accessibilityLabel="Like playlist"
            >
              <Ionicons
                name={item.is_liked ? 'heart' : 'heart-outline'}
                size={13}
                color={item.is_liked ? '#FF3B30' : theme.textSecondary}
              />
              <Text
                style={[
                  styles.communityHeartText,
                  item.is_liked && styles.communityHeartTextActive,
                ]}
              >
                {item.likes_count ?? 0}
              </Text>
            </TouchableOpacity>

            {/* Import / Imported Badge Button */}
            {isPlImported ? (
              <View style={styles.importedBadge}>
                <Ionicons
                  name="checkmark"
                  size={11}
                  color={isDark ? '#D4D4D8' : '#3F3F46'}
                />
                <Text style={styles.importedBadgeText}>Imported</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.communityImportBtn}
                onPress={() => handleDirectImportCommunity(item)}
                disabled={importingCardId === item.id}
                activeOpacity={0.8}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                {importingCardId === item.id ? (
                  <ActivityIndicator size="small" color={theme.textPrimary} />
                ) : (
                  <>
                    <Ionicons name="cloud-download-outline" size={13} color={theme.textPrimary} />
                    <Text style={styles.communityImportBtnText}>Import</Text>
                  </>
                )}
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [
      communitySort,
      communitySearchQuery,
      existingShareCodes,
      theme,
      styles,
      handleSelectCommunityPlaylist,
      handleToggleLike,
      handleDirectImportCommunity,
      importingCardId,
      isDark,
      likingInFlight,
    ]
  );

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="slide"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
          {/* Top Sheet Drag Handle Pill */}
          <View style={styles.sheetDragHandleContainer}>
            <View style={styles.sheetDragHandle} />
          </View>

          {/* Header Row */}
          <View style={styles.headerRow}>
            <Text style={styles.modalTitle}>Import Playlist</Text>
            <TouchableOpacity
              style={styles.closeIconButton}
              onPress={handleClose}
              disabled={isDownloadingShared || isImportingShared}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalSubtitle}>
            Import shared custom playlists from friends or explore public community collections
          </Text>

          {/* Segmented Navigation Tabs */}
          <View style={styles.navTabsRow}>
            <TouchableOpacity
              style={[styles.navTabItem, activeTab === 'code' && styles.navTabItemActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab('code');
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="key-outline"
                size={14}
                color={activeTab === 'code' ? theme.textPrimary : theme.textSecondary}
              />
              <Text
                style={[
                  styles.navTabText,
                  activeTab === 'code' && styles.navTabTextActive,
                ]}
              >
                Enter Code
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.navTabItem, activeTab === 'community' && styles.navTabItemActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveTab('community');
                loadCommunityPlaylists(communitySort);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="globe-outline"
                size={14}
                color={activeTab === 'community' ? theme.textPrimary : theme.textSecondary}
              />
              <Text
                style={[
                  styles.navTabText,
                  activeTab === 'community' && styles.navTabTextActive,
                ]}
              >
                Community ({communityPlaylists.length})
              </Text>
            </TouchableOpacity>
          </View>

          {/* TAB CONTENT CONTAINER (FLEX: 1) */}
          <View style={styles.tabContentContainer}>
            {/* TAB 1: ENTER CODE & PREVIEW */}
            {activeTab === 'code' && (
              <ScrollView
                style={styles.codeTabScroll}
                contentContainerStyle={{ paddingBottom: 16 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Input Area with Quick Paste */}
                <View style={styles.inputContainer}>
                  <View style={styles.inputWrapper}>
                    <TextInput
                      style={styles.input}
                      value={importCodeInput}
                      onChangeText={(t) => {
                        setImportCodeInput(t);
                        if (importError) setImportError(null);
                      }}
                      placeholder="JST-XXXX or link..."
                      placeholderTextColor={theme.textMuted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                    />

                    {/* Quick-action Paste Button */}
                    <TouchableOpacity
                      style={styles.pasteButton}
                      onPress={handlePasteClipboard}
                      activeOpacity={0.7}
                      accessibilityLabel="Paste from clipboard"
                    >
                      <Ionicons name="clipboard-outline" size={13} color={theme.textSecondary} />
                      <Text style={styles.pasteButtonText}>Paste</Text>
                    </TouchableOpacity>

                    {/* Find Button */}
                    <TouchableOpacity
                      style={styles.findButton}
                      onPress={() => handleSearchShared()}
                      disabled={isSearchingShared}
                      activeOpacity={0.8}
                    >
                      {isSearchingShared ? (
                        <ActivityIndicator size="small" color={theme.onPrimary} />
                      ) : (
                        <Text style={styles.findButtonText}>Find</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Clean Code Badge */}
                  {cleanBadge && (
                    <View style={styles.cleanCodeBadgeRow}>
                      <Text style={{ fontSize: 11, color: theme.textSecondary }}>Code detected:</Text>
                      <View style={styles.codeBadge}>
                        <Text style={styles.codeBadgeText}>{cleanBadge}</Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Error Message */}
                {importError && (
                  <View
                    style={[
                      styles.messageBox,
                      {
                        backgroundColor: 'rgba(255, 69, 58, 0.1)',
                        borderColor: 'rgba(255, 69, 58, 0.3)',
                      },
                    ]}
                  >
                    <Ionicons name="alert-circle-outline" size={16} color="#FF453A" />
                    <Text style={[styles.messageText, { color: '#FF453A' }]}>{importError}</Text>
                  </View>
                )}

                {/* Shared Preview Card */}
                {sharedPreview && (
                  <View style={styles.previewCard}>
                    {/* Playlist Header */}
                    <View style={styles.previewHeader}>
                      <View style={styles.previewCover}>
                        {sharedPreview.cover_url ? (
                          <Image
                            source={{ uri: sharedPreview.cover_url }}
                            style={styles.previewCoverImage}
                            resizeMode="cover"
                          />
                        ) : sharedPreview.tracks.length > 0 && sharedPreview.tracks[0].local_artwork_uri ? (
                          <Image
                            source={{ uri: sharedPreview.tracks[0].local_artwork_uri }}
                            style={styles.previewCoverImage}
                            resizeMode="cover"
                          />
                        ) : (
                          <Ionicons name="albums-outline" size={22} color={theme.textSecondary} />
                        )}
                      </View>
                      <View style={styles.previewInfo}>
                        <Text style={styles.previewTitle} numberOfLines={1}>
                          {sharedPreview.name}
                        </Text>
                        <View style={styles.previewMetaRow}>
                          <Text style={styles.previewSubtitle}>
                            {sharedPreview.tracks.length} song
                            {sharedPreview.tracks.length === 1 ? '' : 's'}
                          </Text>
                          <Text style={[styles.previewSubtitle, { opacity: 0.5 }]}>•</Text>
                          <View style={styles.codeBadge}>
                            <Text style={styles.codeBadgeText}>{sharedPreview.share_code}</Text>
                          </View>
                          {isSharedPreviewImported && (
                            <View style={styles.importedBadge}>
                              <Ionicons
                                name="checkmark"
                                size={11}
                                color={isDark ? '#D4D4D8' : '#3F3F46'}
                              />
                              <Text style={styles.importedBadgeText}>Imported</Text>
                            </View>
                          )}
                          <TouchableOpacity
                            style={styles.previewHeartBtn}
                            onPress={() => handleToggleLike(sharedPreview)}
                            activeOpacity={0.7}
                            disabled={likingInFlight.has(sharedPreview.id)}
                            accessibilityLabel="Like playlist"
                          >
                            <Ionicons
                              name={sharedPreview.is_liked ? 'heart' : 'heart-outline'}
                              size={13}
                              color={sharedPreview.is_liked ? '#FF3B30' : theme.textSecondary}
                            />
                            <Text
                              style={[
                                styles.previewHeartText,
                                sharedPreview.is_liked && styles.previewHeartTextActive,
                              ]}
                            >
                              {sharedPreview.likes_count ?? 0}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {/* First 3 Track Titles Preview */}
                    {sharedPreview.tracks.length > 0 ? (
                      <View style={styles.previewTrackList}>
                        {sharedPreview.tracks.slice(0, 3).map((track, idx) => (
                          <View key={track.id || idx} style={styles.previewTrackItem}>
                            <Text style={styles.previewTrackNumber}>{idx + 1}</Text>
                            <Text style={styles.previewTrackTitle} numberOfLines={1}>
                              {track.title}
                            </Text>
                            <Text style={styles.previewTrackArtist} numberOfLines={1}>
                              {track.artist}
                            </Text>
                            <Text style={styles.previewTrackDuration}>
                              {formatDuration(track.duration)}
                            </Text>
                          </View>
                        ))}

                        {sharedPreview.tracks.length > 3 && (
                          <Text style={styles.moreSongsText}>
                            + {sharedPreview.tracks.length - 3} more song
                            {sharedPreview.tracks.length - 3 === 1 ? '' : 's'}
                          </Text>
                        )}
                      </View>
                    ) : (
                      /* Zero Songs Warning */
                      <View style={styles.zeroSongsBanner}>
                        <Ionicons name="information-circle-outline" size={16} color={theme.textSecondary} />
                        <Text style={styles.zeroSongsText}>
                          This playlist has 0 synced songs yet. Ask the creator to tap Update Shared Playlist.
                        </Text>
                      </View>
                    )}

                    {/* In-Modal Download Progress */}
                    {isDownloadingShared && (
                      <View style={styles.downloadProgressContainer}>
                        <View style={styles.downloadProgressHeader}>
                          <Text style={styles.downloadProgressText} numberOfLines={1}>
                            Downloading {downloadSharedProgress.current}/
                            {downloadSharedProgress.total}: {downloadSharedProgress.title}
                          </Text>
                          <Text style={styles.downloadProgressPct}>
                            {downloadSharedProgress.pct}%
                          </Text>
                        </View>
                        <View style={styles.progressBarTrack}>
                          <View
                            style={[
                              styles.progressBarFill,
                              {
                                width: `${
                                  downloadSharedProgress.total > 0
                                    ? Math.round(
                                        ((downloadSharedProgress.current -
                                          1 +
                                          downloadSharedProgress.pct / 100) /
                                          downloadSharedProgress.total) *
                                          100
                                      )
                                    : 0
                                }%`,
                              },
                            ]}
                          />
                        </View>
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
            )}

            {/* TAB 2: COMMUNITY PLAYLISTS DISCOVERY */}
            {activeTab === 'community' && (
              <View style={styles.communityTabContainer}>
                {/* Instant Search Bar */}
                <View style={styles.communitySearchWrapper}>
                  <Ionicons name="search" size={15} color={theme.textMuted} />
                  <TextInput
                    style={styles.communitySearchInput}
                    value={communitySearchQuery}
                    onChangeText={setCommunitySearchQuery}
                    placeholder="Search community playlists or codes..."
                    placeholderTextColor={theme.textMuted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    clearButtonMode="while-editing"
                  />
                  {communitySearchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => setCommunitySearchQuery('')}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close-circle" size={15} color={theme.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Sort Filter Toggle Row */}
                <View style={styles.communitySortRow}>
                  <Text style={styles.communitySortLabel}>Sort By:</Text>
                  <View style={styles.communitySortButtons}>
                    <TouchableOpacity
                      style={[
                        styles.communitySortBtn,
                        communitySort === 'top' && styles.communitySortBtnActive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCommunitySort('top');
                        loadCommunityPlaylists('top');
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="flame"
                        size={12}
                        color={communitySort === 'top' ? theme.primary : theme.textSecondary}
                      />
                      <Text
                        style={[
                          styles.communitySortBtnText,
                          communitySort === 'top' && styles.communitySortBtnTextActive,
                        ]}
                      >
                        Top Recommended
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.communitySortBtn,
                        communitySort === 'newest' && styles.communitySortBtnActive,
                      ]}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setCommunitySort('newest');
                        loadCommunityPlaylists('newest');
                      }}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="time-outline"
                        size={12}
                        color={communitySort === 'newest' ? theme.primary : theme.textSecondary}
                      />
                      <Text
                        style={[
                          styles.communitySortBtnText,
                          communitySort === 'newest' && styles.communitySortBtnTextActive,
                        ]}
                      >
                        Newest
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Smooth FlatList */}
                <FlatList
                  data={filteredCommunityPlaylists}
                  keyExtractor={(item) => item.id}
                  renderItem={renderCommunityCard}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 24, gap: 10 }}
                  ListEmptyComponent={
                    isLoadingCommunity ? (
                      <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                        <ActivityIndicator size="small" color={theme.primary} />
                        <Text style={{ marginTop: 10, fontSize: 13, color: theme.textSecondary }}>
                          Loading community playlists...
                        </Text>
                      </View>
                    ) : (
                      <View style={{ paddingVertical: 40, alignItems: 'center', paddingHorizontal: 20 }}>
                        <Ionicons name="search-outline" size={32} color={theme.textMuted} />
                        <Text style={[styles.emptyCommunityText, { marginTop: 8 }]}>
                          {communitySearchQuery.trim()
                            ? `No playlists match "${communitySearchQuery.trim()}"`
                            : 'No public community playlists discovered yet. Be the first to publish one!'}
                        </Text>
                      </View>
                    )
                  }
                />
              </View>
            )}
          </View>

          {/* Fixed Footer Action Buttons */}
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={handleClose}
              disabled={isDownloadingShared || isImportingShared}
              activeOpacity={0.7}
            >
              <Text style={styles.modalCancelText}>Close</Text>
            </TouchableOpacity>

            {sharedPreview && activeTab === 'code' && (
              <View style={styles.modalActionButtonsRow}>
                {/* Secondary Button: Import Only */}
                <TouchableOpacity
                  style={[
                    styles.modalSecondaryActionBtn,
                    sharedPreview.tracks.length === 0 && { opacity: 0.35 },
                  ]}
                  onPress={handleConfirmImportOnly}
                  disabled={
                    sharedPreview.tracks.length === 0 ||
                    isImportingShared ||
                    isDownloadingShared
                  }
                  activeOpacity={0.8}
                >
                  {isImportingShared ? (
                    <ActivityIndicator size="small" color={theme.textPrimary} />
                  ) : (
                    <Text style={styles.modalSecondaryActionText}>
                      {isSharedPreviewImported ? 'Sync Updates' : 'Import Only'}
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Primary Button: Download & Import / Sync & Download */}
                <TouchableOpacity
                  style={[
                    styles.modalSaveBtn,
                    sharedPreview.tracks.length === 0 && styles.modalSaveBtnDisabled,
                  ]}
                  onPress={handleDownloadAndImport}
                  disabled={
                    sharedPreview.tracks.length === 0 ||
                    isImportingShared ||
                    isDownloadingShared
                  }
                  activeOpacity={0.8}
                >
                  {isDownloadingShared ? (
                    <ActivityIndicator size="small" color={theme.onPrimary} />
                  ) : (
                    <Text style={styles.modalSaveText}>
                      {isSharedPreviewImported ? 'Sync & Download' : 'Download & Import'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
