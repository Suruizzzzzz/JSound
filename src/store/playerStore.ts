import { create } from 'zustand';
import { Track, RepeatMode } from '@/types/music';
import {
  getTrackById,
  resolveLocalTrackUri,
  updateTrackOrder,
} from '@/repositories/trackRepository';
import {
  loadAndPlayAudio,
  pauseAudio,
  resumeAudio,
  seekAudio,
  stopAndUnloadAudio,
  updateAudioMetadata,
  getCurrentPlayer,
} from '@/services/audioService';
import {
  getRelatedOnlineTracks,
  extractVideoId,
  resolveOnlineStreamUrl,
} from '@/services/musicDownloadService';

export interface PlaybackContext {
  type: 'library' | 'playlist' | 'search' | 'search-radio';
  name?: string;
}

interface PlayerState {
  tracks: Track[];
  currentTrack: Track | null;
  queue: Track[];
  playbackContext: PlaybackContext | null;
  isPlaying: boolean;
  position: number; // in seconds
  duration: number; // in seconds
  isShuffle: boolean;
  repeatMode: RepeatMode;
  autoPlay: boolean;
  sleepTimerMinutes: number | null;
  isLoading: boolean;
  isBuffering: boolean;
  isSeeking: boolean;
  isModalOpen: boolean;

