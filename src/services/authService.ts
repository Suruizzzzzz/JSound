import { create } from 'zustand';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatar_url?: string | null;
  is_logged_in: boolean;
  sync_status: 'synced' | 'pending' | 'offline';
  last_synced_at?: string | null;
}

const GUEST_USER: UserProfile = {
  id: 'local_guest',
  name: 'Local Guest',
  email: 'guest@jstream.offline',
  avatar_url: null,
  is_logged_in: false,
  sync_status: 'offline',
  last_synced_at: null,
};

interface AuthState {
  user: UserProfile;
  isGuestSession: boolean;
  isSyncing: boolean;
  setGuestSession: (isGuest: boolean) => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  syncPlaylistsToCloud: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: GUEST_USER,
  isGuestSession: false,
  isSyncing: false,

  setGuestSession: (isGuest: boolean) => {
    set({ isGuestSession: isGuest });
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
    set({ user: GUEST_USER, isGuestSession: false, isSyncing: false });
  },
}));
