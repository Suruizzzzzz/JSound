import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/store/authStore';
import { getSetting, setSetting, getAllPlaylists, getDatabase } from '@/lib/database';
import {
  runAutoDownloadSync,
  exportLibraryBackupJson,
  importLibraryBackupJson,
} from '@/services/playlistSyncService';
import { useSyncProgressStore } from '@/store/syncProgressStore';
import { createStyles } from '@/styles/profile.styles';

function formatTotalTime(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export default function ProfileScreen() {
  const router = useRouter();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const user = useAuthStore((state) => state.user);
  const isAuthHydrated = useAuthStore((state) => state.isAuthHydrated);
  const isSyncing = useAuthStore((state) => state.isSyncing);
  const syncPlaylistsToCloud = useAuthStore((state) => state.syncPlaylistsToCloud);
  const setProfileName = useAuthStore((state) => state.setProfileName);
  const setProfileAvatar = useAuthStore((state) => state.setProfileAvatar);
  const importGuestLibraryToAccount = useAuthStore((state) => state.importGuestLibraryToAccount);

  const tracks = usePlayerStore((state) => state.tracks);

  const [playlistCount, setPlaylistCount] = useState<number>(0);
  const [storageUsageMb, setStorageUsageMb] = useState<string | null>(null);
  const [guestTracksCount, setGuestTracksCount] = useState<number>(0);
  const [isClaimingGuest, setIsClaimingGuest] = useState<boolean>(false);

  const [showNameModal, setShowNameModal] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);

  // Sync Progress & History Store
  const syncDownloading = useSyncProgressStore((state) => state.isDownloading);
  const syncCurrentIndex = useSyncProgressStore((state) => state.currentIndex);
  const syncTotalCount = useSyncProgressStore((state) => state.totalCount);
  const syncCurrentTitle = useSyncProgressStore((state) => state.currentTitle);
  const cancelSyncDownload = useSyncProgressStore((state) => state.cancelSyncDownload);
  const showSyncHistoryModal = useSyncProgressStore((state) => state.showSyncHistoryModal);
  const syncedTracks = useSyncProgressStore((state) => state.syncedTracks);
  const isLoadingHistory = useSyncProgressStore((state) => state.isLoadingHistory);
  const openSyncHistoryModal = useSyncProgressStore((state) => state.openSyncHistoryModal);
  const closeSyncHistoryModal = useSyncProgressStore((state) => state.closeSyncHistoryModal);
  const startSyncDownload = useSyncProgressStore((state) => state.startSyncDownload);

  // Load playlist count from local database after auth hydration
  useEffect(() => {
    if (!isAuthHydrated) return;
    let isMounted = true;
    async function loadPlaylistCount() {
      try {
        const all = await getAllPlaylists();
        if (isMounted) {
          setPlaylistCount(all.length);
        }
      } catch (err) {
        console.warn('Failed to load playlist count:', err);
      }
    }
    loadPlaylistCount();
    return () => {
      isMounted = false;
    };
  }, [isAuthHydrated, user?.id]);

  // Calculate local audio disk storage footprint in MB
  useEffect(() => {
    let isMounted = true;
    async function calculateStorage() {
      try {
        let totalBytes = 0;
        for (const t of tracks) {
          if (t.local_audio_uri && !t.local_audio_uri.startsWith('http')) {
            try {
              const info = await FileSystem.getInfoAsync(t.local_audio_uri);
              if (info.exists && typeof info.size === 'number') {
                totalBytes += info.size;
              }
            } catch {
              // Non-fatal if specific file is inaccessible
            }
          }
        }
        if (isMounted) {
          const mb = (totalBytes / (1024 * 1024)).toFixed(1);
          setStorageUsageMb(mb);
        }
      } catch (err) {
        console.warn('Failed to calculate local audio storage footprint:', err);
        if (isMounted) {
          setStorageUsageMb('0.0');
        }
      }
    }
    calculateStorage();
    return () => {
      isMounted = false;
    };
  }, [tracks]);

  useEffect(() => {
    async function loadAutoDownloadSetting() {
      const saved = await getSetting('auto_download_synced', 'true');
      setAutoDownloadEnabled(saved === 'true');
    }
    loadAutoDownloadSetting();
  }, []);

  const handleToggleAutoDownload = async (val: boolean) => {
    setAutoDownloadEnabled(val);
    await setSetting('auto_download_synced', val ? 'true' : 'false');
    if (val) {
      runAutoDownloadSync().catch(() => {});
    }
  };

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  const totalDuration = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration || 0), 0),
    [tracks]
  );

  const [showAvatarActionModal, setShowAvatarActionModal] = useState(false);

  const handleAvatarPress = () => {
    if (user.avatar_url) {
      setShowAvatarActionModal(true);
    } else {
      handlePickNewAvatar();
    }
  };

  const handlePickNewAvatar = async () => {
    setShowAvatarActionModal(false);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const pickedUri = result.assets[0].uri;
        const docDir = FileSystem.documentDirectory;
        if (docDir) {
          const targetUri = `${docDir}jstream_profile_avatar.jpg`;
          try {
            await FileSystem.copyAsync({ from: pickedUri, to: targetUri });
            await setProfileAvatar(targetUri);
          } catch {
            await setProfileAvatar(pickedUri);
          }
        } else {
          await setProfileAvatar(pickedUri);
        }
      }
    } catch (err) {
      console.warn('Failed to pick profile image:', err);
    }
  };

  const handleRemoveAvatar = async () => {
    setShowAvatarActionModal(false);
    try {
      const docDir = FileSystem.documentDirectory;
      if (docDir) {
        const targetUri = `${docDir}jstream_profile_avatar.jpg`;
        try {
          await FileSystem.deleteAsync(targetUri, { idempotent: true });
        } catch {
          // non-fatal
        }
      }
      await setProfileAvatar(null);
    } catch (err) {
      console.warn('Failed to remove profile avatar:', err);
    }
  };

  const handleOpenNameModal = () => {
    setEditingName(user.name);
    setShowNameModal(true);
  };

  const handleSaveName = async () => {
    if (editingName.trim()) {
      await setProfileName(editingName.trim());
    }
    setShowNameModal(false);
  };

  const handleSyncCloud = async () => {
    try {
      await syncPlaylistsToCloud();
      setSyncFeedback('Playlists synchronized with cloud');
      setTimeout(() => setSyncFeedback(null), 3000);
      openSyncHistoryModal();
    } catch {
      setSyncFeedback('Cloud sync failed');
      setTimeout(() => setSyncFeedback(null), 3000);
    }
  };

  // Check if unauthenticated guest tracks exist in SQLite
  useEffect(() => {
    let isMounted = true;
    async function checkGuestTracks() {
      if (!user.is_logged_in) {
        setGuestTracksCount(0);
        return;
      }
      try {
        const db = await getDatabase();
        const row = await db.getFirstAsync<{ count: number }>(
          "SELECT COUNT(*) as count FROM tracks WHERE user_id = 'local_guest'"
        );
        if (isMounted) {
          setGuestTracksCount(row?.count ?? 0);
        }
      } catch {
        // ignore
      }
    }
    checkGuestTracks();
    return () => {
      isMounted = false;
    };
  }, [user.is_logged_in]);

  const handleClaimGuestTracks = async () => {
    setIsClaimingGuest(true);
    try {
      const res = await importGuestLibraryToAccount();
      Alert.alert(
        'Music Claimed',
        `Successfully transferred ${res.tracksCount} tracks and ${res.playlistsCount} playlists to your account.`
      );
      setGuestTracksCount(0);
    } catch (err: any) {
      Alert.alert('Claim Error', err?.message || 'Could not transfer guest tracks.');
    } finally {
      setIsClaimingGuest(false);
    }
  };

  const handleExportBackup = async () => {
    try {
      const json = await exportLibraryBackupJson();
      const docDir = FileSystem.documentDirectory;
      if (docDir) {
        const targetPath = `${docDir}jstream_library_backup.json`;
        await FileSystem.writeAsStringAsync(targetPath, json);
      }
      await Clipboard.setStringAsync(json);
      Alert.alert(
        'Backup Exported',
        'Your library metadata has been exported and copied to your clipboard. A backup file (jstream_library_backup.json) was also saved to app storage.'
      );
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Failed to export library.');
    }
  };

  const handleImportBackup = async () => {
    try {
      const pickRes = await DocumentPicker.getDocumentAsync({
        type: 'application/json',
        copyToCacheDirectory: true,
      });
      if (pickRes.canceled || !pickRes.assets?.[0]?.uri) {
        return;
      }
      const fileUri = pickRes.assets[0].uri;
      const fileContent = await FileSystem.readAsStringAsync(fileUri);
      const importRes = await importLibraryBackupJson(fileContent);
      if (importRes.success) {
        Alert.alert(
          'Backup Restored',
          `Successfully restored ${importRes.tracksCount} tracks and ${importRes.playlistsCount} playlists.`
        );
      } else {
        Alert.alert('Import Error', importRes.error || 'Failed to restore backup.');
      }
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'Could not read backup file.');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Subtle Cat Logo Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with Settings Gear Button */}
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Profile</Text>
          <TouchableOpacity
            style={styles.settingsIconButton}
            onPress={() => router.push('/settings')}
            activeOpacity={0.7}
            accessibilityLabel="Open Settings"
          >
            <Ionicons name="settings-outline" size={20} color={theme.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* User Identity Section */}
        <View style={styles.identitySection}>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={handleAvatarPress}
            activeOpacity={0.8}
            accessibilityLabel="Change profile avatar"
          >
            {user.avatar_url ? (
              <Image source={{ uri: user.avatar_url }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarInitial}>
                {(user.name || 'J').trim().charAt(0).toUpperCase()}
              </Text>
            )}
            <View style={styles.avatarEditBadge}>
              <Ionicons name="camera" size={11} color={theme.onPrimary} />
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.userNameRow}
            onPress={handleOpenNameModal}
            activeOpacity={0.7}
            accessibilityLabel="Edit display name"
          >
            <Text style={styles.userName}>{user.name}</Text>
            <Ionicons
              name="pencil"
              size={14}
              color={theme.textSecondary}
              style={styles.editNameIcon}
            />
          </TouchableOpacity>

          <Text style={styles.userSubtitle}>
            {user.is_logged_in ? user.email : 'Local Library'}
          </Text>
        </View>

        {/* 3-Column Stats Strip (Tracks | Playlists | Listening Time) + Offline Storage Footprint */}
        <View style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{tracks.length}</Text>
              <Text style={styles.statLabel}>Tracks</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statItem}>
              <Text style={styles.statValue}>{playlistCount}</Text>
              <Text style={styles.statLabel}>Playlists</Text>
            </View>

            <View style={styles.statDivider} />

            <View style={styles.statItem}>
              <Text style={styles.statValue}>{formatTotalTime(totalDuration)}</Text>
              <Text style={styles.statLabel}>Listening Time</Text>
            </View>
          </View>

          {/* Subtle Offline Storage Footprint Indicator */}
          <View style={styles.storageIndicatorRow}>
            <Ionicons name="hardware-chip-outline" size={14} color={theme.textSecondary} />
            <Text style={styles.storageIndicatorText}>Offline Storage:</Text>
            <Text style={styles.storageIndicatorValue}>
              {storageUsageMb !== null ? `${storageUsageMb} MB on device` : 'Calculating...'}
            </Text>
          </View>
        </View>

        {/* Account Sync Card */}
        <Text style={styles.sectionTitle}>Account &amp; Cloud</Text>

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
              {syncCurrentTitle || 'Preparing track...'}
            </Text>
            <View style={styles.progressBarTrack}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${
                      syncTotalCount > 0
                        ? Math.min(
                            100,
                            Math.max(
                              8,
                              Math.round(
                                ((syncCurrentIndex - 0.5) / syncTotalCount) * 100
                              )
                            )
                          )
                        : 8
                    }%`,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {!user.is_logged_in ? (
          <View style={styles.guestReminderCard}>
            <View style={styles.guestReminderRow}>
              <View style={styles.accountIconWrap}>
                <Ionicons name="person-outline" size={18} color={theme.textPrimary} />
              </View>
              <Text style={styles.guestReminderText}>
                Using Guest Mode — Sign in or register to back up your playlists and sync your music across devices
              </Text>
            </View>
            <TouchableOpacity
              style={styles.guestSignInButton}
              onPress={() => router.push('/auth')}
              activeOpacity={0.8}
            >
              <Text style={styles.guestSignInButtonText}>Sign In / Register</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {guestTracksCount > 0 && (
              <View
                style={[
                  styles.accountCard,
                  { marginBottom: 14, borderColor: theme.primary, borderWidth: 1 },
                ]}
              >
                <View style={styles.accountRow}>
                  <View style={styles.accountLeft}>
                    <View
                      style={[
                        styles.accountIconWrap,
                        { backgroundColor: theme.primary + '25' },
                      ]}
                    >
                      <Ionicons name="gift-outline" size={18} color={theme.primary} />
                    </View>
                    <View style={styles.accountTextGroup}>
                      <Text style={styles.accountTitle}>Claim On-Device Songs</Text>
                      <Text style={styles.accountSubtitle}>
                        {guestTracksCount} song{guestTracksCount > 1 ? 's' : ''} saved before signing in
                      </Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.syncNowButton}
                    onPress={handleClaimGuestTracks}
                    disabled={isClaimingGuest}
                    activeOpacity={0.8}
                  >
                    {isClaimingGuest ? (
                      <ActivityIndicator size="small" color={theme.onPrimary} />
                    ) : (
                      <Text style={styles.syncNowButtonText}>Claim</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={styles.accountCard}>
              <View style={styles.accountRow}>
                <View style={styles.accountLeft}>
                  <View style={styles.accountIconWrap}>
                    <Ionicons
                      name={user.sync_status === 'synced' ? 'cloud-done-outline' : 'cloud-upload-outline'}
                      size={18}
                      color={theme.textPrimary}
                    />
                  </View>
                  <View style={styles.accountTextGroup}>
                    <Text style={styles.accountTitle}>Cloud Sync</Text>
                    <Text style={styles.accountSubtitle}>
                      {syncFeedback || (user.sync_status === 'synced' ? 'Playlists up to date' : 'Sync pending')}
                    </Text>
                  </View>
                </View>

                <View style={styles.syncStatusGroup}>
                  <View style={styles.syncStatusPill}>
                    <Text style={styles.syncStatusPillText}>
                      {user.sync_status === 'synced' ? 'Synced' : 'Pending'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.syncNowButton}
                    onPress={handleSyncCloud}
                    disabled={isSyncing}
                    activeOpacity={0.8}
                  >
                    {isSyncing ? (
                      <ActivityIndicator size="small" color={theme.onPrimary} />
                    ) : (
                      <Text style={styles.syncNowButtonText}>Sync</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>

              {user.last_synced_at && (
                <Text style={styles.syncTimestamp}>
                  Last synchronized today at {user.last_synced_at}
                </Text>
              )}

              <View style={styles.accountDivider} />

              {/* Auto-Download Synced Tracks Toggle */}
              <View style={styles.autoDownloadRow}>
                <View style={styles.accountLeft}>
                  <View style={styles.accountIconWrap}>
                    <Ionicons name="cloud-download-outline" size={18} color={theme.textPrimary} />
                  </View>
                  <View style={styles.accountTextGroup}>
                    <Text style={styles.accountTitle}>Auto-Download Synced Tracks</Text>
                    <Text style={styles.accountSubtitle}>
                      Download missing audio in background
                    </Text>
                  </View>
                </View>

                <Switch
                  value={autoDownloadEnabled}
                  onValueChange={handleToggleAutoDownload}
                  trackColor={{ false: theme.border, true: theme.primary }}
                  thumbColor={theme.onPrimary}
                />
              </View>

              <View style={styles.accountDivider} />

              {/* Cloud Sync History Row */}
              <TouchableOpacity
                style={styles.autoDownloadRow}
                onPress={openSyncHistoryModal}
                activeOpacity={0.7}
              >
                <View style={styles.accountLeft}>
                  <View style={styles.accountIconWrap}>
                    <Ionicons name="time-outline" size={18} color={theme.textPrimary} />
                  </View>
                  <View style={styles.accountTextGroup}>
                    <Text style={styles.accountTitle}>Cloud Sync History</Text>
                    <Text style={styles.accountSubtitle}>
                      View synced cloud tracks &amp; offline status
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Subtle Settings & Sign Out Hint */}
            <TouchableOpacity
              style={styles.settingsHintRow}
              onPress={() => router.push('/settings')}
              activeOpacity={0.7}
            >
              <Ionicons name="settings-outline" size={14} color={theme.textMuted} />
              <Text style={styles.settingsHintText}>
                Manage account preferences or sign out anytime in Settings
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* Data & Backup Section */}
        <Text style={styles.sectionTitle}>Data &amp; Backup</Text>
        <View style={[styles.accountCard, { marginBottom: 20 }]}>
          {/* Export Backup Row */}
          <TouchableOpacity
            style={styles.autoDownloadRow}
            onPress={handleExportBackup}
            activeOpacity={0.7}
          >
            <View style={styles.accountLeft}>
              <View style={styles.accountIconWrap}>
                <Ionicons name="download-outline" size={18} color={theme.textPrimary} />
              </View>
              <View style={styles.accountTextGroup}>
                <Text style={styles.accountTitle}>Export Library Backup</Text>
                <Text style={styles.accountSubtitle}>
                  Save playlists &amp; metadata to JSON
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>

          <View style={styles.accountDivider} />

          {/* Import Backup Row */}
          <TouchableOpacity
            style={styles.autoDownloadRow}
            onPress={handleImportBackup}
            activeOpacity={0.7}
          >
            <View style={styles.accountLeft}>
              <View style={styles.accountIconWrap}>
                <Ionicons name="push-outline" size={18} color={theme.textPrimary} />
              </View>
              <View style={styles.accountTextGroup}>
                <Text style={styles.accountTitle}>Restore from Backup</Text>
                <Text style={styles.accountSubtitle}>
                  Import songs &amp; playlists from a .json file
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Edit Display Name Modal */}
      <Modal
        visible={showNameModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowNameModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Display Name</Text>
            <Text style={styles.modalSubtitle}>Personalize your listener profile</Text>
            <TextInput
              style={styles.modalInput}
              value={editingName}
              onChangeText={setEditingName}
              placeholder="e.g. JStream Listener"
              placeholderTextColor={theme.textMuted}
              maxLength={30}
              autoFocus
              selectTextOnFocus
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowNameModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveName}
                activeOpacity={0.8}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Avatar Options Modal (Choose / Remove) */}
      <Modal
        visible={showAvatarActionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAvatarActionModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Profile Avatar</Text>
            <Text style={styles.modalSubtitle}>
              Change or remove your listener photo
            </Text>

            <TouchableOpacity
              style={styles.avatarOptionBtn}
              onPress={handlePickNewAvatar}
              activeOpacity={0.7}
            >
              <Ionicons name="images-outline" size={20} color={theme.textPrimary} />
              <Text style={styles.avatarOptionText}>Choose from Photos</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.avatarOptionBtn}
              onPress={handleRemoveAvatar}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={20} color={theme.error} />
              <Text style={styles.avatarOptionDeleteText}>Remove Photo</Text>
            </TouchableOpacity>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowAvatarActionModal(false)}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Cloud Sync History Modal */}
      <Modal
        visible={showSyncHistoryModal}
        transparent={true}
        animationType="fade"
        onRequestClose={closeSyncHistoryModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.historyModalContent}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={styles.modalTitle}>Cloud Sync History</Text>
              <TouchableOpacity onPress={closeSyncHistoryModal} activeOpacity={0.7}>
                <Ionicons name="close" size={20} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Summary Banner */}
            <View style={styles.historySummaryCard}>
              <Text style={styles.historySummaryText}>
                {syncedTracks.length} Songs • {syncedTracks.filter((t) => t.isMissingAudio).length} Cloud Only
              </Text>
              {syncedTracks.filter((t) => t.isMissingAudio).length > 0 && !syncDownloading && (
                <TouchableOpacity
                  style={styles.historyDownloadAllBtn}
                  onPress={() => startSyncDownload()}
                  activeOpacity={0.8}
                >
                  <Text style={styles.historyDownloadAllText}>Download All</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Live progress inside modal if actively downloading */}
            {syncDownloading && (
              <View style={[styles.liveDownloadBanner, { marginBottom: 12, padding: 8 }]}>
                <Text style={styles.liveDownloadBannerTitle}>
                  Downloading {syncCurrentIndex}/{syncTotalCount}: {syncCurrentTitle || 'Preparing track...'}
                </Text>
                <View style={[styles.progressBarTrack, { marginTop: 4 }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${
                          syncTotalCount > 0
                            ? Math.min(
                                100,
                                Math.max(
                                  8,
                                  Math.round(
                                    ((syncCurrentIndex - 0.5) / syncTotalCount) * 100
                                  )
                                )
                              )
                            : 8
                        }%`,
                      },
                    ]}
                  />
                </View>
              </View>
            )}

            {/* Track List */}
            {isLoadingHistory ? (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={theme.primary} />
              </View>
            ) : (
              <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
                {syncedTracks.map((t) => (
                  <View key={t.id} style={styles.historyItem}>
                    {t.local_artwork_uri ? (
                      <Image
                        source={{ uri: t.local_artwork_uri }}
                        style={styles.historyItemThumb}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.historyItemThumbPlaceholder}>
                        <Ionicons name="musical-note" size={14} color={theme.textSecondary} />
                      </View>
                    )}
                    <View style={styles.historyItemInfo}>
                      <Text style={styles.historyItemTitle} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <Text style={styles.historyItemArtist} numberOfLines={1}>
                        {t.artist || 'Unknown Artist'}
                      </Text>
                    </View>
                    <View
                      style={
                        t.isMissingAudio
                          ? styles.historyPillCloud
                          : styles.historyPillDownloaded
                      }
                    >
                      <Text
                        style={
                          t.isMissingAudio
                            ? styles.historyPillTextCloud
                            : styles.historyPillText
                        }
                      >
                        {t.isMissingAudio ? 'Cloud Only' : 'Downloaded'}
                      </Text>
                    </View>
                  </View>
                ))}
                {syncedTracks.length === 0 && (
                  <View style={{ paddingVertical: 30, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                      No tracks synchronized yet.
                    </Text>
                  </View>
                )}
              </ScrollView>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={closeSyncHistoryModal}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
