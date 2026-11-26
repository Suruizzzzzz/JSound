import {
  createAudioPlayer,
  setAudioModeAsync,
  requestNotificationPermissionsAsync,
  AudioPlayer,
  AudioStatus,
  AudioSource,
  AudioMetadata,
  AudioLockScreenOptions,
} from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { EventSubscription } from 'expo';
import { resolveLocalTrackUri } from '@/repositories/trackRepository';

export { AudioPlayer, AudioStatus, AudioSource, AudioMetadata, AudioLockScreenOptions };

type TrackControlEventPlayer = AudioPlayer & {
  addListener(event: 'nextTrack' | 'previousTrack', listener: () => void): EventSubscription;
};

let playerInstance: AudioPlayer | null = null;
let statusSubscription: EventSubscription | null = null;
let nextTrackSubscription: EventSubscription | null = null;
let previousTrackSubscription: EventSubscription | null = null;
let currentStatusCallback: ((status: AudioStatus) => void) | null = null;
let isAudioModeConfigured = false;
let shouldAutoPlay = true;
let currentTrackMetadata: AudioMetadata | undefined = undefined;
let hasSyncedLockScreenForCurrentTrack = false;
let isLockScreenActiveOnPlayer = false;
let loadRequestId = 0;

// Ensure .remove() / .release() is invoked at most once per native AudioPlayer SharedRef
const releasedPlayers = new WeakSet<AudioPlayer>();

// Detect Expo Go client vs compiled standalone / development build
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants.executionEnvironment as string) === 'storeClient' ||
  Constants.appOwnership === 'expo' ||
  Boolean((Constants as unknown as { manifest2?: { extra?: { expoGo?: boolean } } })?.manifest2?.extra?.expoGo) ||
  Boolean((Constants as unknown as { manifest?: { developer?: boolean } })?.manifest?.developer);

const DEFAULT_LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showNextTrack: true,
  showPreviousTrack: true,
  showSeekForward: false,
  showSeekBackward: false,
};

function isPlayerUsable(player: AudioPlayer | null | undefined): player is AudioPlayer {
  return Boolean(player) && !releasedPlayers.has(player as AudioPlayer);
}

function safePlayerIsLoaded(player: AudioPlayer | null | undefined): boolean {
  if (!isPlayerUsable(player)) return false;
  try {
    return Boolean(player.isLoaded);
  } catch {
    return false;
  }
}

function safePlayerPlay(player: AudioPlayer | null | undefined): boolean {
  if (!isPlayerUsable(player)) return false;
  try {
    player.play();
    return true;
  } catch (err) {
    console.warn('[AudioService] safePlayerPlay error:', err);
    return false;
  }
}

function safePlayerPause(player: AudioPlayer | null | undefined): void {
  if (!isPlayerUsable(player)) return;
  try {
    player.pause();
  } catch (err) {
    console.warn('[AudioService] safePlayerPause error:', err);
  }
}

async function safePlayerSeekTo(
  player: AudioPlayer | null | undefined,
  positionSeconds: number
): Promise<void> {
  if (!isPlayerUsable(player)) return;
  try {
    const clamped = Math.max(0, positionSeconds);
    await player.seekTo(clamped);
  } catch (err) {
    console.warn('[AudioService] safePlayerSeekTo error:', err);
  }
}

function safeClearLockScreen(player: AudioPlayer | null | undefined): void {
  if (isExpoGo || !isPlayerUsable(player)) return;
  try {
    if (typeof player.clearLockScreenControls === 'function') {
      player.clearLockScreenControls();
    } else if (typeof player.setActiveForLockScreen === 'function') {
      player.setActiveForLockScreen(false);
    }
  } catch {
    // Ignore native SharedRef / Media3 binding errors during teardown
  }
}

