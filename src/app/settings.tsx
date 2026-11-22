import ConfirmModal from "@/components/ConfirmModal";
import { setSetting } from "@/lib/database";
import { clearAllTracks as clearDbTracks } from "@/repositories/trackRepository";
import { useAuthStore } from "@/services/authService";
import { pickAndImportAudioFiles } from "@/services/localScannerService";
import { usePlayerStore } from "@/store/playerStore";
import { useThemeStore } from "@/store/themeStore";
import { useGuideStore } from "@/store/guideStore";
import { createStyles } from "@/styles/settings.styles";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useNavigation } from "expo-router";
import { CommonActions } from "@react-navigation/native";
import { useMemo, useState } from "react";
import {
  Image,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function SettingsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const setThemeMode = useThemeStore((state) => state.setThemeMode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const user = useAuthStore((state) => state.user);
  const signOut = useAuthStore((state) => state.signOut);

  const autoPlay = usePlayerStore((state) => state.autoPlay);
  const setAutoPlay = usePlayerStore((state) => state.setAutoPlay);
  const sleepTimerMinutes = usePlayerStore((state) => state.sleepTimerMinutes);
  const setSleepTimer = usePlayerStore((state) => state.setSleepTimer);
  const clearStoreTracks = usePlayerStore((state) => state.clearAllTracks);
  const setTracks = usePlayerStore((state) => state.setTracks);

  const [showClearModal, setShowClearModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  // Theme-adaptive watermark
  const logoSource = useMemo(
    () =>
      mode === "dark"
        ? require("@/assets/images/logo-dark.png")
        : require("@/assets/images/logo-light.png"),
    [mode],
  );

  const handleImport = async () => {
    try {
      const imported = await pickAndImportAudioFiles();
      setTracks(imported);
      setImportStatus(
        `Imported ${imported.length} track${imported.length === 1 ? "" : "s"}`,
      );
      setTimeout(() => setImportStatus(null), 3000);
    } catch (e: any) {
      console.warn("Import error in settings:", e);
    }
  };

  const handleConfirmClearLibrary = async () => {
    setShowClearModal(false);
    try {
      await clearDbTracks();
      await clearStoreTracks();
      setImportStatus("Library cleared");
      setTimeout(() => setImportStatus(null), 3000);
    } catch (e) {
      console.warn("Error clearing library:", e);
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
    } catch (e) {
      console.warn("Error during logout:", e);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      {/* Subtle Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      {/* Header Bar */}
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={20} color={theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* APPEARANCE */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Appearance</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name={mode === "dark" ? "moon-outline" : "sunny-outline"}
                  size={18}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>Theme Mode</Text>
                <Text style={styles.rowSubtitle}>Soft monochrome contrast</Text>
              </View>
            </View>

            <View style={styles.themeSegmentGroup}>
              <TouchableOpacity
                style={[
                  styles.themeSegmentButton,
                  mode === "light" && styles.themeSegmentActive,
                ]}
                onPress={() => setThemeMode("light")}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.themeSegmentText,
                    mode === "light" && styles.themeSegmentTextActive,
                  ]}
                >
                  Light
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.themeSegmentButton,
                  mode === "dark" && styles.themeSegmentActive,
                ]}
                onPress={() => setThemeMode("dark")}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.themeSegmentText,
                    mode === "dark" && styles.themeSegmentTextActive,
                  ]}
                >
                  Dark
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* PLAYBACK */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Playback</Text>
        </View>

        <View style={styles.card}>
          {/* Auto-Play Queue */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="play-skip-forward-outline"
                  size={17}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>Auto-Play Queue</Text>
                <Text style={styles.rowSubtitle}>
                  Advance to next song when finished
                </Text>
              </View>
            </View>

            <Switch
              value={autoPlay}
              onValueChange={setAutoPlay}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={theme.surface}
            />
          </View>

          <View style={styles.rowDivider} />

          {/* Sleep Timer */}
          <View style={styles.row}>
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="timer-outline"
                  size={17}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>Sleep Timer</Text>
                <Text style={styles.rowSubtitle}>
                  {sleepTimerMinutes
                    ? `Pauses in ${sleepTimerMinutes}m`
                    : "Pause playback automatically"}
                </Text>
              </View>
            </View>

            <View style={styles.timerPillGroup}>
              {([null, 15, 30, 60] as (number | null)[]).map((val) => {
                const isActive = sleepTimerMinutes === val;
                const label = val === null ? "Off" : `${val}m`;
                return (
                  <TouchableOpacity
                    key={label}
                    style={[
                      styles.timerPill,
                      isActive && styles.timerPillActive,
                    ]}
                    onPress={() => setSleepTimer(val)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.timerPillText,
                        isActive && styles.timerPillTextActive,
                      ]}
                    >
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>

        {/* LIBRARY & STORAGE */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Library &amp; Storage</Text>
        </View>

        <View style={styles.card}>
          {/* Import Local Audio */}
          <TouchableOpacity
            style={styles.row}
            onPress={handleImport}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="folder-open-outline"
                  size={17}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>Import Local Audio</Text>
                <Text style={styles.rowSubtitle}>
                  {importStatus || "Select audio files from device storage"}
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.textSecondary}
            />
          </TouchableOpacity>

          <View style={styles.rowDivider} />

          {/* Clear Indexed Library */}
          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowClearModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="trash-outline"
                  size={17}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={[styles.rowTitle, styles.dangerText]}>
                  Clear Indexed Library
                </Text>
                <Text style={styles.rowSubtitle}>
                  Reset SQLite database index
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* HELP & TOUR */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Help &amp; Tour</Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => {
              useGuideStore.getState().openGuide();
              router.navigate('/(tabs)');
            }}
            activeOpacity={0.7}
            accessibilityLabel="Replay App Walkthrough"
          >
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="help-circle-outline"
                  size={18}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>App Walkthrough</Text>
                <Text style={styles.rowSubtitle}>
                  Replay the interactive JStream feature tour
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* SESSION & ACCOUNT */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Session &amp; Account</Text>
        </View>

        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => setShowLogoutModal(true)}
            activeOpacity={0.7}
          >
            <View style={styles.rowLeft}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name="log-out-outline"
                  size={17}
                  color={theme.textPrimary}
                />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowTitle}>Log Out</Text>
                <Text style={styles.rowSubtitle}>
                  {user.is_logged_in
                    ? `Sign out of ${user.email || user.name}`
                    : "Exit session & return to homepage"}
                </Text>
              </View>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={theme.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>Li Xun</Text>
      </ScrollView>

      {/* Clear Library Confirmation Modal */}
      <ConfirmModal
        visible={showClearModal}
        title="Clear Indexed Library"
        message="Are you sure you want to clear all indexed offline tracks? Your audio files on device storage will remain safe and untouched."
        icon="trash-outline"
        confirmText="Clear All"
        isDestructive={true}
        onConfirm={handleConfirmClearLibrary}
        onCancel={() => setShowClearModal(false)}
      />

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        visible={showLogoutModal}
        title="Log Out"
        message={
          user.is_logged_in
            ? "Are you sure you want to log out of your account? You will return to the homepage."
            : "Are you sure you want to exit your session? You will return to the homepage."
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
