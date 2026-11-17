import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { scanLocalMusic, pickAndImportAudioFiles } from '@/services/localScannerService';
import { getAllTracks, deleteTrack as removeTrackFromDb } from '@/repositories/trackRepository';
import TrackItem from '@/components/TrackItem';
import { createStyles } from '@/styles/index.styles';

export default function LibraryScreen() {
  const tracks = usePlayerStore((state) => state.tracks);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const removeTrackFromStore = usePlayerStore((state) => state.removeTrack);

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

  const [isScanning, setIsScanning] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

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
    })();
    return () => {
      isMounted = false;
    };
  }, [setTracks]);

  const handleScanMusic = async () => {
    if (isScanning || isImporting) return;
    setIsScanning(true);
    setScanMessage(null);

    try {
      const scanned = await scanLocalMusic();
      setTracks(scanned);
      setScanMessage(`Scan complete! ${scanned.length} track${scanned.length === 1 ? '' : 's'} imported.`);
    } catch (error: any) {
      if (error?.message === 'PERMISSION_RESTRICTED') {
        Alert.alert(
          'Storage Access Restricted',
          'Media library permission is restricted or running inside Expo Go. Would you like to select and import your audio files directly using Android file picker?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Import Audio Files',
              onPress: handleImportAudio,
            },
          ]
        );
      } else {
        Alert.alert('Scan Local Music', error?.message || 'Could not scan local music.');
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
      setScanMessage(`Import complete! ${imported.length} track${imported.length === 1 ? '' : 's'} available.`);
    } catch (error: any) {
      console.warn('Audio import failed:', error);
      Alert.alert('Import Audio Files', error?.message || 'Could not import selected files.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleDeleteTrack = async (id: string) => {
    try {
      await removeTrackFromDb(id);
      await removeTrackFromStore(id);
    } catch (error) {
      console.warn('Failed to delete track:', error);
    }
  };

  const renderHeader = () => (
    <View style={styles.header}>
      {/* Top Branding Bar with Clean Standalone Logo, Title, and Sun/Moon Theme Toggle */}
      <View style={styles.topBar}>
        <View style={styles.brandRow}>
          <Image
            source={logoSource}
            style={styles.logoImage}
            resizeMode="contain"
          />
          <View>
            <Text style={styles.appTitle}>JSound</Text>
            <Text style={styles.appTagline}>PURE AUDIO</Text>
          </View>
        </View>

        <View style={styles.topActions}>
          <View style={styles.offlineBadge}>
            <Ionicons name="cloud-offline-outline" size={12} color={theme.textSecondary} />
            <Text style={styles.offlineBadgeText}>Offline</Text>
          </View>
        </View>
      </View>

      {/* Library Stats & Section Heading */}
      <View style={styles.libraryMetaRow}>
        <Text style={styles.libraryTitle}>Your Library</Text>
        <Text style={styles.trackCountText}>
          {tracks.length} track{tracks.length === 1 ? '' : 's'}
        </Text>
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

  const renderEmptyState = () => (
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
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      <FlatList
        data={tracks}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TrackItem
            track={item}
            queue={tracks}
            onDelete={handleDeleteTrack}
          />
        )}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}