function safeReleasePlayer(player: AudioPlayer | null | undefined): void {
  if (!player || releasedPlayers.has(player)) return;
  releasedPlayers.add(player);

  try {
    player.pause();
  } catch {
    // ignore
  }

  if (!isExpoGo) {
    try {
      if (typeof player.clearLockScreenControls === 'function') {
        player.clearLockScreenControls();
      } else if (typeof player.setActiveForLockScreen === 'function') {
        player.setActiveForLockScreen(false);
      }
    } catch {
      // ignore
    }
  }

  try {
    if (typeof player.remove === 'function') {
      player.remove();
    }
  } catch {
    // ignore
  }

  try {
    const releasable = player as unknown as { release?: () => void };
    if (typeof releasable.release === 'function') {
      releasable.release();
    }
  } catch {
    // ignore
  }
}

function removeSubscription(sub: EventSubscription | null): null {
  if (sub) {
    try {
      sub.remove();
    } catch {
      // ignore
    }
  }
  return null;
}

function removeAllPlayerListeners(): void {
  statusSubscription = removeSubscription(statusSubscription);
  nextTrackSubscription = removeSubscription(nextTrackSubscription);
  previousTrackSubscription = removeSubscription(previousTrackSubscription);
}

function sanitizeMetadataArtworkUrl(artworkUrl?: string): string | undefined {
  if (!artworkUrl) return undefined;
  const trimmed = artworkUrl.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://')
  ) {
    return trimmed;
  }
  if (trimmed.startsWith('file:/')) {
    return `file:///${trimmed.slice(6).replace(/^\/+/, '')}`;
  }
  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }
  return undefined;
}

function normalizeMetadata(metadata?: AudioMetadata): AudioMetadata | undefined {
  if (!metadata) return undefined;
  return {
    ...metadata,
    artworkUrl: sanitizeMetadataArtworkUrl(metadata.artworkUrl),
  };
}

function syncLockScreenControls(player: AudioPlayer, metadata?: AudioMetadata): void {
  if (isExpoGo || !metadata || !isPlayerUsable(player)) return;
  try {
    if (!isLockScreenActiveOnPlayer && typeof player.setActiveForLockScreen === 'function') {
      player.setActiveForLockScreen(true, metadata, DEFAULT_LOCK_SCREEN_OPTIONS);
      isLockScreenActiveOnPlayer = true;
    } else if (
      typeof (player as unknown as { updateLockScreenMetadata?: (meta: AudioMetadata) => void })
        .updateLockScreenMetadata === 'function'
    ) {
      (
        player as unknown as { updateLockScreenMetadata: (meta: AudioMetadata) => void }
      ).updateLockScreenMetadata(metadata);
    } else if (typeof player.setActiveForLockScreen === 'function') {
      player.setActiveForLockScreen(true, metadata, DEFAULT_LOCK_SCREEN_OPTIONS);
      isLockScreenActiveOnPlayer = true;
    }
  } catch (lockErr) {
    console.warn('[AudioService] Failed to update lock screen controls:', lockErr);
  }
}

function teardownPlayerInstance(): void {
  isLockScreenActiveOnPlayer = false;
  hasSyncedLockScreenForCurrentTrack = false;
  removeAllPlayerListeners();

  if (playerInstance) {
    const playerToRelease = playerInstance;
    playerInstance = null;
    safeReleasePlayer(playerToRelease);
  }
}

