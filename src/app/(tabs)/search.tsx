import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAllTracks } from '@/repositories/trackRepository';
import {
  searchOnlineTracks,
  downloadTrackToOfflineLibrary,
  cancelTrackDownload,
  resolveOnlineStreamUrl,
  OnlineTrackResult,
} from '@/services/musicDownloadService';
import { Track } from '@/types/music';
import { resumeAudio } from '@/services/audioService';
import ConfirmModal from '@/components/ConfirmModal';
import { setSetting } from '@/lib/database';
import { usePlayerStore } from '@/store/playerStore';
import { registerGuideTarget, useGuideStore } from '@/store/guideStore';
import { useThemeStore } from '@/store/themeStore';
import { createStyles } from '@/styles/search.styles';

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function findDemoTargetTrack(results: OnlineTrackResult[]): OnlineTrackResult | undefined {
  const candidates = results.filter((item) => {
    const title = (item.title || '').toLowerCase();
    const artist = (item.artist || '').toLowerCase();
    const matchesTitle = title.includes('about you');
    const matchesArtist = artist.includes('1975') || title.includes('1975');
    return matchesTitle && matchesArtist;
  });

  if (candidates.length === 0) {
    return (
      results.find((item) => (item.title || '').toLowerCase().includes('about you')) || results[0]
    );
  }

  // Filter out lyrics uploads if official or original versions exist
  const nonLyrics = candidates.filter((item) => {
    const title = (item.title || '').toLowerCase();
    return !title.includes('lyrics') && !title.includes('lyric');
  });

  const pool = nonLyrics.length > 0 ? nonLyrics : candidates;
  const topicOrOfficial = pool.filter((item) => {
    const artist = (item.artist || '').toLowerCase();
    const title = (item.title || '').toLowerCase();
    return (
      artist.includes('topic') ||
      artist.includes('the 1975') ||
      title.includes('official') ||
      artist === 'the 1975'
    );
  });

  if (topicOrOfficial.length > 0) {
    return topicOrOfficial[0];
  }
  return pool[0];
}

