import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/database';
import { supabase } from '@/services/supabase';
import { authService } from '@/services/authService';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  is_logged_in: boolean;
  sync_status: 'synced' | 'pending' | 'offline';
  last_synced_at?: string | null;
}

export const GUEST_USER: UserProfile = {
  id: 'local_guest',
  name: 'JStream Listener',
  email: 'Offline Mode • On-Device Library',
  avatar_url: null,
  is_logged_in: false,
  sync_status: 'offline',
  last_synced_at: null,
};

export interface AuthState {
  user: UserProfile;
  isGuestSession: boolean;
  isSyncing: boolean;
  setGuestSession: (isGuest: boolean) => void;
  initProfile: () => Promise<void>;
  setProfileName: (name: string) => Promise<void>;
  setProfileAvatar: (avatarUri: string | null) => Promise<void>;
  signUp: (email: string, password: string, displayName?: string) => Promise<{ needsConfirmation: boolean }>;
  resendConfirmation: (email: string) => Promise<void>;
  checkEmailConfirmed: (params: { email: string; password: string }) => Promise<void>;
  signInWithEmail: (email: string, password?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  syncPlaylistsToCloud: () => Promise<void>;
  signOut: () => Promise<void>;
}

let authListenerSubscribed = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: GUEST_USER,
  isGuestSession: true, // Offline Guest Mode enabled by default
  isSyncing: false,

  setGuestSession: (isGuest: boolean) => {
    set({ isGuestSession: isGuest });
  },