function attachPlayerListeners(player: AudioPlayer): void {
  removeAllPlayerListeners();
  if (!isPlayerUsable(player)) return;

  try {
    statusSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      if (!status || typeof status !== 'object') return;
      if (player !== playerInstance || !isPlayerUsable(player)) return;

      if ('error' in status && (status as unknown as { error?: unknown }).error) {
        console.error('[AudioService] Playback error:', (status as unknown as { error: unknown }).error);
      }

      // Auto-play as soon as ExoPlayer reports isLoaded === true
      if (status.isLoaded && !status.playing && shouldAutoPlay) {
        safePlayerPlay(player);
      }

      if (status.playing) {
        shouldAutoPlay = false;
      }

      // In standalone builds, sync lock-screen metadata once media is fully loaded and duration > 0
      if (
        !isExpoGo &&
        status.isLoaded &&
        status.duration > 0 &&
        !hasSyncedLockScreenForCurrentTrack &&
        currentTrackMetadata
      ) {
        hasSyncedLockScreenForCurrentTrack = true;
        syncLockScreenControls(player, currentTrackMetadata);
      }

      try {
        currentStatusCallback?.(status);
      } catch (cbErr) {
        console.warn('[AudioService] Status callback error:', cbErr);
      }
    });
  } catch (err) {
    console.warn('[AudioService] Failed to attach playbackStatusUpdate listener:', err);
  }

  if (!isExpoGo) {
    const controlPlayer = player as TrackControlEventPlayer;
    try {
      nextTrackSubscription = controlPlayer.addListener('nextTrack', () => {
        if (player !== playerInstance || !isPlayerUsable(player)) return;
        import('@/store/playerStore')
          .then(({ usePlayerStore }) => usePlayerStore.getState().playNext())
          .catch((err) => console.warn('[AudioService] Lock-screen playNext error:', err));
      });
    } catch (err) {
      console.warn('[AudioService] Failed to attach nextTrack listener:', err);
    }

    try {
      previousTrackSubscription = controlPlayer.addListener('previousTrack', () => {
        if (player !== playerInstance || !isPlayerUsable(player)) return;
        import('@/store/playerStore')
          .then(({ usePlayerStore }) => usePlayerStore.getState().playPrevious())
          .catch((err) => console.warn('[AudioService] Lock-screen playPrevious error:', err));
      });
    } catch (err) {
      console.warn('[AudioService] Failed to attach previousTrack listener:', err);
    }
  }
}

export async function ensureAudioMode(): Promise<void> {
  if (isAudioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: !isExpoGo,
      interruptionMode: 'doNotMix',
    });
    isAudioModeConfigured = true;

    // Request notification permission non-blockingly on Android standalone builds
    if (!isExpoGo && Platform.OS === 'android') {
      requestNotificationPermissionsAsync().catch(() => {
        // Silently skip if unavailable
      });
    }
  } catch (error) {
    console.warn('[AudioService] Failed to configure audio mode:', error);
  }
}

