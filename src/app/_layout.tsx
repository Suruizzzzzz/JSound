import 'react-native-url-polyfill/auto';
import React, { useEffect } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, useRouter, usePathname, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { initDatabase, setSetting } from '@/lib/database';
import { getAllTracks } from '@/repositories/trackRepository';
import { supabase } from '@/services/supabase';
import { usePlayerStore } from '@/store/playerStore';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore, isExplicitSignOutInProgress } from '@/store/authStore';

SplashScreen.preventAutoHideAsync().catch(() => {});

const globalAny = globalThis as unknown as {
  ErrorUtils?: {
    getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
    setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  };
  HermesInternal?: {
    enablePromiseRejectionTracker?: (options: {
      allRejections: boolean;
      onUnhandled: (id: string, rejection: unknown) => void;
      onHandled: (id: string) => void;
    }) => void;
  };
  __jstreamGlobalErrorHandlersInstalled?: boolean;
};

if (!globalAny.__jstreamGlobalErrorHandlersInstalled) {
  globalAny.__jstreamGlobalErrorHandlersInstalled = true;

  try {
    const errorUtils = globalAny.ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const previousHandler = errorUtils.getGlobalHandler?.();
      errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
        console.warn('[JStream] Uncaught JS error:', isFatal ? 'fatal' : 'non-fatal', error);
        SplashScreen.hideAsync().catch(() => {});
        if (__DEV__ && previousHandler) {
          previousHandler(error, isFatal);
        } else if (isFatal && previousHandler) {
          try {
            previousHandler(error, false);
          } catch {
            // Avoid process abort where recoverable in release builds
          }
        }
      });
    }
  } catch {
    // Ignore if ErrorUtils is unavailable
  }

  try {
    globalAny.HermesInternal?.enablePromiseRejectionTracker?.({
      allRejections: true,
      onUnhandled: (id, rejection) => {
        console.warn(`[JStream] Unhandled promise rejection (${id}):`, rejection);
      },
      onHandled: () => {},
    });
  } catch {
    // Ignore if Hermes rejection tracker is unavailable
  }
}

function ErrorFallbackScreen({
  message,
  onRetry,
}: {
  message?: string;
  onRetry: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#0A0A0A',
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 28,
      }}
    >
      <Text style={{ color: '#F4F4F2', fontSize: 18, fontWeight: '700', marginBottom: 8 }}>
        Something went wrong
      </Text>
      <Text
        style={{
          color: '#9A9A9A',
          fontSize: 13,
          textAlign: 'center',
          marginBottom: 20,
        }}
        numberOfLines={4}
      >
        {message || 'An unexpected error occurred. Tap below to reload.'}
      </Text>
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.8}
        style={{
          backgroundColor: '#F4F4F2',
          paddingHorizontal: 22,
          paddingVertical: 11,
          borderRadius: 10,
        }}
      >
        <Text style={{ color: '#0A0A0A', fontSize: 14, fontWeight: '700' }}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    console.warn('[JStream] Route ErrorBoundary caught error:', error);
    SplashScreen.hideAsync().catch(() => {});
  }, [error]);

  return <ErrorFallbackScreen message={error?.message} onRetry={retry} />;
}

interface RootErrorBoundaryState {
  hasError: boolean;
  errorMessage?: string;
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: unknown): RootErrorBoundaryState {
    SplashScreen.hideAsync().catch(() => {});
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : String(error || ''),
    };
  }

  componentDidCatch(error: unknown) {
    console.warn('[JStream] RootErrorBoundary caught render error:', error);
    SplashScreen.hideAsync().catch(() => {});
  }

  handleReset = () => {
    this.setState({ hasError: false, errorMessage: undefined });
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallbackScreen
          message={this.state.errorMessage}
          onRetry={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const pathnameRef = React.useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);
  const setTracks = usePlayerStore((state) => state.setTracks);
  const mode = useThemeStore((state) => state.mode);
  const theme = useThemeStore((state) => state.theme);
  const initTheme = useThemeStore((state) => state.initTheme);

  // Auto-redirect to /(tabs) when authenticated if currently on welcome or auth screens
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || isExplicitSignOutInProgress()) return;
      const currentPath = pathnameRef.current;
      if (session?.user && (currentPath === '/auth' || currentPath === '/' || currentPath === '/index')) {
        setSetting('has_seen_welcome', 'true').catch(() => {});
        router.replace('/(tabs)');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

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
      } catch (e) {
        console.warn('Initialization error:', e);
      } finally {
        await SplashScreen.hideAsync().catch(() => {});

        // Request Android 13+ notification permission non-blockingly after hydration
        const isExpoGo =
          Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
          Constants.appOwnership === 'expo';
        if (!isExpoGo && Platform.OS === 'android') {
          requestNotificationPermissionsAsync().catch((permErr) => {
            console.warn('Failed to request notification permission:', permErr);
          });
        }
      }
    }

    prepare();

    // Guaranteed failsafe: dismiss splash screen within 1500ms even if startup async hangs
    const failsafeTimer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 1500);

    return () => {
      isMounted = false;
      clearTimeout(failsafeTimer);
    };
  }, [setTracks, initTheme]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0A0A0A' }}>
      <RootErrorBoundary>
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
      </RootErrorBoundary>
    </GestureHandlerRootView>
  );
}
