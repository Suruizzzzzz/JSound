import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { initDatabase, getSetting } from '@/lib/database';
import { getAllTracks } from '@/repositories/trackRepository';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [shouldRedirectToTabs, setShouldRedirectToTabs] = useState(false);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const mode = useThemeStore((state) => state.mode);
  const initTheme = useThemeStore((state) => state.initTheme);

  useEffect(() => {
    async function prepare() {
      try {
        // Initialize SQLite Database schema
        await initDatabase();

        // Load saved theme preference
        await initTheme();

        // Load saved local user profile
        await useAuthStore.getState().initProfile();

        // Preload stored tracks into Zustand store
        const tracks = await getAllTracks();
        setTracks(tracks);

        // Check if user has already seen onboarding
        const seenWelcome = await getSetting('has_seen_welcome');
        if (seenWelcome === 'true') {
          setShouldRedirectToTabs(true);
        }
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    }

    prepare();
  }, [setTracks, initTheme]);

  useEffect(() => {
    if (isReady && shouldRedirectToTabs) {
      router.replace('/(tabs)');
    }
  }, [isReady, shouldRedirectToTabs, router]);

  if (!isReady) {
    return null;
  }

  return (
    <View style={{ flex: 1 }}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="auth" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="settings" />
      </Stack>
    </View>
  );
}
