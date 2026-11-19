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
import * as FileSystem from 'expo-file-system/legacy';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { EventSubscription } from 'expo';

let playerInstance: AudioPlayer | null = null;
let statusSubscription: EventSubscription | null = null;
let currentStatusCallback: ((status: AudioStatus) => void) | null = null;
let isAudioModeConfigured = false;
let shouldAutoPlay = true;

// Native foreground AudioControlsService binding is enabled by default in all compiled/standalone builds.
// Only skip when explicitly running inside Expo Go client where background service bindings trigger LogBox errors.
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants.executionEnvironment as string) === 'storeClient' ||
  Constants.appOwnership === 'expo' ||
  (typeof (Constants as any).expoVersion === 'string' && Constants.appOwnership !== 'standalone') ||
  Boolean((Constants as any).manifest2?.extra?.expoGo) ||
  Boolean((Constants as any).manifest?.developer);

const DEFAULT_LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showNextTrack: true,
  showPreviousTrack: true,
  showSeekForward: true,
  showSeekBackward: true,
  seekForwardIntervalSeconds: 10,
  seekBackwardIntervalSeconds: 10,
};

export async function ensureAudioMode(): Promise<void> {
  if (isAudioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: !isExpoGo,
      interruptionMode: 'doNotMix',
    });
    isAudioModeConfigured = true;

    // Request notification permission for Android 13+ lock screen and shade controls in standalone builds
    if (!isExpoGo) {
      try {
        await requestNotificationPermissionsAsync();
      } catch {
        // Silently skip if permission prompt is unsupported or unavailable
      }
    }
  } catch (error) {
    console.warn('[AudioService] Failed to configure audio mode:', error);
  }
}

export function getAudioPlayer(): AudioPlayer | null {
  return playerInstance;
}

export async function loadAndPlayAudio(
  uriOrSource: string | AudioSource,
  onStatusUpdate: (status: AudioStatus) => void,
  headers?: Record<string, string>,
  metadata?: AudioMetadata
): Promise<AudioPlayer> {
  await ensureAudioMode();
  currentStatusCallback = onStatusUpdate;
  shouldAutoPlay = true;

  const source: AudioSource =
    typeof uriOrSource === 'string'
      ? headers
        ? { uri: uriOrSource, headers }
        : { uri: uriOrSource }
      : uriOrSource;

  const uri =
    typeof uriOrSource === 'string'
      ? uriOrSource
      : typeof uriOrSource === 'object' && uriOrSource !== null && 'uri' in uriOrSource
      ? (uriOrSource as { uri?: string }).uri || ''
      : '';
  console.log('[AudioService] Loading URI:', uri);

  // If local file, verify file existence and byte size
  if (uri.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      console.log('[AudioService] Local file info:', {
        exists: info.exists,
        size: info.exists ? (info as any).size : 0,
        uri: info.uri,
      });
    } catch (e) {
      console.warn('[AudioService] Could not inspect local file info:', e);
    }
  }

  try {
    if (playerInstance) {
      try {
        // Reuse existing player with .replace()
        playerInstance.replace(source);

        // Update system lock screen & media notification metadata unless in Expo Go
        if (!isExpoGo && metadata) {
          try {
            if (typeof playerInstance.setActiveForLockScreen === 'function') {
              const res: any = (playerInstance as any).setActiveForLockScreen(
                true,
                metadata,
                DEFAULT_LOCK_SCREEN_OPTIONS
              );
              if (res && typeof res.catch === 'function') {
                res.catch(() => {});
              }
            } else if (typeof playerInstance.updateLockScreenMetadata === 'function') {
              const res: any = (playerInstance as any).updateLockScreenMetadata(metadata);
              if (res && typeof res.catch === 'function') {
                res.catch(() => {});
              }
            }
          } catch {
            // Silently ignore if native lock screen controls service is not bound
          }
        }

        // If player is already loaded, start playback immediately
        if (playerInstance.isLoaded) {
          console.log('[AudioService] Player already loaded on replace. Starting playback...');
          playerInstance.play();
          shouldAutoPlay = false;
        }
        return playerInstance;
      } catch (replaceErr) {
        console.warn('[AudioService] Player replace failed, recreating player:', replaceErr);
        await stopAndUnloadAudio();
      }
    }

    // Safely release previous player to prevent memory leaks and audio crashes
    await stopAndUnloadAudio();

    const player = createAudioPlayer(source, {
      updateInterval: 250,
      keepAudioSessionActive: true,
    });
    playerInstance = player;

    // Enable system media notification and lock screen controls unless in Expo Go
    if (!isExpoGo && metadata && typeof player.setActiveForLockScreen === 'function') {
      try {
        const res: any = (player as any).setActiveForLockScreen(
          true,
          metadata,
          DEFAULT_LOCK_SCREEN_OPTIONS
        );
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch {
        // Silently ignore if native lock screen controls service is not bound
      }
    }

    // Attach listener BEFORE calling play to catch early status updates & prevent race conditions
    statusSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      // Log any playback error from native layer
      if ('error' in status && (status as any).error) {
        console.error('[AudioService] Playback error:', (status as any).error);
      }

      // Play-before-loaded race condition fix:
      // The exact millisecond ExoPlayer reports isLoaded === true, start playback!
      if (status.isLoaded && !status.playing && shouldAutoPlay) {
        console.log('[AudioService] Media loaded! Triggering player.play()...');
        try {
          player.play();
        } catch (playErr) {
          console.warn('[AudioService] Error calling player.play():', playErr);
        }
      }

      if (status.playing) {
        shouldAutoPlay = false;
      }

      currentStatusCallback?.(status);
    });

    // Proactively call play() if already loaded, otherwise listener will trigger it
    if (player.isLoaded) {
      player.play();
      shouldAutoPlay = false;
    }

    return player;
  } catch (error) {
    console.warn('[AudioService] Failed to create or play audio player:', error);
    throw error;
  }
}

