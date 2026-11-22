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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useNavigation } from 'expo-router';
import { CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/services/authService';
import ConfirmModal from '@/components/ConfirmModal';
import { getSetting, setSetting, getAllPlaylists } from '@/lib/database';
import { runAutoDownloadSync } from '@/services/playlistSyncService';
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
  const navigation = useNavigation();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const user = useAuthStore((state) => state.user);
  const isSyncing = useAuthStore((state) => state.isSyncing);
  const syncPlaylistsToCloud = useAuthStore((state) => state.syncPlaylistsToCloud);
  const setProfileName = useAuthStore((state) => state.setProfileName);
  const setProfileAvatar = useAuthStore((state) => state.setProfileAvatar);
  const signOut = useAuthStore((state) => state.signOut);

  const tracks = usePlayerStore((state) => state.tracks);

  const [playlistCount, setPlaylistCount] = useState<number>(0);
  const [storageUsageMb, setStorageUsageMb] = useState<string | null>(null);

  const [showNameModal, setShowNameModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);
  const [autoDownloadEnabled, setAutoDownloadEnabled] = useState(true);

  // Load playlist count from local database
  useEffect(() => {
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
  }, []);

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
    } catch {
      setSyncFeedback('Cloud sync failed');
      setTimeout(() => setSyncFeedback(null), 3000);
    }
  };

  const handleConfirmLogout = async () => {
    setShowLogoutModal(false);
    try {
      await signOut();
      await setSetting('has_seen_welcome', 'false');
      let rootNav: any = navigation;
      while (rootNav.getParent()) {
        rootNav = rootNav.getParent();
      }
      rootNav.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'index' }],
        })
      );
    } catch (err) {
      console.warn('Error during sign out:', err);
    }
  };

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

          <Text style={styles.userEmail}>
            {user.is_logged_in ? user.email : 'Offline Mode • On-Device Library'}
          </Text>

          <View style={[styles.badgePill, user.is_logged_in && styles.badgePillActive]}>
            <Text
              style={[
                styles.badgePillText,
                user.is_logged_in && styles.badgePillTextActive,
              ]}
            >
              {user.is_logged_in ? 'PRO SYNC' : 'OFFLINE GUEST'}
            </Text>
          </View>
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

        {!user.is_logged_in ? (
          <TouchableOpacity
            style={styles.accountCard}
            onPress={() => router.push('/auth')}
            activeOpacity={0.8}
          >
            <View style={styles.accountRow}>
              <View style={styles.accountLeft}>
                <View style={styles.accountIconWrap}>
                  <Ionicons name="person-add-outline" size={18} color={theme.textPrimary} />
                </View>
                <View style={styles.accountTextGroup}>
                  <Text style={styles.accountTitle}>Sign In or Create Account</Text>
                  <Text style={styles.accountSubtitle}>
                    Back up &amp; sync your offline library across devices
                  </Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
            </View>
          </TouchableOpacity>
        ) : (
          <>
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
            </View>

            {/* Sign Out Button */}
            <TouchableOpacity
              style={styles.logoutButton}
              onPress={() => setShowLogoutModal(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={18} color={theme.textSecondary} />
              <Text style={styles.logoutButtonText}>Sign Out</Text>
            </TouchableOpacity>
          </>
        )}
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

      {/* Sign Out Confirmation Modal */}
      <ConfirmModal
        visible={showLogoutModal}
        title="Sign Out"
        message="Are you sure you want to sign out? Your offline tracks and local playlists will remain safely stored on this device."
        icon="log-out-outline"
        confirmText="Sign Out"
        isDestructive={true}
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutModal(false)}
      />
    </SafeAreaView>
  );
}
