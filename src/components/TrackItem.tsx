import React, { useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Track } from '@/types/music';
import { usePlayerStore, PlaybackContext } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import ConfirmModal from '@/components/ConfirmModal';
import { createStyles } from './TrackItem.styles';

export interface TrackItemProps {
  track: Track;
  queue: Track[];
  playbackContext?: PlaybackContext | null;
  onDelete?: (id: string) => void;
  downloadProgress?: number;
  onCancelDownload?: (id: string) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  index?: number;
  totalTracks?: number;
  onMoveTrack?: (fromIndex: number, toIndex: number) => void;
  onLongPress?: (trackId: string) => void;
  onAddToPlaylist?: (track: Track) => void;
  onPlay?: () => void;
  isCurrentTrack?: boolean;
  isPlaying?: boolean;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const ROW_HEIGHT = 66;

const TrackItem = React.memo(function TrackItem({
  track,
  queue,
  playbackContext,
  onDelete,
  downloadProgress,
  onCancelDownload,
  selectionMode,
  isSelected,
  onToggleSelect,
  index,
  totalTracks,
  onMoveTrack,
  onLongPress,
  onAddToPlaylist,
  onPlay,
  isCurrentTrack,
  isPlaying: isPlayingProp,
}: TrackItemProps) {
  const isCurrentFromStore = usePlayerStore((state) => state.currentTrack?.id === track.id);
  const isPlayingFromStore = usePlayerStore((state) =>
    state.currentTrack?.id === track.id ? state.isPlaying : false
  );
  const theme = useThemeStore((state) => state.theme);

  const styles = useMemo(() => createStyles(theme), [theme]);
  const isCurrent = isCurrentTrack !== undefined ? isCurrentTrack : isCurrentFromStore;
  const activePlaying = isPlayingProp !== undefined ? isPlayingProp : isPlayingFromStore;
  const isCloud =
    !track.local_audio_uri &&
    Boolean(
      track.youtube_id ||
        track.source === 'youtube' ||
        track.is_streaming ||
        track.id.startsWith('online_') ||
        track.id.startsWith('stream_')
    );
  const isUnavailable = !track.local_audio_uri && !isCloud;

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Gesture handling for hold-and-drag reordering
  const translateY = useSharedValue(0);
  const isDragging = useSharedValue(false);

  const triggerHaptic = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const handleDrop = useCallback(
    (offsetPx: number) => {
      if (index === undefined || totalTracks === undefined || !onMoveTrack) return;
      const offsetIndex = Math.round(offsetPx / ROW_HEIGHT);
      if (offsetIndex !== 0) {
        const targetIndex = Math.max(0, Math.min(totalTracks - 1, index + offsetIndex));
        if (targetIndex !== index) {
          onMoveTrack(index, targetIndex);
        }
      }
    },
    [index, totalTracks, onMoveTrack]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          'worklet';
          isDragging.value = true;
          runOnJS(triggerHaptic)();
        })
        .onUpdate((event) => {
          'worklet';
          translateY.value = event.translationY;
        })
        .onEnd((event) => {
          'worklet';
          runOnJS(handleDrop)(event.translationY);
          translateY.value = withSpring(0, { damping: 18, stiffness: 150 });
          isDragging.value = false;
        })
        .onFinalize(() => {
          'worklet';
          translateY.value = withSpring(0, { damping: 18, stiffness: 150 });
          isDragging.value = false;
        }),
    [handleDrop, isDragging, translateY, triggerHaptic]
  );

