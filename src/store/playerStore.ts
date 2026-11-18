import { create } from 'zustand';
import { Track, RepeatMode } from '@/types/music';
import { updateTrackOrder } from '@/repositories/trackRepository';
import {
  loadAndPlayAudio,
  pauseAudio,
  resumeAudio,
  seekAudio,
  stopAndUnloadAudio,
  updateAudioMetadata,
} from '@/services/audioService';

interface PlayerState {
  tracks: Track[];
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  position: number; // in seconds
  duration: number; // in seconds
  isShuffle: boolean;
  repeatMode: RepeatMode;
  autoPlay: boolean;
  sleepTimerMinutes: number | null;
  isLoading: boolean;
  isModalOpen: boolean;

  // Actions
  setTracks: (tracks: Track[]) => void;
  setQueue: (queue: Track[]) => void;
  setModalOpen: (open: boolean) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setAutoPlay: (enabled: boolean) => void;
  setSleepTimer: (minutes: number | null) => void;
  playTrack: (track: Track, customQueue?: Track[]) => Promise<void>;
  togglePlayPause: () => Promise<void>;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  removeTrack: (id: string) => Promise<void>;
  clearAllTracks: () => Promise<void>;
  reorderTracks: (tracks: Track[]) => Promise<void>;
  updateCurrentOrLibraryTrackArtwork: (trackId: string, newArtworkUri: string | null) => void;
  updateTrackMetadata: (
    trackId: string,
    updates: { title?: string; artist?: string; local_artwork_uri?: string | null }
  ) => void;
}

let sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;

export const usePlayerStore = create<PlayerState>((set, get) => ({
  tracks: [],
  currentTrack: null,
  queue: [],
  isPlaying: false,
  position: 0,
  duration: 0,
  isShuffle: false,
  repeatMode: 'off',
  autoPlay: true,
  sleepTimerMinutes: null,
  isLoading: false,
  isModalOpen: false,

  setTracks: (tracks) => set({ tracks }),

  setQueue: (queue) => set({ queue }),

  setModalOpen: (isModalOpen) => set({ isModalOpen }),

  toggleShuffle: () => {
    set((state) => ({ isShuffle: !state.isShuffle }));
  },

  cycleRepeatMode: () => {
    set((state) => {
      const modes: RepeatMode[] = ['off', 'all', 'one'];
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

  playTrack: async (track: Track, customQueue?: Track[]) => {
    const state = get();
    const newQueue = customQueue || (state.queue.length > 0 ? state.queue : state.tracks);
    const resolvedQueue = newQueue.some((t) => t.id === track.id)
      ? newQueue
      : [track, ...newQueue];

    set({
      currentTrack: track,
      queue: resolvedQueue,
      isLoading: true,
      isPlaying: true, // Auto-play: proactively activate playing state
      position: 0,
      duration: track.duration || 0,
    });

    try {
      const audioSource = track.headers
        ? { uri: track.local_audio_uri, headers: track.headers }
        : track.local_audio_uri;

      const metadata = {
        title: track.title || 'Unknown Title',
        artist: track.artist || 'Unknown Artist',
        albumTitle: 'JStream',
        artworkUrl: track.local_artwork_uri || undefined,
      };

      await loadAndPlayAudio(
        audioSource,
        (status) => {
          const position = status.currentTime ?? 0;
          const duration = status.duration > 0 ? status.duration : (track.duration || 0);

          // While buffering or loading stream, do not flip isPlaying to false prematurely
          const isBuffering =
            status.isBuffering ||
            status.timeControlStatus === 'waiting' ||
            !status.isLoaded;

          set((prevState) => ({
            isPlaying: isBuffering ? true : status.playing,
            isLoading: isBuffering,
            position,
            duration,
          }));

          if (status.didJustFinish && (position > 1 || (duration > 0 && position >= duration - 1.5))) {
            const currentRepeat = get().repeatMode;
            const autoPlay = get().autoPlay;
            if (currentRepeat === 'one') {
              get().seekTo(0).then(() => resumeAudio());
            } else if (autoPlay) {
              get().playNext();
            } else {
              pauseAudio();
              set({ isPlaying: false });
            }
          }
        },
        track.headers,
        metadata
      );

      set({ isPlaying: true, isLoading: false });
    } catch (error) {
      console.warn('Error playing track:', error);
      set({ isPlaying: false, isLoading: false });
    }
  },

  togglePlayPause: async () => {
    const { currentTrack, isPlaying } = get();
    if (!currentTrack) return;

    try {
      if (isPlaying) {
        await pauseAudio();
        set({ isPlaying: false });
      } else {
        await resumeAudio();
        set({ isPlaying: true });
      }
    } catch (error) {
      console.warn('Error toggling play/pause:', error);
    }
  },

  playNext: async () => {
    const { queue, currentTrack, isShuffle, repeatMode, playTrack } = get();
    if (queue.length === 0) return;

    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);

    if (isShuffle && queue.length > 1) {
      // Pick random index different from current
      let nextIndex: number;
      do {
        nextIndex = Math.floor(Math.random() * queue.length);
      } while (nextIndex === currentIndex && queue.length > 1);

      await playTrack(queue[nextIndex], queue);
      return;
    }

    if (currentIndex >= 0 && currentIndex < queue.length - 1) {
      await playTrack(queue[currentIndex + 1], queue);
    } else if (repeatMode === 'all') {
      await playTrack(queue[0], queue);
    } else {
      // End of queue (infinite continuous playback):
      // When reaching the last song, continue seamlessly with a randomized song so music never stops
      const pool = queue.length > 0 ? queue : get().tracks;
      if (pool.length > 1) {
        let nextIndex: number;
        do {
          nextIndex = Math.floor(Math.random() * pool.length);
        } while (nextIndex === currentIndex && pool.length > 1);
        await playTrack(pool[nextIndex], pool);
      } else if (pool.length === 1) {
        await playTrack(pool[0], pool);
      } else {
        await stopAndUnloadAudio();
        set({ isPlaying: false, position: 0 });
      }
    }
  },

  playPrevious: async () => {
    const { queue, currentTrack, position, repeatMode, playTrack, seekTo } = get();
    if (queue.length === 0) return;

    // If more than 3 seconds in, restart track
    if (position > 3) {
      await seekTo(0);
      return;
    }

    const currentIndex = queue.findIndex((t) => t.id === currentTrack?.id);

    if (currentIndex > 0) {
      await playTrack(queue[currentIndex - 1], queue);
    } else if (repeatMode === 'all') {
      await playTrack(queue[queue.length - 1], queue);
    } else {
      await seekTo(0);
    }
  },

  seekTo: async (seconds: number) => {
    const clamped = Math.max(0, Math.min(seconds, get().duration || seconds));
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
        set({ currentTrack: null, isPlaying: false, position: 0, duration: 0 });
      }
    }
  },

  clearAllTracks: async () => {
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
      position: 0,
      duration: 0,
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
