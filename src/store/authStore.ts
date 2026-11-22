import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/database';
import { supabase } from '@/services/supabase';
import { authService } from '@/services/authService';
import { syncPlaylistsToCloud as syncWithCloud } from '@/services/playlistSyncService';

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
  signUp: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ needsConfirmation: boolean; identityCollision?: boolean; existingProvider?: string }>;
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
              isGuestSession: false,
            });
          }
        });
      }

      // 2. Check if a persisted Supabase session exists
      const session = await authService.getSession();
      if (session?.user) {
        const sbUser = session.user;
        const savedLocalName = await getSetting('profile_display_name', null);
        const savedLocalAvatar = await getSetting('profile_avatar_uri', null);

        let displayName =
          savedLocalName ||
          sbUser.user_metadata?.display_name ||
          sbUser.user_metadata?.full_name ||
          (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
        let avatarUrl = savedLocalAvatar || sbUser.user_metadata?.avatar_url || null;

        try {
          const remoteProfile = await authService.getProfile(sbUser.id);
          if (remoteProfile) {
            if (remoteProfile.display_name) {
              displayName = remoteProfile.display_name;
              await setSetting('profile_display_name', displayName);
            }
            if (remoteProfile.avatar_url) {
              if (remoteProfile.avatar_url.startsWith('http')) {
                const localCached = await authService.downloadAndCacheAvatar(remoteProfile.avatar_url, sbUser.id);
                avatarUrl = localCached;
                await setSetting('profile_avatar_uri', localCached);
              } else {
                avatarUrl = remoteProfile.avatar_url;
              }
            } else if (remoteProfile.avatar_url === null) {
              avatarUrl = null;
              await setSetting('profile_avatar_uri', '');
            }
          }
        } catch {
          // offline fallback: use local cached settings
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
        await setSetting('pending_profile_name_sync', '');
      } catch (remoteErr) {
        console.warn('Offline: queued profile name update for next sync:', remoteErr);
        await setSetting('pending_profile_name_sync', cleanName);
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
      if (avatarUri) {
        try {
          const publicUrl = await authService.uploadAvatar(currentUser.id, avatarUri);
          await authService.updateProfile(currentUser.id, { avatar_url: publicUrl });
          await setSetting('pending_avatar_sync', '');
        } catch (remoteErr) {
          console.warn('Offline: queued avatar upload for next sync:', remoteErr);
          await setSetting('pending_avatar_sync', avatarUri);
        }
      } else {
        try {
          await authService.removeAvatar(currentUser.id);
          await authService.updateProfile(currentUser.id, { avatar_url: null });
          await setSetting('pending_avatar_sync', '');
        } catch (remoteErr) {
          console.warn('Failed to remove avatar from Supabase:', remoteErr);
        }
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
    if (data.identityCollision) {
      return { needsConfirmation: false, identityCollision: true, existingProvider: data.existingProvider || 'google' };
    }
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
      return { needsConfirmation: false, identityCollision: false };
    }
    return { needsConfirmation: true, identityCollision: false };
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
    try {
      const currentUser = get().user;
      if (currentUser.is_logged_in && currentUser.id !== 'local_guest') {
        // 1. Flush any pending offline profile updates to Supabase
        const pendingName = await getSetting('pending_profile_name_sync', '');
        if (pendingName) {
          try {
            await authService.updateProfile(currentUser.id, { display_name: pendingName });
            await setSetting('pending_profile_name_sync', '');
          } catch (e) {
            console.warn('Pending name sync retry warning:', e);
          }
        }

        const pendingAvatar = await getSetting('pending_avatar_sync', '');
        if (pendingAvatar) {
          try {
            const publicUrl = await authService.uploadAvatar(currentUser.id, pendingAvatar);
            await authService.updateProfile(currentUser.id, { avatar_url: publicUrl });
            await setSetting('pending_avatar_sync', '');
          } catch (e) {
            console.warn('Pending avatar sync retry warning:', e);
          }
        }

        // 2. Pull latest remote profile and cache avatar locally
        try {
          const remoteProfile = await authService.getProfile(currentUser.id);
          if (remoteProfile) {
            let updatedName = currentUser.name;
            let updatedAvatar = currentUser.avatar_url;

            if (remoteProfile.display_name) {
              updatedName = remoteProfile.display_name;
              await setSetting('profile_display_name', updatedName);
            }
            if (remoteProfile.avatar_url) {
              if (remoteProfile.avatar_url.startsWith('http')) {
                const cachedUri = await authService.downloadAndCacheAvatar(remoteProfile.avatar_url, currentUser.id);
                updatedAvatar = cachedUri;
                await setSetting('profile_avatar_uri', cachedUri);
              } else {
                updatedAvatar = remoteProfile.avatar_url;
              }
            } else if (remoteProfile.avatar_url === null) {
              updatedAvatar = null;
              await setSetting('profile_avatar_uri', '');
            }

            set((state) => ({
              user: {
                ...state.user,
                name: updatedName,
                avatar_url: updatedAvatar,
              },
            }));
          }
        } catch (e) {
          console.warn('Profile refresh during sync warning:', e);
        }
      }

      // 3. Two-way playlists & tracks cloud sync
      const res = await syncWithCloud();
      if (res.success) {
        set((state) => ({
          isSyncing: false,
          user: {
            ...state.user,
            sync_status: 'synced',
            last_synced_at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          },
        }));
      } else {
        set((state) => ({
          isSyncing: false,
          user: {
            ...state.user,
            sync_status: state.user.is_logged_in ? 'pending' : 'offline',
          },
        }));
      }
    } catch (e) {
      console.warn('Sync playlists error:', e);
      set({ isSyncing: false });
    }
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
      isGuestSession: false,
      isSyncing: false,
    });
  },
}));
