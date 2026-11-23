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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { getAllTracks } from '@/repositories/trackRepository';
import {
  fetchSharedPlaylist,
  importSharedPlaylist,
  fetchPublicPlaylists,
  normalizeShareCode,
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

  const cleanBadge = useMemo(() => {
    const raw = importCodeInput.trim();
    if (!raw) return null;
    const norm = normalizeShareCode(raw);
    return norm.startsWith('JST-') && norm.length === 8 ? norm : null;
  }, [importCodeInput]);

  // Load community playlists when switching to community tab or when modal opens
  const loadCommunityPlaylists = useCallback(async () => {
    setIsLoadingCommunity(true);
    try {
      const publicLists = await fetchPublicPlaylists(30);
      setCommunityPlaylists(publicLists);
    } catch (e) {
      console.warn('Failed to fetch community playlists:', e);
    } finally {
      setIsLoadingCommunity(false);
    }
  }, []);

  const handleClose = useCallback(() => {
    setImportCodeInput('');
    setSharedPreview(null);
    setImportError(null);
    setIsImportingShared(false);
    setIsDownloadingShared(false);
    setActiveTab('code');
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible) return;
    let isCancelled = false;
    (async () => {
      try {
        const publicLists = await fetchPublicPlaylists(30);
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
  }, [visible]);

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
            await downloadTrackToOfflineLibrary(onlineTrack, (pct) => {
              setDownloadSharedProgress((prev) => ({
                ...prev,
                pct: Math.min(100, Math.max(0, Math.round(pct))),
              }));
            });
          } catch (dlErr) {
            console.warn(`[ImportShared] Could not download "${track.title}":`, dlErr);
          }
        }
      }

      const allUpdated = await getAllTracks().catch(() => []);
      if (allUpdated.length > 0) {
        usePlayerStore.getState().setTracks(allUpdated);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onImportSuccess(imported);
      handleClose();
    } catch (e: any) {
      setImportError(e.message || 'Failed to download and import playlist.');
    } finally {
      setIsDownloadingShared(false);
    }
  };

  const handleSelectCommunityPlaylist = (item: SharedPlaylistData) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharedPreview(item);
    setActiveTab('code');
    setImportCodeInput(item.share_code);
    setImportError(null);
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      statusBarTranslucent={true}
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
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
                loadCommunityPlaylists();
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

          {/* TAB 1: ENTER CODE & PREVIEW */}
          {activeTab === 'code' && (
            <>
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
                      <Ionicons name="alert-circle-outline" size={16} color="#FF9500" />
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
            </>
          )}

          {/* TAB 2: COMMUNITY PLAYLISTS DISCOVERY */}
          {activeTab === 'community' && (
            <ScrollView style={styles.communityList} showsVerticalScrollIndicator={false}>
              {isLoadingCommunity ? (
                <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                  <ActivityIndicator size="small" color={theme.primary} />
                  <Text style={{ marginTop: 8, fontSize: 12, color: theme.textSecondary }}>
                    Loading community playlists...
                  </Text>
                </View>
              ) : communityPlaylists.length === 0 ? (
                <Text style={styles.emptyCommunityText}>
                  No public community playlists discovered yet. Be the first to publish one!
                </Text>
              ) : (
                communityPlaylists.map((pl) => (
                  <TouchableOpacity
                    key={pl.id}
                    style={styles.communityCard}
                    onPress={() => handleSelectCommunityPlaylist(pl)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.communityCover}>
                      {pl.cover_url ? (
                        <Image
                          source={{ uri: pl.cover_url }}
                          style={styles.communityCoverImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <Ionicons name="albums-outline" size={20} color={theme.textSecondary} />
                      )}
                    </View>

                    <View style={styles.communityInfo}>
                      <Text style={styles.communityTitle} numberOfLines={1}>
                        {pl.name}
                      </Text>
                      <Text style={styles.communityMeta}>
                        {pl.tracks.length} song{pl.tracks.length === 1 ? '' : 's'} • {pl.share_code}
                      </Text>
                    </View>

                    <TouchableOpacity
                      style={styles.communityImportBtn}
                      onPress={() => handleSelectCommunityPlaylist(pl)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="cloud-download-outline" size={13} color={theme.textPrimary} />
                      <Text style={styles.communityImportBtnText}>Preview</Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          )}

          {/* Footer Action Buttons */}
          <View style={styles.modalButtons}>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={onClose}
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
                    <Text style={styles.modalSecondaryActionText}>Import Only</Text>
                  )}
                </TouchableOpacity>

                {/* Primary Button: Download & Import */}
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
                    <Text style={styles.modalSaveText}>Download &amp; Import</Text>
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
