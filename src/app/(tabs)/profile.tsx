import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { useAuthStore } from '@/services/authService';
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

  const tracks = usePlayerStore((state) => state.tracks);

  const [showLogoutModal, setShowLogoutModal] = useState(false);
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
          <View style={styles.avatarCircle}>
            {user.is_logged_in ? (
              <Text style={styles.avatarInitial}>{user.name.charAt(0)}</Text>
            ) : (
              <Ionicons name="person-outline" size={34} color={theme.textSecondary} />
            )}
          </View>

          <Text style={styles.userName}>
            {user.is_logged_in ? user.name : 'Local Guest'}
          </Text>

          <Text style={styles.userEmail}>
            {user.is_logged_in ? user.email : 'Offline Session'}
          </Text>

          <View style={[styles.badgePill, user.is_logged_in && styles.badgePillActive]}>
            <Text
              style={[
                styles.badgePillText,
                user.is_logged_in && styles.badgePillTextActive,
              ]}
            >
              {user.is_logged_in ? 'PRO SYNC' : 'GUEST'}
            </Text>
          </View>
        </View>

        {/* 3-Column Stats Strip */}
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
            <Text style={styles.statValue}>SQLite</Text>
            <Text style={styles.statLabel}>Storage</Text>
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
    </SafeAreaView>
  );
}