export default function SearchScreen() {
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Player store bindings
  const offlineTracks = usePlayerStore((state) => state.tracks);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);

  // Theme-adaptive logo for watermark
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [onlineResults, setOnlineResults] = useState<OnlineTrackResult[]>([]);
  const [downloadingMap, setDownloadingMap] = useState<Record<string, number>>({});
  const [resolvingTrackId, setResolvingTrackId] = useState<string | null>(null);

  // Error modal state
  const [modalConfig, setModalConfig] = useState<{
    visible: boolean;
    title: string;
    message: string;
    icon?: keyof typeof Ionicons.glyphMap;
  }>({
    visible: false,
    title: '',
    message: '',
    icon: 'alert-circle-outline',
  });

  // Initial load of offline tracks into playerStore
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const stored = await getAllTracks();
        if (isMounted) {
          usePlayerStore.getState().setTracks(stored);
        }
      } catch (e) {
        console.warn('Failed to load local tracks:', e);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  const displayedOnlineTracks = useMemo(() => {
    if (!query.trim()) {
      return [];
    }
    return onlineResults;
  }, [query, onlineResults]);

  // Guide demo store bindings
  const demoAction = useGuideStore((state) => state.demoAction);
  const demoNonce = useGuideStore((state) => state.demoNonce);
  const lastTriggeredNonceRef = useRef<number>(-1);

  // Debounced search effect
  const handleResultsLoaded = (results: OnlineTrackResult[]) => {
    setOnlineResults(results);
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    let isCancelled = false;

    const fetchOnline = async () => {
      setIsSearching(true);
      try {
        const results = await searchOnlineTracks(trimmed);
        if (!isCancelled) {
          handleResultsLoaded(results);
        }
      } catch (err: any) {
        if (!isCancelled) {
          setModalConfig({
            visible: true,
            title: 'Search Catalog Error',
            message:
              err?.message ||
              'Unable to retrieve tracks from the online catalog. Please verify your connection.',
            icon: 'cloud-offline-outline',
          });
        }
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    };

    const timer = setTimeout(fetchOnline, 400);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  // Demo Walkthrough Automation: Step 3 autofill search
  useEffect(() => {
    if (demoAction === 'autofill_search') {
      const timer = setTimeout(() => {
        const demoQuery = 'The 1975 - About You';
        setQuery(demoQuery);
        setIsSearching(true);
        searchOnlineTracks(demoQuery)
          .then((results) => {
            setOnlineResults(results);
          })
          .catch((err) => {
            console.warn('Demo search failed:', err);
          })
          .finally(() => {
            setIsSearching(false);
          });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [demoAction, demoNonce]);



  // Explicit Search submission
  const handleExplicitSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setIsSearching(true);

    try {
      const results = await searchOnlineTracks(trimmed);
      handleResultsLoaded(results);
    } catch (err: any) {
      setModalConfig({
        visible: true,
        title: 'Search Catalog Error',
        message:
          err?.message ||
          'Unable to retrieve tracks from the online catalog. Please verify your connection.',
        icon: 'cloud-offline-outline',
      });
    } finally {
      setIsSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setIsSearching(false);
  };

  // Find if an online item has already been downloaded to SQLite
  const findSavedTrack = useCallback(
    (item: OnlineTrackResult): Track | undefined => {
      return offlineTracks.find((t) => {
        if (t.id === `online_${item.source}_${item.id}`) return true;
        if (item.source === 'youtube' && t.youtube_id === item.id) return true;
        if (
          t.title.trim().toLowerCase() === item.title.trim().toLowerCase() &&
          t.artist.trim().toLowerCase() === item.artist.trim().toLowerCase()
        ) {
          return true;
        }
        return false;
      });
    },
    [offlineTracks]
  );

  // Instant stream or play on row tap
  const handleMainPress = async (item: OnlineTrackResult) => {
    const savedTrack = findSavedTrack(item);

    if (savedTrack) {
      // Saved locally: ensure immediate autoplay / toggle play-pause
      if (currentTrack?.id === savedTrack.id) {
        await togglePlayPause();
      } else {
        await playTrack(savedTrack, offlineTracks, { type: 'library', name: 'Local Offline Tracks' });
      }
      return;
    }

    // Streaming track: ensure immediate autoplay
    const streamTrackId = `stream_${item.source}_${item.id}`;
    if (currentTrack?.id === streamTrackId) {
      if (!isPlaying) {
        await resumeAudio();
        usePlayerStore.setState({ isPlaying: true });
      } else {
        await usePlayerStore.getState().seekTo(0);
        await resumeAudio();
      }
      return;
    }

    if (resolvingTrackId === item.id) return;
    setResolvingTrackId(item.id);

    try {
      const streamResult = await resolveOnlineStreamUrl(item);
      const tempTrack: Track = {
        id: streamTrackId,
        user_id: 'local_guest',
        youtube_id: item.source === 'youtube' ? item.id : null,
        title: item.title,
        artist: item.artist,
        local_audio_uri: streamResult.url,
        local_artwork_uri: item.thumbnailUrl,
        duration: item.duration,
        source: 'youtube',
        is_synced: 0,
        created_at: new Date().toISOString(),
        is_streaming: true,
        headers: streamResult.headers,
      };

      await playTrack(tempTrack, [tempTrack], { type: 'search', name: 'Online Stream' });
    } catch (err: any) {
      setModalConfig({
        visible: true,
        title: 'Streaming Error',
        message:
          err?.message ||
          'Failed to resolve online audio stream for playback. Please check your connection.',
        icon: 'alert-circle-outline',
      });
    } finally {
      setResolvingTrackId(null);
    }
  };

  // Trigger audio download for offline library
  const handleDownload = useCallback(
    async (track: OnlineTrackResult) => {
      if (downloadingMap[track.id] !== undefined) return; // already in progress

      setDownloadingMap((prev) => ({ ...prev, [track.id]: 0 }));

      try {
        await downloadTrackToOfflineLibrary(track, (pct) => {
          setDownloadingMap((prev) => ({ ...prev, [track.id]: pct }));
          const guideState = useGuideStore.getState();
          if (guideState.isOpen && guideState.currentStep === 3) {
            guideState.setDemoDownloadProgress(Math.min(99, Math.round(pct)));
          }
        });

        // Walkthrough Step 4: When download completes, update playerStore tracks
        // and mark demo download done so Step 4's Next button is enabled
        const guideState = useGuideStore.getState();
        if (guideState.isOpen && guideState.currentStep === 3) {
          try {
            const allTracks = await getAllTracks();
            const sorted = [...allTracks].sort((a, b) => {
              const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
              const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
              return timeB - timeA;
            });
            usePlayerStore.getState().setTracks(sorted);
            await setSetting('library_sort', 'last_download');
          } catch (sortErr) {
            console.warn('Failed to sort tracks on guide completion:', sortErr);
          }

          guideState.setDemoDownloadProgress(100);
          guideState.setDemoDownloadStatus('done');
        }
      } catch (error: any) {
        const guideState = useGuideStore.getState();
        if (guideState.isOpen && guideState.currentStep === 3) {
          guideState.setDemoDownloadStatus('error');
        }
        setModalConfig({
          visible: true,
          title: 'Download Failed',
          message: error?.message || 'Failed to download the selected audio file. Please try again.',
          icon: 'cloud-offline-outline',
        });
      } finally {
        setDownloadingMap((prev) => {
          const next = { ...prev };
          delete next[track.id];
          return next;
        });
      }
    },
    [downloadingMap]
  );

  // Cancel an in-progress track download
  const handleCancelDownload = async (trackId: string) => {
    try {
      await cancelTrackDownload(trackId);
    } catch (err) {
      console.warn('Failed to cancel download:', err);
    } finally {
      setDownloadingMap((prev) => {
        const next = { ...prev };
        delete next[trackId];
        return next;
      });
    }
  };

  // Demo Walkthrough Automation: Step 4 trigger download
  useEffect(() => {
    if (demoAction === 'trigger_download' && lastTriggeredNonceRef.current !== demoNonce) {
      lastTriggeredNonceRef.current = demoNonce;
      const triggerDemoDownload = async () => {
        let results = onlineResults;
        if (results.length === 0) {
          useGuideStore.getState().setDemoDownloadStatus('searching');
          setIsSearching(true);
          try {
            results = await searchOnlineTracks('The 1975 - About You');
            setOnlineResults(results);
          } catch (err) {
            console.warn('Failed to load demo results for trigger_download:', err);
            useGuideStore.getState().setDemoDownloadStatus('error');
            return;
          } finally {
            setIsSearching(false);
          }
        }

        const target = findDemoTargetTrack(results);
        if (target) {
          const alreadySaved = findSavedTrack(target);
          if (alreadySaved && alreadySaved.local_audio_uri) {
            // Already downloaded on device (e.g. guide replay from Settings)!
            useGuideStore.getState().setDemoDownloadProgress(100);
            useGuideStore.getState().setDemoDownloadStatus('done');
            return;
          }

          const isDownloading = downloadingMap[target.id] !== undefined;
          if (!isDownloading) {
            useGuideStore.getState().setDemoDownloadStatus('downloading');
            useGuideStore.getState().setDemoDownloadProgress(0);
            handleDownload(target);
          }
        } else {
          useGuideStore.getState().setDemoDownloadStatus('error');
        }
      };

      triggerDemoDownload();
    }
  }, [demoAction, demoNonce, onlineResults, findSavedTrack, downloadingMap, handleDownload]);

  // Render individual online track result row
  const renderOnlineTrackItem = ({
    item,
    index,
  }: {
    item: OnlineTrackResult;
    index: number;
  }) => {
    const savedTrack = findSavedTrack(item);
    const streamTrackId = `stream_${item.source}_${item.id}`;
    const isCurrentTrack =
      (savedTrack && currentTrack?.id === savedTrack.id) ||
      currentTrack?.id === streamTrackId ||
      currentTrack?.id === `online_${item.source}_${item.id}`;
    const isCurrentPlaying = isCurrentTrack && isPlaying;
    const downloadPct = downloadingMap[item.id];
    const isDownloading = downloadPct !== undefined;
    const isResolving = resolvingTrackId === item.id;

    return (
      <View
        style={[
          styles.resultRow,
          isCurrentTrack && styles.resultRowActive,
          !isCurrentTrack && savedTrack && styles.resultRowSaved,
        ]}
      >
        {/* Inner clipped container for background progress and content */}
        <View style={styles.cardInnerContainer}>
          {isDownloading && (
            <View
              style={[
                styles.progressFill,
                {
                  width: `${Math.min(100, Math.max(0, downloadPct))}%`,
                  backgroundColor: theme.primary + '22',
                },
              ]}
            />
          )}

          {/* Left / Main area: Thumbnail + Title + Artist (tappable for instant streaming / playing) */}
          <TouchableOpacity
            style={styles.resultMainArea}
            onPress={() => handleMainPress(item)}
            activeOpacity={0.7}
          >
            {/* Rounded Thumbnail / Monogram Icon with resolving spinner overlay */}
            <View style={styles.thumbnailContainer}>
              {item.thumbnailUrl ? (
                <Image
                  source={{ uri: item.thumbnailUrl }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Ionicons
                    name={isCurrentPlaying ? 'volume-high' : 'musical-note'}
                    size={20}
                    color={isCurrentTrack ? theme.primary : theme.textSecondary}
                  />
                </View>
              )}

              {/* Subtle loading spinner overlay while resolving online stream */}
              {isResolving && (
                <View style={styles.thumbnailOverlay}>
                  <ActivityIndicator size="small" color={theme.primary} />
                </View>
              )}
            </View>

            {/* Track Title & Artist Information */}
            <View style={styles.resultInfo}>
              <Text
                style={[styles.resultTitle, isCurrentTrack && styles.resultTitleActive]}
                numberOfLines={1}
              >
                {item.title}
              </Text>
              <View style={styles.resultMetaRow}>
                <View style={styles.sourceBadge}>
                  <Text style={styles.sourceBadgeText}>{item.source}</Text>
                </View>
                <Text
                  style={styles.resultArtist}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {item.artist}
                </Text>
                <Text style={styles.resultMetaDot}>•</Text>
                <View style={styles.durationBadge}>
                  <Text style={styles.durationBadgeText}>{formatDuration(item.duration)}</Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>

          {/* Right-side Action: Saved Play/Pause, Downloading Progress, or Download Button */}
          <View style={styles.actionContainer}>
            {savedTrack ? (
              <TouchableOpacity
                style={styles.savedPlayButton}
                onPress={() => handleMainPress(item)}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityLabel={isCurrentPlaying ? "Pause audio" : "Play audio"}
              >
                <Ionicons
                  name={isCurrentPlaying ? "pause" : "checkmark"}
                  size={16}
                  color={theme.primary}
                />
              </TouchableOpacity>
            ) : isDownloading ? (
              <View style={styles.downloadingActionContainer}>
                <Text style={styles.progressPercentageText}>{downloadPct}%</Text>
                <TouchableOpacity
                  style={styles.cancelDownloadButton}
                  onPress={() => handleCancelDownload(item.id)}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityLabel="Cancel download"
                >
                  <Ionicons name="close" size={14} color={theme.textPrimary} />
                </TouchableOpacity>
              </View>
            ) : (
              <View
                ref={(r) => {
                  if (index === 0) {
                    registerGuideTarget('first_search_download_btn', r);
                  }
                }}
                collapsable={false}
              >
                <TouchableOpacity
                  style={styles.downloadButton}
                  onPress={() => handleDownload(item)}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Download track"
                >
                  <Ionicons
                    name="cloud-download-outline"
                    size={18}
                    color={theme.textPrimary}
                  />
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => {
    if (isSearching) {
      return (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.emptyTitle}>Searching catalog...</Text>
          <Text style={styles.emptySubtitle}>
            Fetching high-quality audio streams and artist tracks.
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyContainer}>
        <Ionicons
          name={query.trim() ? 'search-outline' : 'cloud-download-outline'}
          size={52}
          color={theme.textMuted}
        />
        <Text style={styles.emptyTitle}>
          {query.trim() ? 'No online tracks found' : 'Instant Stream & Download'}
        </Text>
        <Text style={styles.emptySubtitle}>
          {query.trim()
            ? `We couldn't find any songs matching "${query}". Check the title or artist name.`
            : 'Tap any track to stream instantly, or use the download button for offline listening.'}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Subtle JS Monogram Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image source={logoSource} style={styles.watermarkImage} resizeMode="contain" />
      </View>

      {/* Minimalist Top Header: 20px edge breathing room + full-width rounded search bar */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Search</Text>

        <View
          ref={(ref) => registerGuideTarget('search_input_bar', ref)}
          collapsable={false}
          style={styles.searchBar}
        >
          <Ionicons
            name="search"
            size={19}
            color={theme.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search songs, artists on YouTube..."
            placeholderTextColor={theme.textMuted}
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              if (!text.trim()) {
                setIsSearching(false);
              }
            }}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="search"
            onSubmitEditing={handleExplicitSearch}
          />
          {isSearching && (
            <ActivityIndicator size="small" color={theme.primary} style={{ marginRight: 6 }} />
          )}
          {query.length > 0 && (
            <TouchableOpacity
              onPress={clearSearch}
              style={styles.clearButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Clear search"
            >
              <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* FlatList of Online Results */}
      <FlatList
        style={styles.list}
        data={displayedOnlineTracks}
        keyExtractor={(item) => `${item.source}_${item.id}`}
        renderItem={renderOnlineTrackItem}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />

      {/* Soft Monochrome Confirmation & Error Dialog */}
      <ConfirmModal
        visible={modalConfig.visible}
        title={modalConfig.title}
        message={modalConfig.message}
        icon={modalConfig.icon}
        confirmText="OK"
        cancelText="Close"
        onConfirm={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
        onCancel={() => setModalConfig((prev) => ({ ...prev, visible: false }))}
      />
    </SafeAreaView>
  );
}
