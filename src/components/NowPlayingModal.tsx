import React, { useState, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { updateTrackArtwork, updateTrackMetadata as updateTrackMetadataInDb } from '@/lib/database';
import DotMatrixVisualizer from '@/components/DotMatrixVisualizer';
import { createStyles } from './NowPlayingModal.styles';

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

interface NowPlayingProgressBarProps {
  styles: ReturnType<typeof createStyles>;
  primaryColor: string;
  borderColor: string;
}

const NowPlayingProgressBar = React.memo(function NowPlayingProgressBar({
  styles,
  primaryColor,
  borderColor,
}: NowPlayingProgressBarProps) {
  const position = usePlayerStore((state) => state.position);
  const duration = usePlayerStore((state) => state.duration);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setStoreIsSeeking = usePlayerStore((state) => state.setIsSeeking);

  const [isLocalSeeking, setIsLocalSeeking] = useState(false);
  const [dragStartValue, setDragStartValue] = useState(0);
  const [dragDisplayValue, setDragDisplayValue] = useState(0);

  React.useEffect(() => {
    return () => {
      setStoreIsSeeking(false);
    };
  }, [setStoreIsSeeking]);

  // Keep Slider.value frozen during active drag per @react-native-community/slider contract
  const sliderValue = isLocalSeeking ? dragStartValue : position;
  const displayedTime = isLocalSeeking ? dragDisplayValue : position;
  const maxSliderValue = duration > 0 ? duration : 1;

  return (
    <View style={styles.progressSection}>
      <Slider
        style={styles.slider}
        minimumValue={0}
        maximumValue={maxSliderValue}
        value={sliderValue}
        minimumTrackTintColor={primaryColor}
        maximumTrackTintColor={borderColor}
        thumbTintColor={primaryColor}
        onSlidingStart={(val) => {
          setStoreIsSeeking(true);
          setIsLocalSeeking(true);
          setDragStartValue(val);
          setDragDisplayValue(val);
        }}
        onValueChange={(val) => {
          setDragDisplayValue(val);
        }}
        onSlidingComplete={async (val) => {
          setDragDisplayValue(val);
          setDragStartValue(val);
          try {
            await seekTo(val);
          } finally {
            setIsLocalSeeking(false);
            setStoreIsSeeking(false);
          }
        }}
      />

      <View style={styles.timeRow}>
        <Text style={styles.timeText}>{formatTime(displayedTime)}</Text>
        <Text style={styles.timeText}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
});

export default function NowPlayingModal() {
  const isModalOpen = usePlayerStore((state) => state.isModalOpen);
  const setModalOpen = usePlayerStore((state) => state.setModalOpen);
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const playbackContext = usePlayerStore((state) => state.playbackContext);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const isBuffering = usePlayerStore((state) => state.isBuffering);
  const isShuffle = usePlayerStore((state) => state.isShuffle);
  const repeatMode = usePlayerStore((state) => state.repeatMode);

  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle);
  const cycleRepeatMode = usePlayerStore((state) => state.cycleRepeatMode);
  const updateCurrentOrLibraryTrackArtwork = usePlayerStore(
    (state) => state.updateCurrentOrLibraryTrackArtwork
  );
  const updateTrackMetadataInStore = usePlayerStore(
    (state) => state.updateTrackMetadata
  );

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

  // Track options modal state (•••)
  const [showTrackMenuModal, setShowTrackMenuModal] = useState(false);

  // Edit track metadata modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editArtist, setEditArtist] = useState('');

  // Artwork options modal state
  const [showArtworkActionModal, setShowArtworkActionModal] = useState(false);

  const handleArtworkPress = () => {
    if (currentTrack?.local_artwork_uri) {
      setShowArtworkActionModal(true);
    } else {
      handlePickArtwork();
    }
  };

  const handlePickArtwork = async () => {
    setShowArtworkActionModal(false);
    if (!currentTrack) return;
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
        if (!docDir) return;

        const artworkDir = `${docDir}jstream_artwork/`;
        const dirInfo = await FileSystem.getInfoAsync(artworkDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(artworkDir, { intermediates: true });
        }

        const cleanId = (currentTrack.id || 'track').replace(/[^a-zA-Z0-9_\-]/g, '_');
        const targetUri = `${artworkDir}custom_${cleanId}_${Date.now()}.jpg`;

        await FileSystem.copyAsync({ from: pickedUri, to: targetUri });

        // Update SQLite and playerStore
        await updateTrackArtwork(currentTrack.id, targetUri);
        updateCurrentOrLibraryTrackArtwork(currentTrack.id, targetUri);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      console.warn('Failed to update song artwork:', err);
    }
  };

  const handleRemoveArtwork = async () => {
    if (!currentTrack) return;
    setShowArtworkActionModal(false);
    try {
      // Clean up local custom file if stored
      if (
        currentTrack.local_artwork_uri &&
        currentTrack.local_artwork_uri.startsWith('file://')
      ) {
        try {
          await FileSystem.deleteAsync(currentTrack.local_artwork_uri, {
            idempotent: true,
          });
        } catch {
          // non-fatal
        }
      }

      await updateTrackArtwork(currentTrack.id, null);
      updateCurrentOrLibraryTrackArtwork(currentTrack.id, null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.warn('Failed to remove song artwork:', err);
    }
  };

  const handleOpenEditModal = () => {
    if (!currentTrack) return;
    setEditTitle(currentTrack.title);
    setEditArtist(currentTrack.artist);
    setShowEditModal(true);
  };

  const handleSaveMetadata = async () => {
    if (!currentTrack || !editTitle.trim()) return;
    const cleanTitle = editTitle.trim();
    const cleanArtist = editArtist.trim() || currentTrack.artist;

    try {
      await updateTrackMetadataInDb(currentTrack.id, {
        title: cleanTitle,
        artist: cleanArtist,
      });
      updateTrackMetadataInStore(currentTrack.id, {
        title: cleanTitle,
        artist: cleanArtist,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.warn('Failed to update song metadata:', err);
    } finally {
      setShowEditModal(false);
    }
  };

  if (!currentTrack) {
    return null;
  }

  const isPlaylist = playbackContext?.type === 'playlist' && Boolean(playbackContext.name);
  const isRadio = playbackContext?.type === 'search-radio';
  const headerSuperText = isRadio
    ? 'PLAYING FROM ARTIST RADIO'
    : isPlaylist
    ? 'PLAYING FROM PLAYLIST'
    : 'PLAYING FROM YOUR LIBRARY';
  const headerSubText = isPlaylist
    ? playbackContext.name!
    : (playbackContext?.name || 'Local Offline Tracks');

  return (
    <Modal
      visible={isModalOpen}
      animationType="slide"
      transparent={false}
      onRequestClose={() => setModalOpen(false)}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

        {/* Subtle Cat Logo Background Watermark Backdrop */}
        <View style={styles.watermarkContainer} pointerEvents="none">
          <Image
            source={logoSource}
            style={styles.watermarkImage}
            resizeMode="contain"
          />
        </View>

        {/* Context-Aware Top Navigation Bar */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setModalOpen(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Close player"
          >
            <Ionicons name="chevron-down" size={26} color={theme.textPrimary} />
          </TouchableOpacity>

          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerSuperText}>{headerSuperText}</Text>
            <Text style={styles.headerSubText} numberOfLines={1}>
              {headerSubText}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setShowTrackMenuModal(true)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityLabel="Track options"
          >
            <Ionicons name="ellipsis-horizontal" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Minimalist Monochrome Artwork / Dot-Matrix Visualizer Section */}
        <View style={styles.artworkWrapper}>
          <TouchableOpacity
            style={styles.artworkContainer}
            onPress={handleArtworkPress}
            activeOpacity={0.85}
            accessibilityLabel="Change song cover artwork"
          >
            {currentTrack.local_artwork_uri ? (
              <Image
                source={{ uri: currentTrack.local_artwork_uri }}
                style={styles.artworkImage}
              />
            ) : (
              <DotMatrixVisualizer
                isPlaying={isPlaying}
                isBuffering={isBuffering}
                isVisible={isModalOpen}
              />
            )}
          </TouchableOpacity>
        </View>

        {/* Track Title and Artist (Clean, Zero Visual Clutter) */}
        <View style={styles.infoContainer}>
          <View style={styles.textContainer}>
            <Text style={styles.title} numberOfLines={1}>
              {currentTrack.title}
            </Text>
            <Text style={styles.artist} numberOfLines={1}>
              {currentTrack.artist}
            </Text>
          </View>
        </View>

        {/* Seek Slider and Timers (keyed by trackId to reset local drag cleanly on track change) */}
        <NowPlayingProgressBar
          key={currentTrack.id}
          styles={styles}
          primaryColor={theme.primary}
          borderColor={theme.border}
        />

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
              <>
                <View style={styles.repeatAllBadge}>
                  <Text style={styles.repeatAllText}>ALL</Text>
                </View>
                <View style={styles.activeDot} />
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Track Menu Options Modal (•••) */}
        <Modal
          visible={showTrackMenuModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowTrackMenuModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowTrackMenuModal(false)}
          >
            <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
              <Text style={styles.modalTitle} numberOfLines={1}>
                {currentTrack.title}
              </Text>
              <Text style={styles.modalSubtitle} numberOfLines={1}>
                {currentTrack.artist}
              </Text>

              <TouchableOpacity
                style={styles.trackMenuOption}
                onPress={() => {
                  setShowTrackMenuModal(false);
                  handleOpenEditModal();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="pencil-outline" size={19} color={theme.textPrimary} />
                <Text style={styles.trackMenuOptionText}>Edit Track Info</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.trackMenuOption}
                onPress={() => {
                  setShowTrackMenuModal(false);
                  handleArtworkPress();
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="image-outline" size={19} color={theme.textPrimary} />
                <Text style={styles.trackMenuOptionText}>
                  {currentTrack.local_artwork_uri ? 'Change Cover Artwork' : 'Add Cover Artwork'}
                </Text>
              </TouchableOpacity>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowTrackMenuModal(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Edit Track Title & Artist Modal */}
        <Modal
          visible={showEditModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowEditModal(false)}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}
          >
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Track Details</Text>
              <Text style={styles.modalSubtitle}>
                Update title and artist info in your local offline library
              </Text>

              <Text style={styles.modalLabel}>Track Title</Text>
              <TextInput
                style={styles.modalInput}
                value={editTitle}
                onChangeText={setEditTitle}
                placeholder="Song title"
                placeholderTextColor={theme.textMuted}
                maxLength={60}
                autoFocus
              />

              <Text style={styles.modalLabel}>Artist</Text>
              <TextInput
                style={styles.modalInput}
                value={editArtist}
                onChangeText={setEditArtist}
                placeholder="Artist name"
                placeholderTextColor={theme.textMuted}
                maxLength={60}
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowEditModal(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalSaveBtn}
                  onPress={handleSaveMetadata}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>

        {/* Cover Artwork Actions Modal (Choose / Remove) */}
        <Modal
          visible={showArtworkActionModal}
          transparent={true}
          animationType="fade"
          onRequestClose={() => setShowArtworkActionModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Cover Artwork</Text>
              <Text style={styles.modalSubtitle}>
                Add, change, or remove custom artwork for this song
              </Text>

              <TouchableOpacity
                style={styles.artworkOptionBtn}
                onPress={handlePickArtwork}
                activeOpacity={0.7}
              >
                <Ionicons name="images-outline" size={20} color={theme.textPrimary} />
                <Text style={styles.artworkOptionText}>Choose from Photos</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.artworkOptionBtn, styles.artworkOptionDeleteBtn]}
                onPress={handleRemoveArtwork}
                activeOpacity={0.7}
              >
                <Ionicons name="trash-outline" size={20} color={theme.error} />
                <Text style={styles.artworkOptionDeleteText}>Remove Artwork</Text>
              </TouchableOpacity>

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={styles.modalCancelBtn}
                  onPress={() => setShowArtworkActionModal(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}
