import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initDatabase, setSetting } from '@/lib/database';
import { getAllTracks } from '@/repositories/trackRepository';
import { supabase } from '@/services/supabase';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const setTracks = usePlayerStore((state) => state.setTracks);
  const mode = useThemeStore((state) => state.mode);
  const theme = useThemeStore((state) => state.theme);
  const initTheme = useThemeStore((state) => state.initTheme);

  const [isAppReady, setIsAppReady] = React.useState(false);

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
        // 1. Initialize SQLite Database schema
        await initDatabase().catch((e) => console.warn('initDatabase error:', e));

        // 2. Load saved theme preference
        await initTheme().catch((e) => console.warn('initTheme error:', e));

        // 3. Hydrate cached auth / last signed-in user_id BEFORE any library query runs
        await useAuthStore.getState().initProfile().catch((e) => console.warn('initProfile error:', e));

        // 4. Preload stored tracks for the resolved user_id into Zustand store
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
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        if (isMounted) {
          setIsAppReady(true);
        }
        await SplashScreen.hideAsync().catch(() => {});
      }
    }

    prepare();

    // Guaranteed failsafe: allow UI and dismiss splash screen within 1500ms even if startup async hangs
    const failsafeTimer = setTimeout(() => {
      if (isMounted) {
        setIsAppReady(true);
      }
      SplashScreen.hideAsync().catch(() => {});
    }, 1500);

    return () => {
      isMounted = false;
      clearTimeout(failsafeTimer);
    };
  }, [setTracks, initTheme]);

  if (!isAppReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        </View>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.background },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="auth" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="settings" />
        </Stack>
      </View>
    </GestureHandlerRootView>
  );
}
