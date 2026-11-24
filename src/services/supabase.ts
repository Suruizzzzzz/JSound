import * as SecureStore from 'expo-secure-store';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

export const ExpoSecureStoreAdapter = {
  getItem: (key: string): Promise<string | null> => {
    if (typeof window === 'undefined') {
      return Promise.resolve(null);
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          return Promise.resolve(localStorage.getItem(key));
        }
      } catch {
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    }
    try {
      return SecureStore.getItemAsync(key);
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key: string, value: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.resolve();
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(key, value);
        }
      } catch {
        // no-op
      }
      return Promise.resolve();
    }
    try {
      return SecureStore.setItemAsync(key, value);
    } catch {
      return Promise.resolve();
    }
  },
  removeItem: (key: string): Promise<void> => {
    if (typeof window === 'undefined') {
      return Promise.resolve();
    }
    if (Platform.OS === 'web') {
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.removeItem(key);
        }
      } catch {
        // no-op
      }
      return Promise.resolve();
    }
    try {
      return SecureStore.deleteItemAsync(key);
    } catch {
      return Promise.resolve();
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