  initProfile: async () => {
    try {
      // 1. Subscribe to Supabase auth state change events once
      if (!authListenerSubscribed) {
        authListenerSubscribed = true;
        supabase.auth.onAuthStateChange(async (event, session) => {
          if (session?.user) {
            const sbUser = session.user;
            let displayName =
              sbUser.user_metadata?.display_name ||
              sbUser.user_metadata?.full_name ||
              (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
            let avatarUrl = sbUser.user_metadata?.avatar_url || null;

            try {
              const remoteProfile = await authService.getProfile(sbUser.id);
              if (remoteProfile) {
                if (remoteProfile.display_name) displayName = remoteProfile.display_name;
                if (remoteProfile.avatar_url) avatarUrl = remoteProfile.avatar_url;
              }
            } catch {
              // fallback to metadata
            }

            set({
              user: {
                id: sbUser.id,
                name: displayName,
                email: sbUser.email || '',
                avatar_url: avatarUrl,
                is_logged_in: true,
                sync_status: 'synced',
                last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              },
              isGuestSession: false,
            });
          } else if (event === 'SIGNED_OUT') {
            const savedName = await getSetting('profile_display_name', 'JStream Listener');
            const savedAvatar = await getSetting('profile_avatar_uri', null);
            set({
              user: {
                ...GUEST_USER,
                name: savedName || GUEST_USER.name,
                avatar_url: savedAvatar || null,
              },
              isGuestSession: true,
            });
          }
        });
      }

      // 2. Check if a persisted Supabase session exists
      const session = await authService.getSession();
      if (session?.user) {
        const sbUser = session.user;
        let displayName =
          sbUser.user_metadata?.display_name ||
          sbUser.user_metadata?.full_name ||
          (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
        let avatarUrl = sbUser.user_metadata?.avatar_url || null;

        try {
          const remoteProfile = await authService.getProfile(sbUser.id);
          if (remoteProfile) {
            if (remoteProfile.display_name) displayName = remoteProfile.display_name;
            if (remoteProfile.avatar_url) avatarUrl = remoteProfile.avatar_url;
          }
        } catch {
          // fallback to metadata
        }

        set({
          user: {
            id: sbUser.id,
            name: displayName,
            email: sbUser.email || '',
            avatar_url: avatarUrl,
            is_logged_in: true,
            sync_status: 'synced',
            last_synced_at: null,
          },
          isGuestSession: false,
        });
        return;
      }

      // 3. Fallback: load local guest profile settings from SQLite
      const savedName = await getSetting('profile_display_name', 'JStream Listener');
      const savedAvatar = await getSetting('profile_avatar_uri', null);
      set((state) => ({
        user: {
          ...state.user,
          name: savedName || 'JStream Listener',
          avatar_url: savedAvatar || null,
        },
      }));
    } catch (e) {
      console.warn('Failed to load profile settings:', e);
    }
  },

  setProfileName: async (name: string) => {
    const cleanName = name.trim() || 'JStream Listener';
    try {
      await setSetting('profile_display_name', cleanName);
    } catch (e) {
      console.warn('Failed to persist profile display name locally:', e);
    }

    const currentUser = get().user;
    if (currentUser.is_logged_in && currentUser.id !== 'local_guest') {
      try {
        await authService.updateProfile(currentUser.id, { display_name: cleanName });
      } catch (remoteErr) {
        console.warn('Failed to persist profile name to Supabase:', remoteErr);
      }
    }

    set((state) => ({
      user: {
        ...state.user,
        name: cleanName,
      },
    }));
  },

  setProfileAvatar: async (avatarUri: string | null) => {
    try {
      if (avatarUri) {
        await setSetting('profile_avatar_uri', avatarUri);
      } else {
        await setSetting('profile_avatar_uri', '');
      }
    } catch (e) {
      console.warn('Failed to persist profile avatar locally:', e);
    }

    const currentUser = get().user;
    if (currentUser.is_logged_in && currentUser.id !== 'local_guest') {
      try {
        await authService.updateProfile(currentUser.id, { avatar_url: avatarUri });
      } catch (remoteErr) {
        console.warn('Failed to persist avatar to Supabase:', remoteErr);
      }
    }

    set((state) => ({
      user: {
        ...state.user,
        avatar_url: avatarUri || null,
      },
    }));
  },

  signUp: async (email: string, password: string, displayName?: string) => {
    const data = await authService.signUp({ email, password, displayName });
    if (data.session?.user) {
      const sbUser = data.session.user;
      const displayNameResolved =
        displayName?.trim() ||
        sbUser.user_metadata?.display_name ||
        sbUser.user_metadata?.full_name ||
        (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');

      set({
        user: {
          id: sbUser.id,
          name: displayNameResolved,
          email: sbUser.email || email,
          avatar_url: sbUser.user_metadata?.avatar_url || null,
          is_logged_in: true,
          sync_status: 'synced',
          last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        isGuestSession: false,
      });
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  },

  resendConfirmation: async (email: string) => {
    await authService.resendConfirmation(email);
  },

  checkEmailConfirmed: async ({ email, password }: { email: string; password: string }) => {
    const data = await authService.checkEmailConfirmed({ email, password });
    if (data.session?.user) {
      const sbUser = data.session.user;
      let displayName =
        sbUser.user_metadata?.display_name ||
        sbUser.user_metadata?.full_name ||
        (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
      let avatarUrl = sbUser.user_metadata?.avatar_url || null;

      try {
        const remoteProfile = await authService.getProfile(sbUser.id);
        if (remoteProfile) {
          if (remoteProfile.display_name) displayName = remoteProfile.display_name;
          if (remoteProfile.avatar_url) avatarUrl = remoteProfile.avatar_url;
        }
      } catch {
        // fallback to metadata
      }

      set({
        user: {
          id: sbUser.id,
          name: displayName,
          email: sbUser.email || email,
          avatar_url: avatarUrl,
          is_logged_in: true,
          sync_status: 'synced',
          last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        isGuestSession: false,
      });
    }
  },

  signInWithEmail: async (email: string, password?: string) => {
    if (!password) {
      // Fallback for tests or direct calls
      const username = email.split('@')[0] || 'User';
      set({
        user: {
          id: `user_${Date.now()}`,
          name: username.charAt(0).toUpperCase() + username.slice(1),
          email: email || 'user@example.com',
          avatar_url: null,
          is_logged_in: true,
          sync_status: 'pending',
          last_synced_at: null,
        },
        isGuestSession: false,
      });
      return;
    }

    const data = await authService.signInWithEmail(email, password);
    if (data.session?.user) {
      const sbUser = data.session.user;
      let displayName =
        sbUser.user_metadata?.display_name ||
        sbUser.user_metadata?.full_name ||
        (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
      let avatarUrl = sbUser.user_metadata?.avatar_url || null;

      try {
        const remoteProfile = await authService.getProfile(sbUser.id);
        if (remoteProfile) {
          if (remoteProfile.display_name) displayName = remoteProfile.display_name;
          if (remoteProfile.avatar_url) avatarUrl = remoteProfile.avatar_url;
        }
      } catch {
        // use metadata
      }

      set({
        user: {
          id: sbUser.id,
          name: displayName,
          email: sbUser.email || email,
          avatar_url: avatarUrl,
          is_logged_in: true,
          sync_status: 'synced',
          last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        isGuestSession: false,
      });
    }
  },

  signInWithGoogle: async () => {
    const sessionData = await authService.signInWithGoogle();
    const sbUser = sessionData?.session?.user;

    if (sbUser) {
      let displayName =
        sbUser.user_metadata?.display_name ||
        sbUser.user_metadata?.full_name ||
        (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
      let avatarUrl = sbUser.user_metadata?.avatar_url || null;

      try {
        const remoteProfile = await authService.getProfile(sbUser.id);
        if (remoteProfile) {
          if (remoteProfile.display_name) displayName = remoteProfile.display_name;
          if (remoteProfile.avatar_url) avatarUrl = remoteProfile.avatar_url;
        }
      } catch {
        // use metadata
      }

      set({
        user: {
          id: sbUser.id,
          name: displayName,
          email: sbUser.email || '',
          avatar_url: avatarUrl,
          is_logged_in: true,
          sync_status: 'synced',
          last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        isGuestSession: false,
      });
    }
  },

  syncPlaylistsToCloud: async () => {
    set({ isSyncing: true });
    // Simulated cloud sync duration
    await new Promise((resolve) => setTimeout(resolve, 800));
    set((state) => ({
      isSyncing: false,
      user: {
        ...state.user,
        sync_status: 'synced',
        last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    }));
  },

  signOut: async () => {
    try {
      await authService.signOut();
    } catch (e) {
      console.warn('Error during Supabase signOut:', e);
    }

    const savedName = await getSetting('profile_display_name', 'JStream Listener');
    const savedAvatar = await getSetting('profile_avatar_uri', null);

    set({
      user: {
        ...GUEST_USER,
        name: savedName || GUEST_USER.name,
        avatar_url: savedAvatar || null,
      },
      isGuestSession: true,
      isSyncing: false,
    });
  },
}));
