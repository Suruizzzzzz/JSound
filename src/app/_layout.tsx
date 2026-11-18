import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { initDatabase } from '@/lib/database';
import { getAllTracks } from '@/repositories/trackRepository';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [isReady, setIsReady] = useState(false);
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

        // Preload stored tracks into Zustand store
        const tracks = await getAllTracks();
        setTracks(tracks);
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        setIsReady(true);
        await SplashScreen.hideAsync().catch(() => {});
      }
    }

    prepare();
  }, [setTracks, initTheme]);

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