  const animatedRowStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { translateY: translateY.value },
        { scale: isDragging.value ? 1.02 : 1 },
      ],
      zIndex: isDragging.value ? 999 : 1,
      elevation: isDragging.value ? 8 : 0,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: isDragging.value ? 4 : 0 },
      shadowOpacity: isDragging.value ? 0.25 : 0,
      shadowRadius: isDragging.value ? 6 : 0,
      backgroundColor: isDragging.value ? theme.surfaceElevated : 'transparent',
    };
  });

  const handlePress = useCallback(() => {
    if (selectionMode) {
      onToggleSelect?.(track.id);
      return;
    }

    onPlay?.();
    const { playTrack, togglePlayPause } = usePlayerStore.getState();

    if (isUnavailable) {
      const nextPlayable = queue.find(
        (t) => (Boolean(t.local_audio_uri) || Boolean(t.is_streaming)) && t.id !== track.id
      );
      if (nextPlayable) {
        playTrack(nextPlayable, queue, playbackContext);
      }
      return;
    }

    if (isCurrent) {
      togglePlayPause();
    } else {
      playTrack(track, queue, playbackContext);
    }
  }, [
    selectionMode,
    onToggleSelect,
    track,
    onPlay,
    isUnavailable,
    queue,
    playbackContext,
    isCurrent,
  ]);

  const handleLongPress = useCallback(() => {
    onLongPress?.(track.id);
  }, [onLongPress, track.id]);

  return (
    <Animated.View style={animatedRowStyle}>
      <TouchableOpacity
        style={[
          styles.container,
          isCurrent && styles.activeContainer,
          isSelected && styles.selectedContainer,
          isSelected && isCurrent && styles.selectedActiveContainer,
        ]}
        activeOpacity={0.7}
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={280}
      >
        {/* Selection Checkbox (shown in selection mode) */}
        {selectionMode && (
          <TouchableOpacity
            style={styles.selectionCheckbox}
            onPress={() => onToggleSelect?.(track.id)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={isSelected ? 'Deselect song' : 'Select song'}
          >
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={isSelected ? theme.primary : theme.textMuted}
            />
          </TouchableOpacity>
        )}

        {/* Artwork Thumbnail / Minimalist Monochrome Placeholder */}
        <View style={[styles.artworkContainer, isCurrent && styles.activeArtworkContainer]}>
          {track.local_artwork_uri ? (
            <Image source={{ uri: track.local_artwork_uri }} style={styles.artwork} />
          ) : (
            <View style={styles.placeholder}>
              <Ionicons
                name="musical-note"
                size={18}
                color={isCurrent ? theme.primary : theme.textSecondary}
              />
            </View>
          )}
          {isCurrent && (
            <View style={styles.nowPlayingArtworkBadge}>
              <Ionicons
                name={activePlaying ? 'volume-high' : 'pause'}
                size={10}
                color={theme.onPrimary}
              />
            </View>
          )}
        </View>

        {/* Title & Artist info */}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, isCurrent && styles.activeTitle]}
              numberOfLines={1}
            >
              {track.title}
            </Text>
            {isCurrent && (
              <View style={styles.nowPlayingTitleBadge}>
                <Ionicons
                  name={activePlaying ? 'volume-high' : 'pause'}
                  size={10}
                  color={theme.primary}
                />
                <Text style={styles.nowPlayingTitleBadgeText}>
                  {activePlaying ? 'PLAYING' : 'PAUSED'}
                </Text>
              </View>
            )}
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.artist} numberOfLines={1}>
              {track.artist}
            </Text>
            <Text style={styles.metaDot}>•</Text>
            <Text style={styles.duration}>
              {formatDuration(track.duration)}
            </Text>
            {downloadProgress === undefined && (
              track.local_audio_uri ? (
                <>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '600' }}>
                    Offline
                  </Text>
                </>
              ) : isCloud ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={styles.metaDot}>•</Text>
                  <Ionicons
                    name="cloud-outline"
                    size={12}
                    color={theme.textSecondary}
                    style={{ marginRight: 3 }}
                  />
                  <Text style={{ fontSize: 11, color: theme.textSecondary, fontWeight: '600' }}>
                    Cloud
                  </Text>
                </View>
              ) : isUnavailable ? (
                <>
                  <Text style={styles.metaDot}>•</Text>
                  <Text style={{ fontSize: 11, color: theme.textMuted, fontStyle: 'italic' }}>
                    Unavailable
                  </Text>
                </>
              ) : null
            )}
          </View>
        </View>

        {/* Right-side Action & Handle Area */}
        <View style={styles.actionsRow}>
          {/* Active download progress with cancel */}
          {downloadProgress !== undefined && (
            <TouchableOpacity
              style={styles.downloadProgressContainer}
              onPress={() => onCancelDownload?.(track.id)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Cancel download"
            >
              <ActivityIndicator size="small" color={theme.primary} />
              <Text style={styles.downloadProgressText}>{downloadProgress}%</Text>
              <Ionicons name="close-circle" size={15} color={theme.textSecondary} />
            </TouchableOpacity>
          )}

          {/* Normal Mode: Bookmark & Delete Buttons */}
          {!selectionMode && (
            <>
              {onAddToPlaylist && Boolean(track.youtube_id) && (
                <TouchableOpacity
                  style={styles.actionIconButton}
                  onPress={() => onAddToPlaylist(track)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Add to playlist"
                >
                  <Ionicons name="bookmark-outline" size={17} color={theme.textMuted} />
                </TouchableOpacity>
              )}

              {onDelete && (
                <>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => setShowDeleteModal(true)}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="trash-outline" size={17} color={theme.textMuted} />
                  </TouchableOpacity>

                  <ConfirmModal
                    visible={showDeleteModal}
                    title="Delete Track"
                    message={`Are you sure you want to remove "${track.title}" from your offline library?`}
                    icon="trash-outline"
                    confirmText="Delete"
                    isDestructive={true}
                    onConfirm={() => {
                      setShowDeleteModal(false);
                      onDelete(track.id);
                    }}
                    onCancel={() => setShowDeleteModal(false)}
                  />
                </>
              )}
            </>
          )}

          {/* Selection Mode: 6-dot Drag Handle with Pan Gesture */}
          {selectionMode && onMoveTrack && (
            <GestureDetector gesture={panGesture}>
              <View
                style={styles.dragHandle}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                accessibilityLabel="Drag to reorder track"
              >
                <MaterialIcons name="drag-indicator" size={22} color={theme.textSecondary} />
              </View>
            </GestureDetector>
          )}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
});

export default TrackItem;
