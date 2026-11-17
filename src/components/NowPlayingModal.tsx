import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  SafeAreaView,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import DotMatrixVisualizer from '@/components/DotMatrixVisualizer';
import { createStyles } from './NowPlayingModal.styles';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function NowPlayingModal() {
  const isModalOpen = usePlayerStore((state) => state.isModalOpen);
  const setModalOpen = usePlayerStore((state) => state.setModalOpen);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const isShuffle = usePlayerStore((state) => state.isShuffle);
  const repeatMode = usePlayerStore((state) => state.repeatMode);

  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode);

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

  // Local drag state for smooth slider dragging
  const [isSeeking, setIsSeeking] = useState(false);
  const [dragPosition, setDragPosition] = useState(0);

  if (!currentTrack) {
    return null;
  }

  const effectivePosition = isSeeking ? dragPosition : position;
  const maxSliderValue = duration > 0 ? duration : 1;

  return (
    <Modal
      visible={isModalOpen}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setModalOpen(false)}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

        {/* Subtle JS Monogram Background Watermark Backdrop */}
        <View style={styles.watermarkContainer} pointerEvents="none">
          <Image
            source={logoSource}
            style={styles.watermarkImage}
            resizeMode="contain"
          />
        </View>

        {/* Top Navigation Bar */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setModalOpen(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="chevron-down" size={26} color={theme.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerSuperText}>PLAYING FROM YOUR LIBRARY</Text>
            <Text style={styles.headerSubText} numberOfLines={1}>
              Local Offline Tracks
            </Text>
          </View>

          <View style={styles.headerIconButton} />
        </View>

        {/* Minimalist Monochrome Artwork / Dot-Matrix Visualizer Section */}
        <View style={styles.artworkWrapper}>
          <View style={styles.artworkContainer}>
            {currentTrack.local_artwork_uri ? (
              <Image
                source={{ uri: currentTrack.local_artwork_uri }}
                style={styles.artworkImage}
              />
            ) : (
              <DotMatrixVisualizer isPlaying={isPlaying} position={effectivePosition} />
            )}
          </View>
        </View>

        {/* Track Title and Artist */}
        <View style={styles.infoContainer}>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {currentTrack.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {currentTrack.artist}
            </Text>
          </View>

          <View style={styles.badgeContainer}>
            <View style={styles.sourceBadge}>
              <Ionicons name="folder-outline" size={13} color={theme.textSecondary} />
              <Text style={styles.sourceBadgeText}>Local</Text>
            </View>
          </View>
        </View>

        {/* Seek Slider and Timers */}
        <View style={styles.progressSection}>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={maxSliderValue}
            value={effectivePosition}
            minimumTrackTintColor={theme.primary}
            maximumTrackTintColor={theme.border}
            thumbTintColor={theme.primary}
            onValueChange={(val) => {
              setIsSeeking(true);
              setDragPosition(val);
            }}
            onSlidingComplete={async (val) => {
              await seekTo(val);
              setIsSeeking(false);
            }}
          />

          <View style={styles.timeRow}>
            <Text style={styles.timeText}>{formatTime(effectivePosition)}</Text>
            <Text style={styles.timeText}>{formatTime(duration)}</Text>
          </View>
        </View>

        {/* Playback Controls */}
        <View style={styles.controlsRow}>
          {/* Shuffle Button */}
          <TouchableOpacity
            style={styles.smallControl}
            onPress={toggleShuffle}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name="shuffle"
              size={23}
              color={isShuffle ? theme.primary : theme.textMuted}
            />
            {isShuffle && <View style={styles.activeDot} />}
          </TouchableOpacity>

          {/* Previous Track Button */}
          <TouchableOpacity
            style={styles.mediumControl}
            onPress={playPrevious}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="play-skip-back" size={30} color={theme.textPrimary} />
          </TouchableOpacity>

          {/* Large Monochrome Play/Pause Center Button */}
          <TouchableOpacity
            style={styles.playPauseButton}
            onPress={togglePlayPause}
            activeOpacity={0.8}
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={30}
              color={theme.onPrimary}
              style={isPlaying ? {} : { marginLeft: 3 }}
            />
          </TouchableOpacity>

          {/* Next Track Button */}
          <TouchableOpacity
            style={styles.mediumControl}
            onPress={playNext}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="play-skip-forward" size={30} color={theme.textPrimary} />
          </TouchableOpacity>

          {/* Repeat Mode Button */}
          <TouchableOpacity
            style={styles.smallControl}
            onPress={cycleRepeatMode}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons
              name="repeat"
              size={23}
              color={repeatMode !== 'off' ? theme.primary : theme.textMuted}
            />
            {repeatMode === 'one' && (
              <View style={styles.repeatOneBadge}>
                <Text style={styles.repeatOneText}>1</Text>
              </View>
            )}
            {repeatMode === 'all' && (
              <View style={styles.activeDot} />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
