import * as SecureStore from 'expo-secure-store';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { getSetting, setSetting } from '@/lib/database';

const STORAGE_FALLBACK_PREFIX = 'sb_storage_';

async function getFallbackItem(key: string): Promise<string | null> {
  const val = await getSetting(`${STORAGE_FALLBACK_PREFIX}${key}`, null);
  return val && val.length > 0 ? val : null;
}

async function setFallbackItem(key: string, value: string): Promise<void> {
  await setSetting(`${STORAGE_FALLBACK_PREFIX}${key}`, value);
}

export const ExpoSecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') {
      return null;
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          return localStorage.getItem(key);
        }
      } catch {
        return null;
      }
      return null;
    }
    try {
      const secureVal = await SecureStore.getItemAsync(key);
      if (secureVal !== null && secureVal !== '') {
        return secureVal;
      }
    } catch {
      // Fall back to SQLite app_settings below
    }
    return getFallbackItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, value);
        }
      } catch {
        // no-op
      }
      return;
    }
    // Always persist full value in SQLite app_settings (no 2048-byte limit)
    await setFallbackItem(key, value);
    // Also persist in SecureStore when within the 2048-byte safe threshold
    try {
      if (value.length <= 2000) {
        await SecureStore.setItemAsync(key, value);
      } else {
        await SecureStore.deleteItemAsync(key);
      }
    } catch {
      // SQLite fallback already succeeded
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return;
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        }
      } catch {
        // no-op
      }
      return;
    }
    await setFallbackItem(key, '');
    try {
      await SecureStore.deleteItemAsync(key);
    } catch {
      // no-op
    }
  },
};

const isServer = typeof window === 'undefined';

const rawUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const rawKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

const supabaseUrl =
  rawUrl && (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))
    ? rawUrl
    : 'https://placeholder.supabase.co';

const supabaseAnonKey = rawKey || 'placeholder-anon-key';

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: isServer ? undefined : ExpoSecureStoreAdapter,
    autoRefreshToken: !isServer,
    persistSession: !isServer,
    detectSessionInUrl: false,
  },
});

/**
 * Reads the persisted Supabase session JSON directly from local storage without
 * triggering a network token refresh, returning the cached user id if available.
 */
export async function getCachedSupabaseSessionUserId(): Promise<string | null> {
  if (isServer) return null;
  try {
    const host = new URL(supabaseUrl).hostname.split('.')[0];
    if (!host) return null;
    const raw = await ExpoSecureStoreAdapter.getItem(`sb-${host}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = parsed?.user?.id || parsed?.currentSession?.user?.id;
    return typeof userId === 'string' && userId.length > 0 ? userId : null;
  } catch {
    return null;
  }
}

