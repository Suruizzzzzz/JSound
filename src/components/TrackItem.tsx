import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Track } from '@/types/music';
import { resumeAudio } from '@/services/audioService';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import ConfirmModal from '@/components/ConfirmModal';
import { createStyles } from './TrackItem.styles';

interface TrackItemProps {
  track: Track;
  queue: Track[];
  onDelete?: (id: string) => void;
  downloadProgress?: number;
  onCancelDownload?: (id: string) => void;
  showDragHandle?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  dragHandleProps?: any;
  onLongPress?: () => void;
  onAddToPlaylist?: (track: Track) => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function TrackItem({
  track,
  queue,
  onDelete,
  downloadProgress,
  onCancelDownload,
  showDragHandle,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
  dragHandleProps,
  onLongPress,
  onAddToPlaylist,
}: TrackItemProps) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const playTrack = usePlayerStore((state) => state.playTrack);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const theme = useThemeStore((state) => state.theme);

  const styles = useMemo(() => createStyles(theme), [theme]);
  const isCurrent = currentTrack?.id === track.id;

  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const handlePress = () => {
    if (isCurrent) {
      if (!isPlaying) {
        resumeAudio();
        usePlayerStore.setState({ isPlaying: true });
      } else {
        togglePlayPause();
      }
    } else {
      playTrack(track, queue);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.container, isCurrent && styles.activeContainer]}
      activeOpacity={0.7}
      onPress={handlePress}
      onLongPress={onLongPress}
      delayLongPress={300}
    >
      {/* Artwork Thumbnail / Minimalist Monochrome Placeholder */}
      <View style={styles.artworkContainer}>
        {track.local_artwork_uri ? (
          <Image source={{ uri: track.local_artwork_uri }} style={styles.artwork} />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons
              name={isCurrent && isPlaying ? 'volume-high' : 'musical-note'}
              size={18}
              color={isCurrent ? theme.primary : theme.textSecondary}
            />
          </View>
        )}
      </View>

      {/* Title & Artist info */}
      <View style={styles.info}>
        <Text
          style={[styles.title, isCurrent && styles.activeTitle]}
          numberOfLines={1}
        >
          {track.title}
        </Text>
        <View style={styles.metaRow}>
          <Text style={styles.artist} numberOfLines={1}>
            {track.artist}
          </Text>
          <Text style={styles.metaDot}>•</Text>
          <Text style={styles.duration}>
            {formatDuration(track.duration)}
          </Text>
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

        {/* Optional Add to Playlist Button */}
        {onAddToPlaylist && (
          <TouchableOpacity
            style={styles.actionIconButton}
            onPress={() => onAddToPlaylist(track)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Add to playlist"
          >
            <Ionicons name="bookmark-outline" size={17} color={theme.textMuted} />
          </TouchableOpacity>
        )}

        {/* Optional action / delete button with ConfirmModal */}
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

        {/* Reorder Up / Down arrow buttons */}
        {showDragHandle && (
          <View style={styles.reorderControlsRow}>
            <TouchableOpacity
              style={[styles.reorderArrowBtn, isFirst && styles.reorderArrowDisabled]}
              onPress={onMoveUp}
              disabled={isFirst}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Move track up"
            >
              <Ionicons
                name="chevron-up"
                size={16}
                color={isFirst ? theme.textMuted : theme.textPrimary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.reorderArrowBtn, isLast && styles.reorderArrowDisabled]}
              onPress={onMoveDown}
              disabled={isLast}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Move track down"
            >
              <Ionicons
                name="chevron-down"
                size={16}
                color={isLast ? theme.textMuted : theme.textPrimary}
              />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
