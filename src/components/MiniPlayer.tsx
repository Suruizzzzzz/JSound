import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { createStyles } from './MiniPlayer.styles';

export default function MiniPlayer() {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const setModalOpen = usePlayerStore((state) => state.setModalOpen);

  const insets = useSafeAreaInsets();
  const bottomInset = Platform.OS === 'ios' ? Math.max(insets.bottom, 28) : Math.max(insets.bottom, 10);
  const tabBarHeight = (Platform.OS === 'ios' ? 60 : 54) + bottomInset;

  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!currentTrack) {
    return null;
  }

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (position / duration) * 100)) : 0;

  return (
    <View style={[styles.container, { bottom: tabBarHeight }]}>
      <TouchableOpacity
        style={styles.innerContent}
        activeOpacity={0.9}
        onPress={() => setModalOpen(true)}
      >
        {/* Album Artwork or Monochrome Placeholder */}
        <View style={styles.artContainer}>
          {currentTrack.local_artwork_uri ? (
            <Image
              source={{ uri: currentTrack.local_artwork_uri }}
              style={styles.artImage}
            />
          ) : (
            <View style={styles.placeholderArt}>
              <Ionicons name="musical-notes" size={18} color={theme.textSecondary} />
            </View>
          )}
        </View>

        {/* Track Title & Artist */}
        <View style={styles.trackInfo}>
          <Text style={styles.title} numberOfLines={1}>
            {currentTrack.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {currentTrack.artist}
          </Text>
        </View>

        {/* Play/Pause & Next Controls */}
        <View style={styles.controls}>
          <TouchableOpacity
            style={styles.controlButton}
            onPress={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={22}
              color={theme.primary}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.controlButton}
            onPress={(e) => {
              e.stopPropagation();
              playNext();
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="play-skip-forward" size={19} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>

      {/* Slim progress bar docked at the bottom of the card */}
      <View style={styles.progressBarBackground}>
        <View style={[styles.progressBarFill, { width: `${progressPercent}%` }]} />
      </View>
    </View>
  );
}
