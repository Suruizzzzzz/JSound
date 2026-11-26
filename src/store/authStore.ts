import { create } from 'zustand';
import { initDatabase, getSetting, setSetting, registerActiveUserIdGetter, claimGuestLibrary } from '@/lib/database';
import {
  supabase,
  ExpoSecureStoreAdapter,
  getCachedSupabaseSessionUserId,
  clearCachedSupabaseSessionToken,
} from '@/services/supabase';
import { authService } from '@/services/authService';
import { syncPlaylistsToCloud as syncWithCloud } from '@/services/playlistSyncService';
import type { User } from '@supabase/supabase-js';

export const LAST_USER_ID_KEY = '@jstream_last_user_id';
const LAST_USER_PROFILE_KEY = '@jstream_last_user_profile';

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
  isAuthHydrated: boolean;
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
  importGuestLibraryToAccount: () => Promise<{ tracksCount: number; playlistsCount: number }>;
  signOut: () => Promise<void>;
}

let lastKnownUserId: string | null = null;
let explicitSignOutInProgress = false;
let initProfilePromise: Promise<void> | null = null;

export function isExplicitSignOutInProgress(): boolean {
  return explicitSignOutInProgress;
}

async function persistLastSignedInUser(profile: UserProfile): Promise<void> {
  if (!profile.id || profile.id === 'local_guest') return;
  lastKnownUserId = profile.id;
  try {
    await ExpoSecureStoreAdapter.setItem(LAST_USER_ID_KEY, profile.id);
    await ExpoSecureStoreAdapter.setItem(
      LAST_USER_PROFILE_KEY,
      JSON.stringify({
        id: profile.id,
        name: profile.name,
        email: profile.email,
        avatar_url: profile.avatar_url ?? null,
        last_synced_at: profile.last_synced_at ?? null,
      })
    );
  } catch (err) {
    console.warn('[Auth] Failed to persist last signed-in user id:', err);
  }
}

async function clearLastSignedInUser(): Promise<void> {
  lastKnownUserId = null;
  try {
    await ExpoSecureStoreAdapter.removeItem(LAST_USER_ID_KEY);
    await ExpoSecureStoreAdapter.removeItem(LAST_USER_PROFILE_KEY);
  } catch (err) {
    console.warn('[Auth] Failed to clear last signed-in user id:', err);
  }
}