export async function loadAndPlayAudio(
  uriOrSource: string | AudioSource,
  onStatusUpdate: (status: AudioStatus) => void,
  headers?: Record<string, string>,
  metadata?: AudioMetadata,
  options?: { skipLocalCheck?: boolean }
): Promise<AudioPlayer | null> {
  const requestId = ++loadRequestId;
  await ensureAudioMode();
  if (requestId !== loadRequestId) return null;

  const rawUri =
    typeof uriOrSource === 'string'
      ? uriOrSource
      : typeof uriOrSource === 'object' && uriOrSource !== null && 'uri' in uriOrSource
      ? (uriOrSource as { uri?: string }).uri || ''
      : '';

  let effectiveUri = rawUri;
  const isRemoteUri =
    rawUri.startsWith('http://') || rawUri.startsWith('https://');

  if (!isRemoteUri && rawUri && !options?.skipLocalCheck) {
    const resolvedLocal = await resolveLocalTrackUri(rawUri);
    if (requestId !== loadRequestId) return null;
    if (resolvedLocal.exists && resolvedLocal.uri) {
      effectiveUri = resolvedLocal.uri;
    } else {
      throw new Error('Local audio file is missing or corrupted on device storage.');
    }
  }

  // Assign active callback/metadata only right before touching native player (never wiped by teardown)
  currentStatusCallback = onStatusUpdate;
  shouldAutoPlay = true;
  currentTrackMetadata = normalizeMetadata(metadata);
  hasSyncedLockScreenForCurrentTrack = false;

  const source: AudioSource =
    typeof uriOrSource === 'string'
      ? headers
        ? { uri: effectiveUri, headers }
        : { uri: effectiveUri }
      : typeof uriOrSource === 'object' && uriOrSource !== null
      ? { ...(uriOrSource as Record<string, unknown>), uri: effectiveUri }
      : uriOrSource;

  try {
    // 1. Re-use existing player with .replace()
    if (isPlayerUsable(playerInstance)) {
      const existingPlayer = playerInstance;
      try {
        attachPlayerListeners(existingPlayer);
        hasSyncedLockScreenForCurrentTrack = false;
        existingPlayer.replace(source);

        syncLockScreenControls(existingPlayer, currentTrackMetadata);

        if (safePlayerIsLoaded(existingPlayer)) {
          if (safePlayerPlay(existingPlayer)) {
            shouldAutoPlay = false;
          }
        } else {
          setTimeout(() => {
            try {
              if (
                requestId === loadRequestId &&
                playerInstance === existingPlayer &&
                safePlayerIsLoaded(existingPlayer) &&
                shouldAutoPlay
              ) {
                if (safePlayerPlay(existingPlayer)) {
                  shouldAutoPlay = false;
                }
              }
            } catch (timerErr) {
              console.warn('[AudioService] Deferred auto-play error:', timerErr);
            }
          }, 60);
        }

        return existingPlayer;
      } catch (replaceErr) {
        console.warn('[AudioService] Player replace failed, recreating player:', replaceErr);
        teardownPlayerInstance();
      }
    }

    if (requestId !== loadRequestId) return null;

    // 2. Fresh player instantiation (teardown old native player WITHOUT wiping current callbacks/metadata)
    teardownPlayerInstance();

    let player: AudioPlayer;
    try {
      player = createAudioPlayer(source, {
        updateInterval: 250,
        keepAudioSessionActive: true,
      });
    } catch (createErr) {
      console.warn('[AudioService] createAudioPlayer failed:', createErr);
      throw createErr;
    }

    if (requestId !== loadRequestId) {
      safeReleasePlayer(player);
      return null;
    }

    playerInstance = player;
    attachPlayerListeners(player);
    syncLockScreenControls(player, currentTrackMetadata);

    if (safePlayerIsLoaded(player)) {
      if (safePlayerPlay(player)) {
        shouldAutoPlay = false;
      }
    }

    return player;
  } catch (error) {
    console.warn('[AudioService] Failed to create or play audio player:', error);
    throw error;
  }
}

export async function pauseAudio(): Promise<void> {
  shouldAutoPlay = false;
  safePlayerPause(playerInstance);
}

export async function resumeAudio(): Promise<void> {
  shouldAutoPlay = true;
  safePlayerPlay(playerInstance);
}

export async function seekAudio(positionSeconds: number): Promise<void> {
  await safePlayerSeekTo(playerInstance, positionSeconds);
}

export async function stopAndUnloadAudio(): Promise<void> {
  loadRequestId += 1;
  shouldAutoPlay = false;
  currentStatusCallback = null;
  currentTrackMetadata = undefined;
  safeClearLockScreen(playerInstance);
  teardownPlayerInstance();
}

export function updateAudioMetadata(metadata: AudioMetadata): void {
  const normalized = normalizeMetadata(metadata);
  currentTrackMetadata = normalized;
  if (isExpoGo || !isPlayerUsable(playerInstance) || !normalized) return;
  syncLockScreenControls(playerInstance, normalized);
}

export function getCurrentPlayer(): AudioPlayer | null {
  return isPlayerUsable(playerInstance) ? playerInstance : null;
}

export function getAudioPlayer(): AudioPlayer | null {
  return isPlayerUsable(playerInstance) ? playerInstance : null;
}

export function getPlaybackPosition(): { currentTime: number; duration: number } {
  if (isPlayerUsable(playerInstance)) {
    try {
      const cur =
        typeof playerInstance.currentTime === 'number' &&
        !isNaN(playerInstance.currentTime) &&
        playerInstance.currentTime >= 0
          ? playerInstance.currentTime
          : 0;
      const dur =
        typeof playerInstance.duration === 'number' &&
        !isNaN(playerInstance.duration) &&
        playerInstance.duration > 0
          ? playerInstance.duration
          : 0;
      return { currentTime: cur, duration: dur };
    } catch {
      return { currentTime: 0, duration: 0 };
    }
  }
  return { currentTime: 0, duration: 0 };
}