export async function pauseAudio(): Promise<void> {
  shouldAutoPlay = false;
  if (playerInstance) {
    playerInstance.pause();
  }
}

export async function resumeAudio(): Promise<void> {
  shouldAutoPlay = true;
  if (playerInstance) {
    playerInstance.play();
  }
}

export async function seekAudio(positionSeconds: number): Promise<void> {
  if (playerInstance) {
    const clamped = Math.max(0, positionSeconds);
    await playerInstance.seekTo(clamped);
  }
}

export async function stopAndUnloadAudio(): Promise<void> {
  shouldAutoPlay = false;
  currentStatusCallback = null;

  if (statusSubscription) {
    try {
      statusSubscription.remove();
    } catch {
      // ignore
    }
    statusSubscription = null;
  }

  if (playerInstance) {
    const playerToRelease = playerInstance;
    playerInstance = null; // Clear module reference immediately so it's never reused

    try {
      playerToRelease.pause();
    } catch {
      // ignore
    }

    // Dismiss system media notification and lock screen controls unless in Expo Go
    if (!isExpoGo) {
      try {
        if (typeof playerToRelease.clearLockScreenControls === 'function') {
          const res: any = (playerToRelease as any).clearLockScreenControls();
          if (res && typeof res.catch === 'function') {
            res.catch(() => {});
          }
        } else if (typeof playerToRelease.setActiveForLockScreen === 'function') {
          const res: any = (playerToRelease as any).setActiveForLockScreen(false);
          if (res && typeof res.catch === 'function') {
            res.catch(() => {});
          }
        }
      } catch {
        // Suppress
      }
    }

    try {
      if (typeof playerToRelease.remove === 'function') {
        playerToRelease.remove();
      } else if (typeof (playerToRelease as any).release === 'function') {
        (playerToRelease as any).release();
      }
    } catch {
      // Suppress already released / shared object warnings
    }
  }
}

export function updateAudioMetadata(metadata: AudioMetadata): void {
  if (isExpoGo || !playerInstance) return;
  try {
    if (typeof playerInstance.setActiveForLockScreen === 'function') {
      const res: any = (playerInstance as any).setActiveForLockScreen(
        true,
        metadata,
        DEFAULT_LOCK_SCREEN_OPTIONS
      );
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
    } else if (typeof playerInstance.updateLockScreenMetadata === 'function') {
      const res: any = (playerInstance as any).updateLockScreenMetadata(metadata);
      if (res && typeof res.catch === 'function') {
        res.catch(() => {});
      }
    }
  } catch {
    // Suppress in Expo Go
  }
}

export function getCurrentPlayer(): AudioPlayer | null {
  return playerInstance;
}