function buildUserProfileFromSupabaseUser(
  sbUser: User,
  overrides?: { name?: string | null; email?: string | null; avatar_url?: string | null; sync_status?: 'synced' | 'pending' | 'offline'; last_synced_at?: string | null }
): UserProfile {
  const displayName =
    overrides?.name ||
    sbUser.user_metadata?.display_name ||
    sbUser.user_metadata?.full_name ||
    (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
  const avatarUrl =
    overrides?.avatar_url !== undefined
      ? overrides.avatar_url
      : sbUser.user_metadata?.avatar_url || null;

  return {
    id: sbUser.id,
    name: displayName,
    email: overrides?.email ?? sbUser.email ?? '',
    avatar_url: avatarUrl,
    is_logged_in: true,
    sync_status: overrides?.sync_status ?? 'synced',
    last_synced_at:
      overrides?.last_synced_at !== undefined
        ? overrides.last_synced_at
        : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

export function getCurrentUserId(): string {
  const user = useAuthStore.getState().user;
  if (user?.is_logged_in && user.id && user.id !== 'local_guest') {
    return user.id;
  }
  if (lastKnownUserId && lastKnownUserId !== 'local_guest') {
    return lastKnownUserId;
  }
  return 'local_guest';
}

registerActiveUserIdGetter(getCurrentUserId);

let migrationInProgress: Promise<void> | null = null;

/**
 * Automatically migrates any offline guest music (user_id = 'local_guest') into
 * the logged-in user's account, reloads the player store with the combined library,
 * and kicks off cloud synchronization.
 */
export async function handleUserLoginTransition(userId: string): Promise<void> {
  if (!userId || userId === 'local_guest') return;

  if (migrationInProgress) {
    await migrationInProgress;
    return;
  }

  migrationInProgress = (async () => {
    try {
      const { claimGuestLibrary } = await import('@/lib/database');
      const { tracksCount, playlistsCount } = await claimGuestLibrary(userId);

      // Refresh player store tracks for this user
      const { getAllTracks } = await import('@/repositories/trackRepository');
      const { usePlayerStore } = await import('@/store/playerStore');
      const userTracks = await getAllTracks(userId);
      usePlayerStore.getState().setTracks(userTracks);

      // Trigger cloud sync to upload newly claimed tracks & pull remote tracks
      useAuthStore.getState().syncPlaylistsToCloud().catch((syncErr) => {
        console.warn('Post-login cloud sync error:', syncErr);
      });

      if (tracksCount > 0 || playlistsCount > 0) {
        console.log(`[Auth] Auto-migrated ${tracksCount} guest tracks and ${playlistsCount} guest playlists to user ${userId}`);
      }
    } catch (err) {
      console.warn('[Auth] Failed to auto-migrate guest library on sign-in:', err);
    } finally {
      migrationInProgress = null;
    }
  })();

  await migrationInProgress;
}

async function refreshRemoteProfileInBackground(
  sbUser: User,
  set: (partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>)) => void
): Promise<void> {
  try {
    const remoteProfile = await authService.getProfile(sbUser.id);
    if (!remoteProfile) return;

    let updatedName =
      remoteProfile.display_name ||
      sbUser.user_metadata?.display_name ||
      sbUser.user_metadata?.full_name ||
      (sbUser.email ? sbUser.email.split('@')[0] : 'JStream Member');
    if (remoteProfile.display_name) {
      await setSetting('profile_display_name', remoteProfile.display_name);
    }

    let updatedAvatar: string | null = sbUser.user_metadata?.avatar_url || null;
    if (remoteProfile.avatar_url) {
      if (remoteProfile.avatar_url.startsWith('http')) {
        updatedAvatar = await authService.downloadAndCacheAvatar(remoteProfile.avatar_url, sbUser.id);
        await setSetting('profile_avatar_uri', updatedAvatar);
      } else {
        updatedAvatar = remoteProfile.avatar_url;
      }
    } else if (remoteProfile.avatar_url === null) {
      updatedAvatar = null;
      await setSetting('profile_avatar_uri', '');
    }

    set((state) => {
      if (state.user.id !== sbUser.id) return {};
      const nextUser: UserProfile = {
        ...state.user,
        name: updatedName,
        avatar_url: updatedAvatar,
      };
      persistLastSignedInUser(nextUser).catch(() => {});
      return { user: nextUser };
    });
  } catch {
    // Offline or unreachable — keep cached profile
  }
}

async function applyAuthenticatedUser(
  sbUser: User,
  set: (partial: Partial<AuthState> | ((state: AuthState) => Partial<AuthState>)) => void,
  overrides?: { name?: string; email?: string; sync_status?: 'synced' | 'pending' | 'offline'; last_synced_at?: string | null }
): Promise<void> {
  const savedLocalName = await getSetting('profile_display_name', null);
  const savedLocalAvatar = await getSetting('profile_avatar_uri', null);
  const profile = buildUserProfileFromSupabaseUser(sbUser, {
    name: overrides?.name || savedLocalName || undefined,
    email: overrides?.email ?? sbUser.email ?? '',
    avatar_url: savedLocalAvatar || sbUser.user_metadata?.avatar_url || null,
    sync_status: overrides?.sync_status ?? 'synced',
    last_synced_at: overrides?.last_synced_at,
  });

  await persistLastSignedInUser(profile);
  set({
    user: profile,
    isGuestSession: false,
    isAuthHydrated: true,
  });
}

let authListenerSubscribed = false;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: GUEST_USER,
  isGuestSession: false,
  isAuthHydrated: false,
  isSyncing: false,

  setGuestSession: (isGuest: boolean) => {
    set({ isGuestSession: isGuest });
  },

  initProfile: async () => {
    if (initProfilePromise) {
      return initProfilePromise;
    }

    initProfilePromise = (async () => {
      try {
        await initDatabase();

        // 1. Subscribe to Supabase auth state change events once
        if (!authListenerSubscribed) {
          authListenerSubscribed = true;
          supabase.auth.onAuthStateChange(async (event, session) => {
            try {
              if (session?.user) {
                if (explicitSignOutInProgress) return;
                const sbUser = session.user;
                await applyAuthenticatedUser(sbUser, set, { sync_status: 'synced' });
                refreshRemoteProfileInBackground(sbUser, set).catch(() => {});
                await handleUserLoginTransition(sbUser.id);
              } else if (event === 'SIGNED_OUT') {
                // Only clear user & switch to local_guest on explicit Sign Out — NEVER when offline!
                if (!explicitSignOutInProgress && lastKnownUserId) {
                  set((state) => ({
                    user: {
                      ...state.user,
                      sync_status: 'offline',
                    },
                    isAuthHydrated: true,
                  }));
                  return;
                }
                const savedName = await getSetting('profile_display_name', 'JStream Listener');
                const savedAvatar = await getSetting('profile_avatar_uri', null);
                set((state) => ({
                  user: {
                    ...GUEST_USER,
                    name: savedName || GUEST_USER.name,
                    avatar_url: savedAvatar || null,
                  },
                  isGuestSession: explicitSignOutInProgress ? false : state.isGuestSession,
                  isAuthHydrated: true,
                }));
              }
            } catch (authEventErr) {
              console.warn('[Auth] Auth state change handler warning:', authEventErr);
            }
          });
        }

        // 2. Immediately hydrate last known signed-in user from local storage (zero network)
        let hydratedUserId = await ExpoSecureStoreAdapter.getItem(LAST_USER_ID_KEY);
        if (!hydratedUserId) {
          hydratedUserId = await getCachedSupabaseSessionUserId();
          if (hydratedUserId && hydratedUserId !== 'local_guest') {
            await ExpoSecureStoreAdapter.setItem(LAST_USER_ID_KEY, hydratedUserId);
          }
        }

        const [savedLocalName, savedLocalAvatar, hasSeenWelcome] = await Promise.all([
          getSetting('profile_display_name', null),
          getSetting('profile_avatar_uri', null),
          getSetting('has_seen_welcome', 'false'),
        ]);

        if (hydratedUserId && hydratedUserId !== 'local_guest') {
          lastKnownUserId = hydratedUserId;
          let cachedProfile: Partial<UserProfile> | null = null;
          try {
            const rawProfile = await ExpoSecureStoreAdapter.getItem(LAST_USER_PROFILE_KEY);
            if (rawProfile) {
              cachedProfile = JSON.parse(rawProfile);
            }
          } catch {
            // ignore corrupt cached JSON
          }

          set({
            user: {
              id: hydratedUserId,
              name: cachedProfile?.name || savedLocalName || 'JStream Member',
              email: cachedProfile?.email || '',
              avatar_url: cachedProfile?.avatar_url ?? savedLocalAvatar ?? null,
              is_logged_in: true,
              sync_status: 'offline',
              last_synced_at: cachedProfile?.last_synced_at ?? null,
            },
            isGuestSession: false,
            isAuthHydrated: true,
          });

          // Ensure any leftover local_guest rows are safely claimed into this account offline
          await claimGuestLibrary(hydratedUserId).catch(() => {});
        } else {
          // Local guest state (preserve guest session if onboarding was already completed)
          set((state) => ({
            user: {
              ...GUEST_USER,
              name: savedLocalName || 'JStream Listener',
              avatar_url: savedLocalAvatar || null,
            },
            isGuestSession: state.isGuestSession || hasSeenWelcome === 'true',
            isAuthHydrated: true,
          }));
        }

        // 3. Reconcile persisted Supabase session in the background (never block offline boot)
        Promise.race([
          authService.getSession().catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
          .then(async (session) => {
            if (explicitSignOutInProgress || !session?.user) return;
            const sbUser = session.user;
            await applyAuthenticatedUser(sbUser, set, {
              sync_status: 'synced',
              last_synced_at: null,
            });
            refreshRemoteProfileInBackground(sbUser, set).catch(() => {});
            handleUserLoginTransition(sbUser.id).catch(() => {});
          })
          .catch(() => {});
      } catch (e) {
        console.warn('Failed to load profile settings:', e);
        set({ isAuthHydrated: true });
      } finally {
        initProfilePromise = null;
      }
    })();

    return initProfilePromise;
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
      await applyAuthenticatedUser(sbUser, set, {
        name: displayName?.trim() || undefined,
        email: sbUser.email || email,
      });
      await handleUserLoginTransition(sbUser.id);
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
      await applyAuthenticatedUser(sbUser, set, { email: sbUser.email || email });
      refreshRemoteProfileInBackground(sbUser, set).catch(() => {});
      await handleUserLoginTransition(sbUser.id);
    }
  },

  signInWithEmail: async (email: string, password?: string) => {
    if (!password) {
      // Fallback for tests or direct calls
      const username = email.split('@')[0] || 'User';
      const fallbackId = `user_${Date.now()}`;
      const fallbackProfile: UserProfile = {
        id: fallbackId,
        name: username.charAt(0).toUpperCase() + username.slice(1),
        email: email || 'user@example.com',
        avatar_url: null,
        is_logged_in: true,
        sync_status: 'pending',
        last_synced_at: null,
      };
      await persistLastSignedInUser(fallbackProfile);
      set({
        user: fallbackProfile,
        isGuestSession: false,
        isAuthHydrated: true,
      });
      await handleUserLoginTransition(fallbackId);
      return;
    }

    const data = await authService.signInWithEmail(email, password);
    if (data.session?.user) {
      const sbUser = data.session.user;
      await applyAuthenticatedUser(sbUser, set, { email: sbUser.email || email });
      refreshRemoteProfileInBackground(sbUser, set).catch(() => {});
      await handleUserLoginTransition(sbUser.id);
    }
  },

  signInWithGoogle: async () => {
    const sessionData = await authService.signInWithGoogle();
    const sbUser = sessionData?.session?.user;

    if (sbUser) {
      await applyAuthenticatedUser(sbUser, set);
      refreshRemoteProfileInBackground(sbUser, set).catch(() => {});
      await handleUserLoginTransition(sbUser.id);
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

  importGuestLibraryToAccount: async () => {
    const currentUser = get().user;
    if (!currentUser.is_logged_in || currentUser.id === 'local_guest') {
      return { tracksCount: 0, playlistsCount: 0 };
    }

    try {
      const { claimGuestLibrary } = await import('@/lib/database');
      const result = await claimGuestLibrary(currentUser.id);

      // Refresh store with newly claimed tracks
      const { getAllTracks } = await import('@/repositories/trackRepository');
      const { usePlayerStore } = await import('@/store/playerStore');
      const userTracks = await getAllTracks(currentUser.id);
      usePlayerStore.getState().setTracks(userTracks);

      // Trigger cloud sync in background
      get().syncPlaylistsToCloud().catch(() => {});

      return result;
    } catch (claimErr) {
      console.warn('Error claiming guest library:', claimErr);
      return { tracksCount: 0, playlistsCount: 0 };
    }
  },

  signOut: async () => {
    explicitSignOutInProgress = true;
    try {
      await clearLastSignedInUser();
      await clearCachedSupabaseSessionToken();
      await setSetting('has_seen_welcome', 'false').catch(() => {});

      try {
        await authService.signOut();
      } catch (e) {
        console.warn('Error during Supabase signOut:', e);
      }

      try {
        // Stop native audio, clear timers/session IDs, and wipe in-memory playback/library state
        const { usePlayerStore } = await import('@/store/playerStore');
        const playerState = usePlayerStore.getState();
        if (typeof playerState.resetPlaybackOnLogout === 'function') {
          await playerState.resetPlaybackOnLogout();
        } else {
          const { stopAndUnloadAudio } = await import('@/services/audioService');
          await stopAndUnloadAudio();
          usePlayerStore.setState({
            currentTrack: null,
            queue: [],
            tracks: [],
            isPlaying: false,
            position: 0,
            duration: 0,
            playbackContext: null,
          });
        }
      } catch (storeErr) {
        console.warn('Error resetting player store on signOut:', storeErr);
      }

      const savedName = await getSetting('profile_display_name', 'JStream Listener').catch(() => 'JStream Listener');
      const savedAvatar = await getSetting('profile_avatar_uri', null).catch(() => null);

      set({
        user: {
          ...GUEST_USER,
          name: savedName || GUEST_USER.name,
          avatar_url: savedAvatar || null,
        },
        isGuestSession: false,
        isAuthHydrated: true,
        isSyncing: false,
      });
    } finally {
      explicitSignOutInProgress = false;
    }
  },
}));
