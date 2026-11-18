import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/database';

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
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  syncPlaylistsToCloud: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: GUEST_USER,
  isGuestSession: true, // Seamless Guest Mode enabled by default out-of-the-box
  isSyncing: false,

  setGuestSession: (isGuest: boolean) => {
    set({ isGuestSession: isGuest });
  },

  initProfile: async () => {
    try {
      const savedName = await getSetting('profile_display_name', 'JStream Listener');
      const savedAvatar = await getSetting('profile_avatar_uri', null);
      set((state) => ({
        user: {
          ...state.user,
          name: savedName || 'JStream Listener',
          avatar_url: savedAvatar,
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
      console.warn('Failed to persist profile display name:', e);
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
      console.warn('Failed to persist profile avatar:', e);
    }
    set((state) => ({
      user: {
        ...state.user,
        avatar_url: avatarUri || null,
      },
    }));
  },

  signInWithGoogle: async () => {
    // Placeholder ready for Supabase OAuth 2.0 integration
    set({
      user: {
        id: 'user_google_demo',
        name: 'JStream Member',
        email: 'member@gmail.com',
        avatar_url: null,
        is_logged_in: true,
        sync_status: 'pending',
        last_synced_at: null,
      },
      isGuestSession: false,
    });
  },

  signInWithEmail: async (email: string) => {
    // Placeholder ready for Supabase Auth integration
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
    set({ user: GUEST_USER, isGuestSession: true, isSyncing: false });
  },
}));