  // Actions
  setTracks: (tracks: Track[]) => void;
  setQueue: (queue: Track[], context?: PlaybackContext | null) => void;
  setPlaybackContext: (context: PlaybackContext | null) => void;
  setModalOpen: (open: boolean) => void;
  setIsSeeking: (seeking: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setAutoPlay: (enabled: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  playTrack: (
    track: Track,
    customQueue?: Track[],
    context?: PlaybackContext | null
  ) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  clearAllTracks: () => Promise<void>;
  resetPlaybackOnLogout: () => Promise<void>;
  reorderTracks: (tracks: Track[]) => Promise<void>;
  fetchRelatedRadioTracks: (seedTrack?: Track | null) => Promise<void>;
  updateCurrentOrLibraryTrackArtwork: (trackId: string, newArtworkUri: string | null) => void;
  updateTrackMetadata: (
    trackId: string,
    updates: { title?: string; artist?: string; local_artwork_uri?: string | null }
  ) => void;
}

// In-Memory Stream URL Cache (TTL: 30 minutes)
interface CachedStream {
  url: string;
  headers?: Record<string, string>;
  expiresAt: number;
}

const STREAM_URL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const streamUrlCache = new Map<string, CachedStream>();

function getCachedStream(trackId: string): CachedStream | null {
  const cached = streamUrlCache.get(trackId);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    streamUrlCache.delete(trackId);
    return null;
  }
  return cached;
}

function setCachedStream(trackId: string, url: string, headers?: Record<string, string>): void {
  streamUrlCache.set(trackId, {
    url,
    headers,
    expiresAt: Date.now() + STREAM_URL_CACHE_TTL_MS,
  });
}

function extractYoutubeId(track: Track): string | null {
  return (
    track.youtube_id ||
    (track.id.startsWith('online_youtube_')
      ? track.id.replace('online_youtube_', '')
      : track.id.startsWith('stream_youtube_')
      ? track.id.replace('stream_youtube_', '')
      : null)
  );
}

function prefetchNextTrackStream(queue: Track[], currentIndex: number): void {
  if (queue.length <= 1) return;
  const nextIndex = (currentIndex + 1) % queue.length;
  const nextTrack = queue[nextIndex];
  if (!nextTrack) return;

  // Only prefetch online tracks not already downloaded and not already cached
  if (!nextTrack.local_audio_uri && !getCachedStream(nextTrack.id)) {
    const ytId = extractYoutubeId(nextTrack);
    if (ytId) {
      resolveOnlineStreamUrl({
        id: ytId,
        title: nextTrack.title,
        artist: nextTrack.artist,
        duration: nextTrack.duration,
        thumbnailUrl: nextTrack.local_artwork_uri,
        source: 'youtube',
      })
        .then((result) => {
          setCachedStream(nextTrack.id, result.url, result.headers);
        })
        .catch(() => {
          // Silent catch for background prefetch
        });
    }
  }
}

export function preWarmTrackStreams(tracks: Track[]): void {
  if (!tracks || tracks.length === 0) return;
  for (const track of tracks.slice(0, 2)) {
    if (!track.local_audio_uri && !getCachedStream(track.id)) {
      const ytId = extractYoutubeId(track);
      if (ytId) {
        resolveOnlineStreamUrl({
          id: ytId,
          title: track.title,
          artist: track.artist,
          duration: track.duration,
          thumbnailUrl: track.local_artwork_uri,
          source: 'youtube',
        })
          .then((result) => {
            setCachedStream(track.id, result.url, result.headers);
          })
          .catch(() => {});
      }
    }
  }
}

let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
let radioFetchPromise: Promise<void> | null = null;
let playbackSessionId = 0;
let lastSeekTimestamp = 0;
let lastSeekTarget: number | null = null;
let lastHandledFinishSession = -1;
let lastRepeatOneFinishAt = 0;

async function resolveTrackWithOfflineFirst(
  track: Track,
  libraryTracks: Track[]
): Promise<Track> {
  const tryLocalCandidate = async (candidate: Track | undefined | null): Promise<Track | null> => {
    if (!candidate?.local_audio_uri) return null;
    if (
      candidate.local_audio_uri.startsWith('http://') ||
      candidate.local_audio_uri.startsWith('https://')
    ) {
      return null;
    }
    const resolved = await resolveLocalTrackUri(candidate.local_audio_uri);
    if (!resolved.exists || !resolved.uri) return null;
    const resolvedArtResult = candidate.local_artwork_uri
      ? await resolveLocalTrackUri(candidate.local_artwork_uri)
      : null;
    const resolvedArtwork =
      resolvedArtResult?.exists && resolvedArtResult.uri
        ? resolvedArtResult.uri
        : track.local_artwork_uri;
    return {
      ...track,
      local_audio_uri: resolved.uri,
      local_artwork_uri: resolvedArtwork,
      headers: undefined,
      is_streaming: false,
    };
  };

  // 1. Check the track object itself
  const directMatch = await tryLocalCandidate(track);
  if (directMatch) return directMatch;

  // 2. Check in-memory All-Songs library by exact id or youtube_id
  const ytId = extractYoutubeId(track);
  const libraryMatch = libraryTracks.find(
    (t) =>
      t.id === track.id ||
      (ytId !== null && (t.youtube_id === ytId || t.id === `online_youtube_${ytId}`))
  );
  const inMemoryLocal = await tryLocalCandidate(libraryMatch);
  if (inMemoryLocal) return inMemoryLocal;

  // 3. Check SQLite directly (catches downloaded playlist-only tracks not loaded into state.tracks)
  const dbTrack = await getTrackById(track.id);
  const dbLocal = await tryLocalCandidate(dbTrack);
  if (dbLocal) return dbLocal;

  if (ytId && track.id !== `online_youtube_${ytId}`) {
    const altDbTrack = await getTrackById(`online_youtube_${ytId}`);
    const altDbLocal = await tryLocalCandidate(altDbTrack);
    if (altDbLocal) return altDbLocal;
  }

  return track;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  currentTrack: null,
  queue: [],
  playbackContext: { type: 'library', name: 'Local Offline Tracks' },
  isPlaying: false,
  position: 0,
  duration: 0,
  isShuffle: false,
  repeatMode: 'off',
  autoPlay: true,
  sleepTimerMinutes: null,
  isLoading: false,
  isBuffering: false,
  isSeeking: false,
  isModalOpen: false,

  setTracks: (tracks) => set({ tracks }),

  setQueue: (queue, context) =>
    set({ queue, ...(context !== undefined ? { playbackContext: context } : {}) }),

  setPlaybackContext: (playbackContext) => set({ playbackContext }),

  setModalOpen: (isModalOpen) => set({ isModalOpen }),

  setIsSeeking: (isSeeking) => set({ isSeeking }),

  toggleShuffle: () => {
    set((state) => ({ isShuffle: !state.isShuffle }));
  },

  cycleRepeatMode: () => {
    set((state) => {
      const modes: RepeatMode[] = ['off', 'one', 'all'];
      const nextIndex = (modes.indexOf(state.repeatMode) + 1) % modes.length;
      return { repeatMode: modes[nextIndex] };
    });
  },

  setAutoPlay: (autoPlay) => set({ autoPlay }),

  setSleepTimer: (minutes) => {
    if (sleepTimerHandle) {
      clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }

    if (minutes === null) {
      set({ sleepTimerMinutes: null });
      return;
    }

    set({ sleepTimerMinutes: minutes });
    sleepTimerHandle = setTimeout(async () => {
      try {
        await pauseAudio();
        set({ isPlaying: false, sleepTimerMinutes: null });
      } catch (e) {
        console.warn('Sleep timer pause error:', e);
      }
    }, minutes * 60 * 1000);
  },

  playTrack: async (track: Track, customQueue?: Track[], context?: PlaybackContext | null) => {
    const session = ++playbackSessionId;
    lastHandledFinishSession = -1;
    lastSeekTarget = null;
    lastSeekTimestamp = 0;

    const state = get();
    const newQueue = customQueue || (state.queue.length > 0 ? state.queue : state.tracks);
    const resolvedQueue = newQueue.some((t) => t.id === track.id)
      ? newQueue
      : [track, ...newQueue];

    // 1. Instant Optimistic Track Selection (0ms UI response)
    set({
      currentTrack: track,
      queue: resolvedQueue,
      isPlaying: true,
      isLoading: true,
      isBuffering: true,
      isSeeking: false,
      position: 0,
      duration: track.duration || 0,
      ...(context !== undefined ? { playbackContext: context } : {}),
    });

    // 2. Offline-First Priority: resolve verified local audio before any network calls
    let activeTrack = await resolveTrackWithOfflineFirst(track, state.tracks);
    if (session !== playbackSessionId) return;

    const isLocalReady =
      Boolean(activeTrack.local_audio_uri) &&
      !activeTrack.local_audio_uri.startsWith('http://') &&
      !activeTrack.local_audio_uri.startsWith('https://');

    if (!isLocalReady) {
      // 3. Check In-Memory Stream URL Cache (0ms instant startup)
      const cachedStream = getCachedStream(activeTrack.id);
      if (cachedStream) {
        activeTrack = {
          ...activeTrack,
          local_audio_uri: cachedStream.url,
          headers: cachedStream.headers,
          is_streaming: true,
        };
      }

      // 4. Dynamically resolve online audio stream only if not already cached
      if (
        (!activeTrack.local_audio_uri || activeTrack.is_streaming) &&
        !cachedStream &&
        (activeTrack.is_streaming || activeTrack.source === 'youtube')
      ) {
        const ytId = extractYoutubeId(activeTrack);

        if (ytId) {
          try {
            const streamResult = await resolveOnlineStreamUrl({
              id: ytId,
              title: activeTrack.title,
              artist: activeTrack.artist,
              duration: activeTrack.duration,
              thumbnailUrl: activeTrack.local_artwork_uri,
              source: 'youtube',
            });
            if (session !== playbackSessionId) return;

            setCachedStream(activeTrack.id, streamResult.url, streamResult.headers);

            activeTrack = {
              ...activeTrack,
              local_audio_uri: streamResult.url,
              headers: streamResult.headers,
              is_streaming: true,
            };
          } catch (resErr) {
            if (session !== playbackSessionId) return;
            console.warn('[PlayerStore] Failed to resolve online stream for:', activeTrack.title, resErr);
          }
        }
      }
    }

    if (session !== playbackSessionId) return;

    // If unplayable (no valid local file and online resolution failed), try next locally-playable or remaining queue track once without looping
    if (!activeTrack.local_audio_uri) {
      console.warn('Track audio is not on device:', activeTrack.title);
      const currIdx = resolvedQueue.findIndex((t) => t.id === activeTrack.id);
      const nextLocalPlayable = resolvedQueue.find(
        (t) =>
          t.id !== activeTrack.id &&
          Boolean(t.local_audio_uri) &&
          !t.local_audio_uri.startsWith('http')
      );
      if (nextLocalPlayable) {
        await get().playTrack(nextLocalPlayable, resolvedQueue, context);
        return;
      }
      const nextIdx = currIdx >= 0 ? currIdx + 1 : 0;
      if (resolvedQueue.length > 1 && nextIdx < resolvedQueue.length) {
        const candidate = resolvedQueue[nextIdx];
        if (candidate && candidate.id !== activeTrack.id && candidate.is_streaming) {
          await get().playTrack(candidate, resolvedQueue, context);
          return;
        }
      }
      set({ isPlaying: false, isLoading: false, isBuffering: false, currentTrack: activeTrack });
      return;
    }

    const updatedQueue = resolvedQueue.map((t) => (t.id === activeTrack.id ? activeTrack : t));

    set({
      currentTrack: activeTrack,
      queue: updatedQueue,
      isLoading: true,
      isPlaying: true,
      position: 0,
      duration: activeTrack.duration || 0,
      ...(context !== undefined ? { playbackContext: context } : {}),
    });

    try {
      const audioSource = activeTrack.headers
        ? { uri: activeTrack.local_audio_uri, headers: activeTrack.headers }
        : activeTrack.local_audio_uri;

      const metadata = {
        title: activeTrack.title || 'Unknown Title',
        artist: activeTrack.artist || 'Unknown Artist',
        albumTitle: 'JStream',
        artworkUrl: activeTrack.local_artwork_uri || undefined,
      };

      const player = await loadAndPlayAudio(
        audioSource,
        (status) => {
          if (session !== playbackSessionId) return;
          const rawPosition = status.currentTime ?? 0;
          const duration = status.duration > 0 ? status.duration : activeTrack.duration || 0;

          const isBuffering =
            status.isBuffering ||
            status.timeControlStatus === 'waiting' ||
            !status.isLoaded;

          set((prevState) => {
            if (session !== playbackSessionId) return prevState;
            const nextIsPlaying = isBuffering ? prevState.isPlaying : status.playing;

            // Freeze position updates while the user is actively dragging the seek scrubber
            if (prevState.isSeeking) {
              if (
                prevState.isPlaying === nextIsPlaying &&
                prevState.isLoading === isBuffering &&
                prevState.isBuffering === isBuffering &&
                prevState.duration === duration
              ) {
                return prevState;
              }
              return {
                isPlaying: nextIsPlaying,
                isLoading: isBuffering,
                isBuffering,
                duration,
              };
            }

            let nextPosition = prevState.position;
            if (
              typeof status.currentTime === 'number' &&
              !isNaN(status.currentTime) &&
              status.currentTime >= 0
            ) {
              const isWithinSeekWindow = Date.now() - lastSeekTimestamp < 1200;
              const currentPositionMs = prevState.position * 1000;
              const reportedPositionMs = status.currentTime * 1000;

              if (
                isWithinSeekWindow &&
                lastSeekTarget !== null &&
                Math.abs(status.currentTime - lastSeekTarget) > 1.5
              ) {
                // Ignore pre-seek status ticks carrying the old playback position
                nextPosition = prevState.position;
              } else if (
                !isWithinSeekWindow &&
                reportedPositionMs < currentPositionMs &&
                currentPositionMs - reportedPositionMs < 2500
              ) {
                // Ignore minor backward jitter during normal playback
                nextPosition = prevState.position;
              } else {
                nextPosition = status.currentTime;
                if (lastSeekTarget !== null && Math.abs(status.currentTime - lastSeekTarget) <= 1.5) {
                  lastSeekTarget = null;
                }
              }
            }

            if (
              Math.abs(prevState.position - nextPosition) < 0.05 &&
              prevState.duration === duration &&
              prevState.isPlaying === nextIsPlaying &&
              prevState.isLoading === isBuffering &&
              prevState.isBuffering === isBuffering
            ) {
              return prevState;
            }

            return {
              isPlaying: nextIsPlaying,
              isLoading: isBuffering,
              isBuffering,
              position: nextPosition,
              duration,
            };
          });

          if (
            status.didJustFinish &&
            lastHandledFinishSession !== session &&
            (rawPosition > 1 || (duration > 0 && rawPosition >= duration - 1.5))
          ) {
            const currentRepeat = get().repeatMode;
            const autoPlay = get().autoPlay;
            if (currentRepeat === 'one') {
              const now = Date.now();
              if (now - lastRepeatOneFinishAt > 1000) {
                lastRepeatOneFinishAt = now;
                lastSeekTarget = 0;
                lastSeekTimestamp = now;
                set({ position: 0, isPlaying: true });
                seekAudio(0)
                  .then(() => resumeAudio())
                  .catch(() => {});
              }
              return;
            }

            lastHandledFinishSession = session;
            if (!autoPlay) {
              pauseAudio();
              set({ isPlaying: false, isBuffering: false, isLoading: false, position: 0 });
              return;
            }

            const {
              queue: activeQueue,
              currentTrack: activeCur,
              playbackContext: activeCtx,
              isShuffle,
            } = get();
            const currIdx = activeQueue.findIndex((t) => t.id === activeCur?.id);
            const isAtEnd =
              activeQueue.length === 0 || (currIdx >= 0 && currIdx >= activeQueue.length - 1);

            if (
              currentRepeat === 'off' &&
              !isShuffle &&
              isAtEnd &&
              activeCtx?.type !== 'search-radio'
            ) {
              pauseAudio();
              set({ isPlaying: false, isBuffering: false, isLoading: false, position: 0 });
            } else {
              get().playNext();
            }
          }
        },
        activeTrack.headers,
        metadata
      );

      if (session !== playbackSessionId || !player) return;

      set({ isPlaying: true, isLoading: false, isBuffering: false });

      // Silently prefetch the next online track only after current track starts cleanly
      const currTrackIndex = updatedQueue.findIndex((t) => t.id === activeTrack.id);
      prefetchNextTrackStream(updatedQueue, currTrackIndex);
    } catch (error) {
      if (session !== playbackSessionId) return;
      console.warn('Error playing track:', error);
      set({ isPlaying: false, isLoading: false, isBuffering: false });
    }
  },

  togglePlayPause: async () => {
    const { currentTrack, isPlaying, duration, position, playTrack } = get();
    if (!currentTrack) return;

    try {
      if (isPlaying) {
        await pauseAudio();
        set({ isPlaying: false, isBuffering: false, isLoading: false });
      } else {
        if (!getCurrentPlayer()) {
          await playTrack(currentTrack);
          return;
        }
        if (duration > 0 && position >= duration - 0.5) {
          lastSeekTarget = 0;
          lastSeekTimestamp = Date.now();
          await seekAudio(0);
          set({ position: 0 });
        }
        await resumeAudio();
        set({ isPlaying: true });
      }
    } catch (error) {
      console.warn('Error toggling play/pause:', error);
    }
  },

  playNext: async () => {
    const { queue, currentTrack, isShuffle, playbackContext, playTrack } = get();
    if (queue.length === 0) return;

    let currentQueue = queue;
    let currentIndex = currentQueue.findIndex((t) => t.id === currentTrack?.id);

    // If in search-radio mode and at the end of the queue, await in-flight or trigger radio fetch first
    if (
      playbackContext?.type === 'search-radio' &&
      (currentIndex === -1 || currentIndex >= currentQueue.length - 1)
    ) {
      await get().fetchRelatedRadioTracks(currentTrack);
      currentQueue = get().queue;
      currentIndex = currentQueue.findIndex((t) => t.id === currentTrack?.id);
    }

    let nextIndex: number;
    if (isShuffle && currentQueue.length > 1) {
      // Pick random index different from current
      do {
        nextIndex = Math.floor(Math.random() * currentQueue.length);
      } while (nextIndex === currentIndex && currentQueue.length > 1);
    } else {
      // Loop infinitely by default: wrapping seamlessly to queue[0] on the last track
      nextIndex = currentIndex >= 0 ? (currentIndex + 1) % currentQueue.length : 0;
    }

    // Auto-fetch next batch in 'search-radio' mode when remaining tracks <= 2
    if (playbackContext?.type === 'search-radio') {
      const remainingTracks = currentQueue.length - 1 - nextIndex;
      if (remainingTracks <= 2) {
        const seed = currentQueue[nextIndex] || currentTrack;
        get().fetchRelatedRadioTracks(seed);
      }
    }

    await playTrack(currentQueue[nextIndex], currentQueue);
  },

  playPrevious: async () => {
    const { queue, currentTrack, position, playTrack, seekTo } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart track
    if (position > 3) {
      await seekTo(0);
      return;
    }

    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);
    // Tapping Previous on queue[0] wraps to queue[queue.length - 1]
    const nextIndex = currentIndex > 0 ? currentIndex - 1 : queue.length - 1;
    await playTrack(queue[nextIndex], queue);
  },

