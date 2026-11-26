import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import * as FileSystem from 'expo-file-system/legacy';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let len = base64.length * 0.75;
  if (base64.endsWith('==')) len -= 2;
  else if (base64.endsWith('=')) len -= 1;
  const bytes = new Uint8Array(len);
  let p = 0;
  for (let i = 0; i < base64.length; i += 4) {
    const c1 = chars.indexOf(base64[i]);
    const c2 = chars.indexOf(base64[i + 1]);
    const c3 = chars.indexOf(base64[i + 2]);
    const c4 = chars.indexOf(base64[i + 3]);
    bytes[p++] = (c1 << 2) | (c2 >> 4);
    if (c3 !== -1 && c3 !== 64) bytes[p++] = ((c2 & 15) << 4) | (c3 >> 2);
    if (c4 !== -1 && c4 !== 64) bytes[p++] = ((c3 & 3) << 6) | c4;
  }
  return bytes;
}

// Complete any auth sessions running in browser on web/native
WebBrowser.maybeCompleteAuthSession();

export interface SignUpParams {
  email: string;
  password: string;
  displayName?: string;
}

export interface SignUpResult {
  user: User | null;
  session: Session | null;
  identityCollision?: boolean;
  existingProvider?: 'google';
}

export const authService = {
  /**
   * Register a new user with Email and Password using Supabase's default
   * "Confirm your email address" link verification flow.
   * Detects OAuth / email identity collisions (e.g. existing Google account).
   */
  async signUp({ email, password, displayName }: SignUpParams): Promise<SignUpResult> {
    const cleanEmail = email.trim();
    const cleanName = displayName?.trim();

    try {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: {
            display_name: cleanName || undefined,
          },
        },
      });

      if (error) {
        const errorMsg = error.message?.toLowerCase() || '';
        if (
          errorMsg.includes('already registered') ||
          errorMsg.includes('already exists') ||
          errorMsg.includes('identity already exists')
        ) {
          return {
            user: null,
            session: null,
            identityCollision: true,
            existingProvider: 'google',
          };
        }
        throw error;
      }

      // Supabase returns an empty identities array if user already registered via another provider (e.g. Google OAuth)
      if (data?.user && (!data.user.identities || data.user.identities.length === 0)) {
        return {
          user: data.user,
          session: data.session,
          identityCollision: true,
          existingProvider: 'google',
        };
      }

      return {
        user: data?.user ?? null,
        session: data?.session ?? null,
        identityCollision: false,
      };
    } catch (err: any) {
      const msg = err?.message?.toLowerCase() || '';
      if (
        msg.includes('already registered') ||
        msg.includes('already exists') ||
        msg.includes('identity already exists')
      ) {
        return {
          user: null,
          session: null,
          identityCollision: true,
          existingProvider: 'google',
        };
      }
      throw err;
    }
  },

  /**
   * Resend signup confirmation email link via supabase.auth.resend
   */
  async resendConfirmation(email: string) {
    const cleanEmail = email.trim();

    const { data, error } = await supabase.auth.resend({
      type: 'signup',
      email: cleanEmail,
    });

    if (error) {
      throw error;
    }

    return data;
  },

  /**
   * Check if user's email has been confirmed by signing in with their credentials.
   * If confirmed, successfully returns the authenticated session.
   * If unconfirmed, throws a friendly instruction error.
   */
  async checkEmailConfirmed({ email, password }: { email: string; password: string }) {
    const cleanEmail = email.trim();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      const errorMsg = error.message?.toLowerCase() || '';
      if (
        errorMsg.includes('not confirmed') ||
        errorMsg.includes('email not confirmed') ||
        errorMsg.includes('unconfirmed') ||
        errorMsg.includes('invalid login credentials')
      ) {
        throw new Error(
          "Your email isn't confirmed yet. Please open your inbox and tap 'Confirm email address' first."
        );
      }
      throw error;
    }

    return data;
  },

  /**
   * Sign in with registered Email and Password
   */
  async signInWithEmail(email: string, password: string) {
    const cleanEmail = email.trim();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password,
    });

    if (error) {
      throw error;
    }

    return data;
  },

  /**
   * Sign in with Google OAuth using Expo WebBrowser & deep-link redirect.
   * Dynamically uses `exp://` in Expo Go and `jstream://` in standalone .apk builds.
   */
  async signInWithGoogle() {
    const isExpoGo =
      Constants.appOwnership === 'expo' ||
      Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
    const redirectTo = isExpoGo ? makeRedirectUri() : makeRedirectUri({ scheme: 'jstream' });

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) {
      throw error;
    }

    if (!data?.url) {
      throw new Error('Google authentication URL could not be generated.');
    }

    const authResult = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (authResult.type === 'success' && authResult.url) {
      const url = authResult.url;
      const params: Record<string, string> = {};
      const regex = /[?&#]([^=#]+)=([^&#]*)/g;
      let match;
      while ((match = regex.exec(url)) !== null) {
        params[decodeURIComponent(match[1])] = decodeURIComponent(match[2]);
      }

      if (params.access_token && params.refresh_token) {
        const { data: sessionData, error: sessionErr } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (sessionErr) throw sessionErr;
        return sessionData;
      } else if (params.code) {
        const { data: sessionData, error: sessionErr } = await supabase.auth.exchangeCodeForSession(
          params.code
        );
        if (sessionErr) throw sessionErr;
        return sessionData;
      }
    }

    if (authResult.type === 'cancel' || authResult.type === 'dismiss') {
      throw new Error('Google sign-in was cancelled.');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData;
  },

  /**
   * Terminate current Supabase session
   */
  async signOut() {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      throw error;
    }
  },

  /**
   * Get current persisted session
   */
  async getSession(): Promise<Session | null> {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  /**
   * Get current authenticated user
   */
  async getUser(): Promise<User | null> {
    const { data } = await supabase.auth.getUser();
    return data.user;
  },

  /**
   * Fetch user profile from Supabase profiles table
   */
  async getProfile(userId: string) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, avatar_url, updated_at')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('Failed to retrieve Supabase profile:', error.message);
      return null;
    }
    return data;
  },

  /**
   * Update profile in Supabase profiles table
   */
  async updateProfile(userId: string, updates: { display_name?: string; avatar_url?: string | null }) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({
        id: userId,
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw error;
    }
    return data;
  },

  /**
   * Upload an avatar image from local file:// to Supabase Storage avatars bucket.
   * Returns the permanent public HTTPS URL.
   */
  async uploadAvatar(userId: string, localUri: string): Promise<string> {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = base64ToUint8Array(base64);
    const filePath = `${userId}/avatar.jpg`;

    const { error } = await supabase.storage
      .from('avatars')
      .upload(filePath, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (error) {
      throw error;
    }

    const { data } = supabase.storage.from('avatars').getPublicUrl(filePath);
    return `${data.publicUrl}?t=${Date.now()}`;
  },

  /**
   * Remove avatar image from Supabase Storage avatars bucket.
   */
  async removeAvatar(userId: string): Promise<void> {
    try {
      await supabase.storage.from('avatars').remove([`${userId}/avatar.jpg`]);
    } catch (e) {
      console.warn('Failed to delete avatar from storage:', e);
    }
  },

  /**
   * Download a remote avatar image and cache it in FileSystem.documentDirectory.
   * Returns the local file:// URI for offline-first rendering.
   */
  async downloadAndCacheAvatar(remoteUrl: string, userId: string): Promise<string> {
    const docDir = FileSystem.documentDirectory;
    if (!docDir) return remoteUrl;
    const localPath = `${docDir}cached_avatar_${userId}.jpg`;
    try {
      const downloadRes = await FileSystem.downloadAsync(remoteUrl, localPath);
      if (downloadRes.status === 200 && downloadRes.uri) {
        return downloadRes.uri;
      }
    } catch (err) {
      console.warn('Failed to cache remote avatar locally:', err);
    }
    return remoteUrl;
  },
};

// Re-export store for backward-compatibility with existing imports
export * from '@/store/authStore';
