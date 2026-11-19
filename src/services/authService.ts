import { makeRedirectUri } from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

// Complete any auth sessions running in browser on web/native
WebBrowser.maybeCompleteAuthSession();

export interface SignUpParams {
  email: string;
  password: string;
  displayName?: string;
}

export const authService = {
  /**
   * Register a new user with Email and Password using Supabase's default
   * "Confirm your email address" link verification flow.
   */
  async signUp({ email, password, displayName }: SignUpParams) {
    const cleanEmail = email.trim();
    const cleanName = displayName?.trim();

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
      throw error;
    }

    return data;
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
   * Sign in with Google OAuth using Expo WebBrowser & deep-link redirect
   */
  async signInWithGoogle() {
    const isExpoGo = Constants.appOwnership === 'expo';
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
    const { error } = await supabase.auth.signOut();
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
};

// Re-export store for backward-compatibility with existing imports
export * from '@/store/authStore';