  fetchRelatedRadioTracks: async (seedTrack?: Track | null) => {
    const state = get();
    const track = seedTrack || state.currentTrack;
    if (!track) return;

    if (radioFetchPromise) {
      return radioFetchPromise;
    }

    radioFetchPromise = (async () => {
      try {
        const videoId =
          extractYoutubeId(track) ||
          extractVideoId(track.youtube_id || track.id || track.local_audio_uri) ||
          '';

        const artist = (track.artist || '').trim();
        const cleanTitle = (track.title || '')
          .replace(/\(Official.*?\)/gi, '')
          .replace(/\[Official.*?\]/gi, '')
          .replace(/ft\..*$/gi, '')
          .replace(/feat\..*$/gi, '')
          .replace(/\(.*?\)/g, '')
          .replace(/\[.*?\]/g, '')
          .trim();

        const fallbackQuery =
          artist && cleanTitle
            ? `${artist} ${cleanTitle}`
            : artist
            ? `${artist} songs`
            : cleanTitle;

        const results = await getRelatedOnlineTracks(videoId, fallbackQuery);
        if (results.length === 0) return;

        const currentQueue = get().queue;
        const existingVideoIds = new Set(
          currentQueue
            .map((t) =>
              t.youtube_id ||
              t.id.replace(/^online_youtube_/, '').replace(/^stream_youtube_/, '')
            )
            .filter(Boolean)
        );

        const relatedTracks: Track[] = results
          .filter((r) => r.id && !existingVideoIds.has(r.id))
          .map((r) => ({
            id: `online_youtube_${r.id}`,
            user_id: 'local_guest',
            youtube_id: r.id,
            title: r.title,
            artist: r.artist || artist || 'Unknown Artist',
            local_audio_uri: '',
            local_artwork_uri: r.thumbnailUrl || null,
            duration: r.duration || 0,
            source: 'youtube',
            is_synced: 0,
            created_at: new Date().toISOString(),
            is_streaming: true,
            is_playlist_only: 1,
          }));

        if (relatedTracks.length > 0) {
          const updatedQueue = [...get().queue, ...relatedTracks];
          set({ queue: updatedQueue });

          // Pre-warm stream URL for queue[currentIndex + 1] if available
          const cTrack = get().currentTrack;
          const cIndex = updatedQueue.findIndex((t) => t.id === cTrack?.id);
          if (cIndex >= 0 && cIndex < updatedQueue.length - 1) {
            preWarmTrackStreams([updatedQueue[cIndex + 1]]);
          }
        }
      } catch (err) {
        console.warn('[PlayerStore] Error fetching related radio tracks:', err);
      } finally {
        radioFetchPromise = null;
      }
    })();

    return radioFetchPromise;
  },

