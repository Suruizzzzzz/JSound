import 'react-native-url-polyfill/auto';
import React, { useEffect, useState } from 'react';
import { View, LogBox } from 'react-native';
import { Stack, useRouter, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initDatabase, getSetting, setSetting } from '@/lib/database';
import { getAllTracks } from '@/repositories/trackRepository';
import { supabase } from '@/services/supabase';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';

// Safeguard against Expo Go NativeJSLogger warnings for unbound AudioControlsService
LogBox.ignoreLogs([
  'Failed to activate lock screen controls',
  'Failed to start the expo-audio playback service',
]);

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [isReady, setIsReady] = useState(false);
  const [shouldRedirectToTabs, setShouldRedirectToTabs] = useState(false);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const mode = useThemeStore((state) => state.mode);
  const initTheme = useThemeStore((state) => state.initTheme);

  // Auto-redirect to /(tabs) when authenticated if currently on welcome or auth screens
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user && (pathname === '/auth' || pathname === '/' || pathname === '/index')) {
        setSetting('has_seen_welcome', 'true').catch(() => {});
        router.replace('/(tabs)');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [pathname, router]);

  useEffect(() => {
    let isMounted = true;

    async function prepare() {
      try {
        // Initialize SQLite Database schema
        await initDatabase().catch((e) => console.warn('initDatabase error:', e));

        // Load saved theme preference
        await initTheme().catch((e) => console.warn('initTheme error:', e));

        // Load saved local user profile
        await useAuthStore.getState().initProfile().catch((e) => console.warn('initProfile error:', e));

        // Preload stored tracks into Zustand store
        const tracks = await getAllTracks().catch(() => []);
        if (isMounted) {
          setTracks(tracks);
        }

        // Request notification permission on Android 13+ for lock screen media notification controls
        const isExpoGo =
          Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
          Constants.appOwnership === 'expo';
        if (!isExpoGo) {
          try {
            await requestNotificationPermissionsAsync();
          } catch (permErr) {
            console.warn('Failed to request notification permission:', permErr);
          }
        }

        // Check if user has already seen onboarding
        const seenWelcome = await getSetting('has_seen_welcome').catch(() => null);
        if (isMounted && seenWelcome === 'true') {
          setShouldRedirectToTabs(true);
        }
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        if (isMounted) {
          setIsReady(true);
        }
        await SplashScreen.hideAsync().catch(() => {});
      }
    }

    prepare();

    // Guaranteed failsafe: dismiss splash screen within 2.5s even if startup async hangs
    const failsafeTimer = setTimeout(() => {
      if (isMounted) {
        setIsReady(true);
      }
      SplashScreen.hideAsync().catch(() => {});
    }, 2500);

    return () => {
      isMounted = false;
      clearTimeout(failsafeTimer);
    };
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
