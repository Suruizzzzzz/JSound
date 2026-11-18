import React, { useMemo, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/services/authService';
import { setSetting } from '@/lib/database';
import ConfirmModal from '@/components/ConfirmModal';
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
  const isSyncing = useAuthStore((state) => state.isSyncing);
  const syncPlaylistsToCloud = useAuthStore((state) => state.syncPlaylistsToCloud);
  const signOut = useAuthStore((state) => state.signOut);
  const setProfileName = useAuthStore((state) => state.setProfileName);
  const setProfileAvatar = useAuthStore((state) => state.setProfileAvatar);

  const tracks = usePlayerStore((state) => state.tracks);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<string | null>(null);

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
    await signOut();
    try {
      await setSetting('has_seen_welcome', 'false');
    } catch {
      // ignore
    }
    router.replace('/');
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
                {(user.name || 'J').charAt(0).toUpperCase()}
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
              {user.is_logged_in ? 'PRO SYNC' : 'OFFLINE'}
            </Text>
          </View>
        </View>

        {/* 3-Column Stats Strip (Minimalist, zero developer jargon) */}
        <View style={styles.statsCard}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{tracks.length}</Text>
            <Text style={styles.statLabel}>Tracks</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={styles.statValue}>{formatTotalTime(totalDuration)}</Text>
            <Text style={styles.statLabel}>Listening Time</Text>
          </View>

          <View style={styles.statDivider} />

          <View style={styles.statItem}>
            <Text style={styles.statValue}>On-Device</Text>
            <Text style={styles.statLabel}>Library</Text>
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
          </View>
        )}

        {/* Bottom Session Action: Log Out */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={() => setShowLogoutModal(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.textSecondary} />
          <Text style={styles.logoutButtonText}>
            {user.is_logged_in ? 'Log Out' : 'Exit Guest & Return to Start'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Custom Monochrome Logout Confirmation Modal */}
      <ConfirmModal
        visible={showLogoutModal}
        title={user.is_logged_in ? 'Log Out' : 'Exit Guest Session'}
        message={
          user.is_logged_in
            ? 'Are you sure you want to log out of your account?'
            : 'Are you sure you want to exit your guest session and return to the welcome screen?'
        }
        icon="log-out-outline"
        confirmText="Log Out"
        isDestructive={true}
        onConfirm={handleConfirmLogout}
        onCancel={() => setShowLogoutModal(false)}
      />

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
            <Text style={styles.modalSubtitle}>Personalize your on-device listener profile</Text>
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
              Change or remove your on-device listener photo
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
    </SafeAreaView>
  );
}