  seekTo: async (seconds: number) => {
    const maxDur = get().duration;
    const clamped = Math.max(0, maxDur > 0 ? Math.min(seconds, maxDur) : seconds);
    lastSeekTimestamp = Date.now();
    lastSeekTarget = clamped;
    set({ position: clamped });
    try {
      await seekAudio(clamped);
    } catch (error) {
      console.warn('Error seeking audio:', error);
    }
  },

  removeTrack: async (id: string) => {
    const { currentTrack, queue, tracks, playNext } = get();
    const updatedTracks = tracks.filter((t) => t.id !== id);
    const updatedQueue = queue.filter((t) => t.id !== id);

    set({ tracks: updatedTracks, queue: updatedQueue });

    if (currentTrack?.id === id) {
      if (updatedQueue.length > 0) {
        await playNext();
      } else {
        await stopAndUnloadAudio();
        set({ currentTrack: null, isPlaying: false, isBuffering: false, position: 0, duration: 0 });
      }
    }
  },

  clearAllTracks: async () => {
    playbackSessionId += 1;
    lastHandledFinishSession = -1;
    lastSeekTarget = null;
    try {
      await stopAndUnloadAudio();
    } catch (e) {
      console.warn('Error unloading audio on clearAllTracks:', e);
    }
    set({
      tracks: [],
      queue: [],
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      isSeeking: false,
      position: 0,
      duration: 0,
    });
  },

  resetPlaybackOnLogout: async () => {
    playbackSessionId += 1;
    lastHandledFinishSession = -1;
    lastSeekTarget = null;
    lastSeekTimestamp = 0;
    if (sleepTimerHandle) {
      clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }
    streamUrlCache.clear();
    try {
      await stopAndUnloadAudio();
    } catch (e) {
      console.warn('Error unloading audio on logout:', e);
    }
    set({
      tracks: [],
      queue: [],
      currentTrack: null,
      isPlaying: false,
      isLoading: false,
      isBuffering: false,
      isSeeking: false,
      position: 0,
      duration: 0,
      sleepTimerMinutes: null,
      playbackContext: null,
    });
  },

  reorderTracks: async (newTracks: Track[]) => {
    set({ tracks: newTracks, queue: newTracks });
    try {
      await updateTrackOrder(newTracks.map((t) => t.id));
    } catch (err) {
      console.warn('Failed to persist reordered tracks:', err);
    }
  },

  updateCurrentOrLibraryTrackArtwork: (trackId: string, newArtworkUri: string | null) => {
    const { tracks, queue, currentTrack } = get();

    const updateTrackItem = (t: Track): Track =>
      t.id === trackId ? { ...t, local_artwork_uri: newArtworkUri } : t;

    const nextTracks = tracks.map(updateTrackItem);
    const nextQueue = queue.map(updateTrackItem);
    const nextCurrent =
      currentTrack?.id === trackId
        ? { ...currentTrack, local_artwork_uri: newArtworkUri }
        : currentTrack;

    set({
      tracks: nextTracks,
      queue: nextQueue,
      currentTrack: nextCurrent,
    });

    if (nextCurrent && nextCurrent.id === trackId) {
      updateAudioMetadata({
        title: nextCurrent.title,
        artist: nextCurrent.artist,
        artworkUrl: newArtworkUri || undefined,
      });
    }
  },

  updateTrackMetadata: (
    trackId: string,
    updates: { title?: string; artist?: string; local_artwork_uri?: string | null }
  ) => {
    const { tracks, queue, currentTrack } = get();

    const updateTrackItem = (t: Track): Track =>
      t.id === trackId ? { ...t, ...updates } : t;

    const nextTracks = tracks.map(updateTrackItem);
    const nextQueue = queue.map(updateTrackItem);
    const nextCurrent =
      currentTrack?.id === trackId ? { ...currentTrack, ...updates } : currentTrack;

    set({
      tracks: nextTracks,
      queue: nextQueue,
      currentTrack: nextCurrent,
    });

    if (nextCurrent && nextCurrent.id === trackId) {
      updateAudioMetadata({
        title: nextCurrent.title,
        artist: nextCurrent.artist,
        artworkUrl: nextCurrent.local_artwork_uri || undefined,
      });
    }
  },
}));
