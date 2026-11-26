import 'react-native-url-polyfill/auto';
import * as FileSystem from 'expo-file-system/legacy';
import { Innertube } from 'youtubei.js';
import { Track } from '@/types/music';
import { saveTrack, getAllTracks, normalizeLocalFileUri } from '@/repositories/trackRepository';
import { getActiveUserId } from '@/lib/database';
import { usePlayerStore } from '@/store/playerStore';

export interface OnlineTrackResult {
  id: string;
  title: string;
  artist: string;
  duration: number; // in seconds
  thumbnailUrl: string | null;
  source: 'youtube' | 'audius';
  downloadUrl?: string;
}

export interface ResolvedStreamResult {
  url: string;
  headers?: Record<string, string>;
}

const YOUTUBE_MOBILE_USER_AGENT =
  'com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip';

/**
 * Public Piped API instances used as a secondary search/stream fallback.
 */
export const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.private.coffee',
  'https://pipedapi.leptons.xyz',
  'https://pipedapi.ducks.party',
  'https://pipedapi.reallyaweso.me',
  'https://piped-api.lunar.icu',
];

/**
 * Public Invidious instances used as secondary stream fallback with &local=true proxying.
 */
export const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://yewtu.be',
  'https://invidious.nerdvpn.de',
  'https://invidious.jing.rocks',
  'https://iv.ggtyler.dev',
];

// Lazy singleton Innertube instance
let innertubeInstance: Innertube | null = null;
let innertubeInitPromise: Promise<Innertube> | null = null;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function getInnertube(): Promise<Innertube> {
  if (innertubeInstance) {
    return innertubeInstance;
  }
  if (!innertubeInitPromise) {
    innertubeInitPromise = withTimeout(
      Innertube.create({
        retrieve_player: false,
        generate_session_locally: true,
      }),
      8000,
      'Innertube init'
    )
      .then((instance) => {
        innertubeInstance = instance;
        return instance;
      })
      .catch((err) => {
        innertubeInitPromise = null;
        console.warn('Failed to initialize Innertube session:', err);
        throw err;
      });
  }
  return innertubeInitPromise;
}

/**
 * Helper to fetch with an enforced timeout via AbortController.
 */
async function fetchWithTimeout(
  url: string,
  timeoutMs = 5000,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lightweight verification to check stream reachability before returning.
 * Confirms HTTP 200 or 206 Partial Content so expo-audio never receives a 403 or dead link.
 */
export async function verifyStreamUrl(
  url: string,
  timeoutMs = 4000,
  headers?: Record<string, string>
): Promise<boolean> {
  if (!url || typeof url !== 'string') return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const reqHeaders: Record<string, string> = {
      'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
      ...headers,
    };

    // Try HEAD first
    let res = await fetch(url, {
      method: 'HEAD',
      headers: reqHeaders,
      signal: controller.signal,
    });

    if (res.ok || res.status === 200 || res.status === 206) {
      clearTimeout(timer);
      return true;
    }

    // Some servers reject HEAD with 403 or 405 Method Not Allowed; retry with lightweight Range GET
    if (res.status === 405 || res.status === 403 || !res.ok) {
      const c2 = new AbortController();
      const t2 = setTimeout(() => c2.abort(), timeoutMs);
      res = await fetch(url, {
        method: 'GET',
        headers: {
          ...reqHeaders,
          Range: 'bytes=0-1',
        },
        signal: c2.signal,
      });
      clearTimeout(t2);
      if (res.ok || res.status === 200 || res.status === 206) {
        clearTimeout(timer);
        return true;
      }
    }

    clearTimeout(timer);
    return false;
  } catch {
    return false;
  }
}

/**
 * Extracts the 11-character YouTube video ID from a URL, direct ID, or link.
 */
export function extractVideoId(urlOrId: string | undefined | null): string {
  if (!urlOrId || typeof urlOrId !== 'string') return '';
  const clean = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(clean)) return clean;
  const match = clean.match(/(?:v=|youtu\.be\/|shorts\/|\/watch\/|\/streams\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  const queryMatch = clean.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (queryMatch) return queryMatch[1];
  return clean.replace('/watch?v=', '').split('&')[0];
}

/**
 * Parses lengthText (e.g. "3:45", "01:23:45", or number in seconds) into total seconds.
 */
export function parseDurationToSeconds(val: string | number | undefined | null): number {
  if (typeof val === 'number') {
    return Math.max(0, Math.round(val));
  }
  if (!val || typeof val !== 'string') {
    return 0;
  }
  const clean = val.trim();
  const parts = clean.split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) {
    const parsedNum = parseFloat(clean);
    return isNaN(parsedNum) ? 0 : Math.round(parsedNum);
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

/**
 * Fallback search via Audius public discovery API (limit=30)
 */
async function searchAudiusTracks(query: string): Promise<OnlineTrackResult[]> {
  const url = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(
    query
  )}&limit=30&app_name=JStream`;
  const response = await fetchWithTimeout(url, 6000, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`Audius API returned status ${response.status}`);
  }

  const json = await response.json();
  const items: any[] = Array.isArray(json?.data) ? json.data : [];

  return items
    .filter((item) => item.is_streamable !== false)
    .map((item) => ({
      id: String(item.id),
      title: item.title || 'Unknown Track',
      artist: item.user?.name || item.user?.handle || 'Unknown Artist',
      duration: parseDurationToSeconds(item.duration),
      thumbnailUrl:
        item.artwork?.['150x150'] ||
        item.artwork?.['480x480'] ||
        item.artwork?.['1000x1000'] ||
        null,
      source: 'audius',
      downloadUrl: `https://discoveryprovider.audius.co/v1/tracks/${item.id}/stream?app_name=JStream`,
    }));
}

/**
 * Locates and verifies a playable stream URL from Audius by searching title + artist
 */
async function resolveAudiusFallbackStream(title: string, artist: string): Promise<string | null> {
  try {
    const cleanQuery = `${title} ${artist}`
      .replace(/[[({][^\])}]*[\])}]/g, '')
      .replace(/ft\.|feat\.|official|video|audio|lyrics/gi, '')
      .trim();

    const searchUrl = `https://discoveryprovider.audius.co/v1/tracks/search?query=${encodeURIComponent(
      cleanQuery || title
    )}&limit=10&app_name=JStream`;

    const res = await fetchWithTimeout(searchUrl, 5000, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const json = await res.json();
      const items: any[] = Array.isArray(json?.data) ? json.data : [];
      const streamable = items.filter((i) => i.is_streamable !== false);

      for (const item of streamable.slice(0, 4)) {
        if (!item?.id) continue;
        const candidateUrl = `https://discoveryprovider.audius.co/v1/tracks/${item.id}/stream?app_name=JStream`;
        const isValid = await verifyStreamUrl(candidateUrl, 3500);
        if (isValid) {
          return candidateUrl;
        }
      }
    }
  } catch (e) {
    console.warn('Audius fallback stream search error:', e);
  }
  return null;
}

/**
 * Search online music catalog via YouTube Innertube API natively,
 * with automatic fallback to Piped instances and the Audius public catalog.
 */
export async function searchOnlineTracks(query: string): Promise<OnlineTrackResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  // 1. Primary: Search directly via YouTube Innertube
  try {
    const innertube = await getInnertube();
    const searchRes = await withTimeout(
      innertube.search(trimmed, { type: 'video' }),
      7000,
      'Innertube search'
    );
    const rawVideos: any[] = (searchRes as any)?.videos || [];

    if (Array.isArray(rawVideos) && rawVideos.length > 0) {
      const results: OnlineTrackResult[] = [];
      for (const v of rawVideos) {
        const id = extractVideoId(v.id);
        if (!id) continue;

        const title = v.title?.text || v.title?.toString() || 'Unknown Title';
        const artist = v.author?.name || 'Unknown Artist';
        const duration =
          typeof v.duration?.seconds === 'number'
            ? v.duration.seconds
            : parseDurationToSeconds(v.duration?.text);
        const thumbnailUrl =
          v.thumbnails?.[0]?.url ||
          (Array.isArray(v.thumbnail?.thumbnails) && v.thumbnail.thumbnails[0]?.url) ||
          null;

        results.push({
          id,
          title,
          artist,
          duration,
          thumbnailUrl,
          source: 'youtube',
        });
      }

      if (results.length > 0) {
        return results;
      }
    }
  } catch (err) {
    console.warn('Innertube search failed, falling back to Piped:', err);
  }

  // 2. Secondary fallback: Search public Piped instances
  for (const instance of PIPED_INSTANCES) {
    try {
      let searchUrl = `${instance}/search?q=${encodeURIComponent(trimmed)}&filter=music_songs`;
      let response = await fetchWithTimeout(searchUrl, 5000, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok || response.status === 404) {
        searchUrl = `${instance}/search?q=${encodeURIComponent(trimmed)}&filter=videos`;
        response = await fetchWithTimeout(searchUrl, 5000, {
          headers: { Accept: 'application/json' },
        });
      }

      if (response.ok) {
        const json = await response.json();
        const rawItems: any[] = json?.items || (Array.isArray(json) ? json : []);

        if (Array.isArray(rawItems) && rawItems.length > 0) {
          const results: OnlineTrackResult[] = [];

          for (const item of rawItems) {
            const id = extractVideoId(item.url || item.id || item.videoId);
            if (!id || id === '[object Object]') continue;

            const title = item.title || 'Unknown Title';
            const artist = item.uploaderName || item.channelTitle || item.author || 'Unknown Artist';
            const duration = parseDurationToSeconds(item.duration);
            const thumbnailUrl =
              item.thumbnail ||
              (Array.isArray(item.thumbnails) && item.thumbnails.length > 0
                ? item.thumbnails[0].url
                : null);

            results.push({
              id,
              title,
              artist,
              duration,
              thumbnailUrl,
              source: 'youtube',
            });
          }

          if (results.length > 0) {
            return results;
          }
        }
      }
    } catch (err) {
      console.warn(`Piped instance [${instance}] search failed, trying next instance:`, err);
    }
  }

  // 3. Final fallback: Audius public catalog
  return searchAudiusTracks(trimmed);
}

/**
 * Fetches related tracks for seamless Search Radio / Autoplay Up Next.
 * Prioritizes YouTube's native watch_next_feed recommendations,
 * seamlessly falling back to searchOnlineTracks if fewer than 5 tracks are returned.
 */
export async function getRelatedOnlineTracks(
  videoId: string,
  fallbackQuery: string
): Promise<OnlineTrackResult[]> {
  const cleanVideoId = extractVideoId(videoId);
  const seenIds = new Set<string>();
  if (cleanVideoId) {
    seenIds.add(cleanVideoId);
  }
  const results: OnlineTrackResult[] = [];

  if (cleanVideoId) {
    try {
      const innertube = await getInnertube();
      const info = await withTimeout(innertube.getInfo(cleanVideoId), 6000, 'Innertube getInfo');
      const feed = (info as any)?.watch_next_feed;
      const rawItems: any[] = Array.isArray(feed)
        ? feed
        : Array.isArray((feed as any)?.items)
        ? (feed as any).items
        : feed && typeof feed[Symbol.iterator] === 'function'
        ? Array.from(feed)
        : [];

      for (const v of rawItems) {
        const id = extractVideoId(v.video_id || v.id);
        if (!id || seenIds.has(id)) continue;

        const title =
          v.title?.text ||
          v.title?.toString?.() ||
          (typeof v.title === 'string' ? v.title : '');
        if (!title || title === '[object Object]') continue;

        const artist =
          v.author?.name ||
          v.author?.text ||
          v.author?.toString?.() ||
          v.short_byline?.text ||
          v.short_byline_text?.text ||
          'Unknown Artist';

        const duration =
          typeof v.duration?.seconds === 'number'
            ? v.duration.seconds
            : parseDurationToSeconds(v.duration?.text || v.length_text?.text);

        const thumbnailUrl =
          v.best_thumbnail?.url ||
          v.thumbnails?.[0]?.url ||
          (Array.isArray(v.thumbnail?.thumbnails) && v.thumbnail.thumbnails[0]?.url) ||
          null;

        seenIds.add(id);
        results.push({
          id,
          title,
          artist,
          duration,
          thumbnailUrl,
          source: 'youtube',
        });

        if (results.length >= 15) break;
      }
    } catch (err) {
      console.warn('[musicDownloadService] Failed to fetch watch_next_feed:', err);
    }
  }

  // If watch_next_feed returns fewer than 5 tracks or throws, seamlessly fall back to searchOnlineTracks
  if (results.length < 5 && fallbackQuery?.trim()) {
    try {
      const fallbackResults = await searchOnlineTracks(fallbackQuery.trim());
      for (const item of fallbackResults) {
        const id = extractVideoId(item.id);
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        results.push({
          ...item,
          id,
        });
        if (results.length >= 15) break;
      }
    } catch (err) {
      console.warn('[musicDownloadService] Fallback search for related tracks failed:', err);
    }
  }

  return results.slice(0, 15);
}

/**
 * Extracts and resolves a direct, IP-matched audio stream URL and required headers for an online track.
 * Strictly prioritizes audio/mp4 (.m4a / AAC) to prevent Android expo-audio from stalling at 0:00.
 */
export async function resolveOnlineStreamUrl(
  track: OnlineTrackResult,
  options?: { verify?: boolean }
): Promise<ResolvedStreamResult> {
  const youtubeHeaders: Record<string, string> = {
    'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
  };
  const shouldVerify = Boolean(options?.verify);

  if (track.source === 'youtube') {
    // -------------------------------------------------------------
    // Tier 1: YouTube Innertube Android Client (Direct unencrypted .m4a)
    // -------------------------------------------------------------
    try {
      const innertube = await getInnertube();

      for (const clientName of ['ANDROID', 'IOS'] as const) {
        try {
          const info = await withTimeout(
            innertube.getBasicInfo(track.id, { client: clientName }),
            6000,
            `Innertube basicInfo (${clientName})`
          );
          const formats: any[] = info.streaming_data?.adaptive_formats || [];

          // Strictly filter for audio-only formats, prioritizing audio/mp4 (.m4a / AAC)
          const audioFormats = formats.filter(
            (f) => f.has_audio && !f.has_video
          );

          if (audioFormats.length > 0) {
            const mp4Audio = audioFormats.filter(
              (f) =>
                f.mime_type?.includes('audio/mp4') ||
                f.mime_type?.includes('mp4a')
            );
            // Strictly prefer mp4/m4a first to avoid WebM / Opus playback issues on Android
            const candidates = mp4Audio.length > 0 ? mp4Audio : audioFormats;
            candidates.sort(
              (a, b) => (b.bitrate || 0) - (a.bitrate || 0)
            );

            for (const fmt of candidates.slice(0, 3)) {
              let candidateUrl: string | undefined = fmt.url;

              // If url is not set directly, try decipher if available
              if (!candidateUrl && typeof fmt.decipher === 'function') {
                try {
                  candidateUrl = await fmt.decipher(innertube.session.player);
                } catch {
                  // decipher error, continue to next format
                }
              }

              if (candidateUrl) {
                if (shouldVerify) {
                  const isPlayable = await verifyStreamUrl(candidateUrl, 3500, youtubeHeaders);
                  if (!isPlayable) continue;
                }
                return { url: candidateUrl, headers: youtubeHeaders };
              }
            }
          }

          // Progressive MP4 fallback (e.g. itag: 18 - 360p progressive MP4 containing AAC audio)
          // Progressive MP4s are multiplexed linearly with standard moov/mdat atoms,
          // ensuring ExoPlayer can decode and play them without DASH fragmentation errors.
          const progressiveFormats: any[] = info.streaming_data?.formats || [];
          const mp4Progressive = progressiveFormats.filter(
            (f) =>
              f.has_audio &&
              (f.mime_type?.includes('mp4') || f.mime_type?.includes('mp4a'))
          );
          mp4Progressive.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));

          for (const fmt of mp4Progressive.slice(0, 2)) {
            let candidateUrl: string | undefined = fmt.url;
            if (!candidateUrl && typeof fmt.decipher === 'function') {
              try {
                candidateUrl = await fmt.decipher(innertube.session.player);
              } catch {
                // decipher error, continue
              }
            }

            if (candidateUrl) {
              if (shouldVerify) {
                const isPlayable = await verifyStreamUrl(candidateUrl, 3500, youtubeHeaders);
                if (!isPlayable) continue;
              }
              return { url: candidateUrl, headers: youtubeHeaders };
            }
          }
        } catch (clientErr) {
          console.warn(`Innertube ${clientName} client basicInfo failed:`, clientErr);
        }
      }
    } catch (innertubeErr) {
      console.warn('Innertube resolution error:', innertubeErr);
    }

    // -------------------------------------------------------------
    // Tier 2: Invidious API with Local Proxy (&local=true)
    // -------------------------------------------------------------
    for (const rawInst of INVIDIOUS_INSTANCES) {
      const instance = rawInst.replace(/\/+$/, '');
      try {
        const vidUrl = `${instance}/api/v1/videos/${encodeURIComponent(track.id)}`;
        const response = await fetchWithTimeout(vidUrl, 4000, {
          headers: {
            Accept: 'application/json',
            'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const formats = Array.isArray(data?.adaptiveFormats) ? data.adaptiveFormats : [];

          const audioFormats = formats.filter(
            (f: any) => f.type?.includes('audio') || f.mimeType?.includes('audio')
          );

          if (audioFormats.length > 0) {
            // Strictly prefer audio/mp4 first
            const mp4Audio = audioFormats.filter(
              (f: any) =>
                f.type?.includes('audio/mp4') ||
                f.type?.includes('mp4a') ||
                f.mimeType?.includes('audio/mp4')
            );
            const candidates = mp4Audio.length > 0 ? mp4Audio : audioFormats;
            candidates.sort(
              (a: any, b: any) => (parseInt(b.bitrate, 10) || 0) - (parseInt(a.bitrate, 10) || 0)
            );

            for (const bestFormat of candidates.slice(0, 3)) {
              if (bestFormat.itag) {
                const proxyUrl = `${instance}/latest_version?id=${encodeURIComponent(
                  track.id
                )}&itag=${bestFormat.itag}&local=true`;

                const isPlayable = await verifyStreamUrl(proxyUrl, 3500, youtubeHeaders);
                if (isPlayable) {
                  return { url: proxyUrl, headers: youtubeHeaders };
                }
              }

              if (bestFormat.url && !bestFormat.url.includes('googlevideo.com')) {
                const isPlayable = await verifyStreamUrl(bestFormat.url, 3500, youtubeHeaders);
                if (isPlayable) {
                  return { url: bestFormat.url, headers: youtubeHeaders };
                }
              }
            }
          }

          // Fallback to Invidious progressive formatStreams (e.g. itag 18 - 360p progressive MP4)
          const formatStreams = Array.isArray(data?.formatStreams) ? data.formatStreams : [];
          const mp4FormatStreams = formatStreams.filter(
            (f: any) =>
              f.container === 'mp4' ||
              f.type?.includes('mp4') ||
              f.mimeType?.includes('mp4')
          );
          for (const progFormat of mp4FormatStreams.slice(0, 2)) {
            if (progFormat.itag) {
              const proxyUrl = `${instance}/latest_version?id=${encodeURIComponent(
                track.id
              )}&itag=${progFormat.itag}&local=true`;
              const isPlayable = await verifyStreamUrl(proxyUrl, 3500, youtubeHeaders);
              if (isPlayable) {
                return { url: proxyUrl, headers: youtubeHeaders };
              }
            }
            if (progFormat.url && !progFormat.url.includes('googlevideo.com')) {
              const isPlayable = await verifyStreamUrl(progFormat.url, 3500, youtubeHeaders);
              if (isPlayable) {
                return { url: progFormat.url, headers: youtubeHeaders };
              }
            }
          }
        }
      } catch (err) {
        console.warn(`Invidious instance [${instance}] failed:`, err);
      }
    }

    // -------------------------------------------------------------
    // Tier 3: Piped Proxy Stream Fallback
    // -------------------------------------------------------------
    for (const rawInst of PIPED_INSTANCES) {
      const instance = rawInst.replace(/\/+$/, '');
      try {
        const streamUrl = `${instance}/streams/${encodeURIComponent(track.id)}`;
        const response = await fetchWithTimeout(streamUrl, 4500, {
          headers: { Accept: 'application/json' },
        });

        if (response.ok) {
          const data = await response.json();
          const streams = Array.isArray(data?.audioStreams) ? data.audioStreams : [];

          if (streams.length > 0) {
            // Strictly prefer audio/mp4 / m4a for Android expo-audio compatibility
            const mp4Streams = streams.filter(
              (s: any) =>
                s.url &&
                (s.mimeType?.includes('audio/mp4') ||
                  s.format?.toLowerCase() === 'm4a' ||
                  s.codec?.toLowerCase().includes('mp4a'))
            );

            const pool = mp4Streams.length > 0 ? mp4Streams : streams.filter((s: any) => s.url);
            pool.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));

            for (const candidate of pool.slice(0, 3)) {
              let streamCandidateUrl: string = candidate.url;

              if (data.proxyUrl && streamCandidateUrl.includes('googlevideo.com')) {
                try {
                  const urlObj = new URL(streamCandidateUrl);
                  const proxyObj = new URL(data.proxyUrl);
                  urlObj.protocol = proxyObj.protocol;
                  urlObj.host = proxyObj.host;
                  streamCandidateUrl = urlObj.toString();
                } catch {
                  // Keep original if URL parse fails
                }
              }

              const isPlayable = await verifyStreamUrl(
                streamCandidateUrl,
                3500,
                youtubeHeaders
              );
              if (isPlayable) {
                return { url: streamCandidateUrl, headers: youtubeHeaders };
              }
            }
          }

          // Fallback to Piped progressive MP4 video streams (containing linear AAC audio)
          const videoStreams = Array.isArray(data?.videoStreams) ? data.videoStreams : [];
          const progressiveMp4 = videoStreams.filter(
            (s: any) =>
              s.url &&
              s.videoOnly === false &&
              (s.mimeType?.includes('mp4') || s.format?.toLowerCase() === 'mp4')
          );
          for (const candidate of progressiveMp4.slice(0, 2)) {
            let streamCandidateUrl: string = candidate.url;
            if (data.proxyUrl && streamCandidateUrl.includes('googlevideo.com')) {
              try {
                const urlObj = new URL(streamCandidateUrl);
                const proxyObj = new URL(data.proxyUrl);
                urlObj.protocol = proxyObj.protocol;
                urlObj.host = proxyObj.host;
                streamCandidateUrl = urlObj.toString();
              } catch {
                // Keep original
              }
            }
            const isPlayable = await verifyStreamUrl(streamCandidateUrl, 3500, youtubeHeaders);
            if (isPlayable) {
              return { url: streamCandidateUrl, headers: youtubeHeaders };
            }
          }
        }
      } catch (err) {
        console.warn(`Piped stream instance [${instance}] failed:`, err);
      }
    }

    // -------------------------------------------------------------
    // Tier 4: Audius Title+Artist Match Fallback
    // -------------------------------------------------------------
    const fallbackStream = await resolveAudiusFallbackStream(track.title, track.artist);
    if (fallbackStream) {
      return { url: fallbackStream };
    }

    // Tier 5: Direct track downloadUrl if provided
    if (track.downloadUrl) {
      const isValid = await verifyStreamUrl(track.downloadUrl, 3000);
      if (isValid) {
        return { url: track.downloadUrl };
      }
    }

    throw new Error(
      `Unable to resolve a playable audio stream for "${track.title}". Please try another track.`
    );
  } else {
    // Audius source
    if (track.downloadUrl) {
      const isValid = await verifyStreamUrl(track.downloadUrl, 3000);
      if (isValid) {
        return { url: track.downloadUrl };
      }
    }

    const defaultUrl = `https://discoveryprovider.audius.co/v1/tracks/${track.id}/stream?app_name=JStream`;
    return { url: defaultUrl };
  }
}

// Active downloads map for cancellation support
const activeDownloads = new Map<
  string,
  {
    resumable: FileSystem.DownloadResumable;
    fileUri: string;
  }
>();

/**
 * Cancels an in-progress track download and cleans up any partial file on disk.
 */
export async function cancelTrackDownload(trackId: string): Promise<boolean> {
  const active = activeDownloads.get(trackId);
  if (!active) {
    return false;
  }
  activeDownloads.delete(trackId);
  try {
    await active.resumable.cancelAsync();
  } catch (err) {
    console.warn(`[DownloadService] Cancelled resumable download for track ${trackId}:`, err);
  }

  try {
    const fileInfo = await FileSystem.getInfoAsync(active.fileUri);
    if (fileInfo.exists) {
      await FileSystem.deleteAsync(active.fileUri, { idempotent: true });
    }
  } catch (cleanupErr) {
    console.warn(`[DownloadService] Error cleaning up partial file ${active.fileUri}:`, cleanupErr);
  }

  return true;
}

/**
 * Checks whether a track download is currently active.
 */
export function isTrackDownloading(trackId: string): boolean {
  return activeDownloads.has(trackId);
}

/**
 * Download an online track into the local offline library:
 * 1. Resolves direct verified stream URL and headers.
 * 2. Downloads audio file with required headers to FileSystem.documentDirectory + 'jstream_tracks/'.
 * 3. Inspects file size (> 10 KB) to ensure YouTube did not return a tiny 403 or error response.
 * 4. Records track entry into SQLite database and refreshes playerStore.
 */
export async function downloadTrackToOfflineLibrary(
  track: OnlineTrackResult,
  onProgress?: (pct: number) => void,
  options?: { isPlaylistOnly?: boolean; targetTrackId?: string }
): Promise<Track> {
  const docDir = FileSystem.documentDirectory;
  if (!docDir) {
    throw new Error('Device storage documentDirectory is unavailable.');
  }

  const tracksDir = docDir.endsWith('/') ? `${docDir}jstream_tracks/` : `${docDir}/jstream_tracks/`;

  const dirInfo = await FileSystem.getInfoAsync(tracksDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(tracksDir, { intermediates: true });
  }

  // Sanitize filename
  const cleanTitle = (track.title || 'track')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'track';
  const cleanArtist = (track.artist || 'artist')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 30) || 'artist';
  const baseFileName = `${track.source}_${track.id}_${cleanArtist}_${cleanTitle}`;

  // Reuse an already-downloaded file before touching the network (supports offline retry/multi-user sharing)
  let finalAudioUri: string | null = null;
  for (const candidateExt of ['.m4a', '.mp3']) {
    const candidateUri = `${tracksDir}${baseFileName}${candidateExt}`;
    const existingFileInfo = await FileSystem.getInfoAsync(candidateUri);
    if (existingFileInfo.exists && (existingFileInfo.size ?? 0) > 10000) {
      finalAudioUri = normalizeLocalFileUri(candidateUri) || candidateUri;
      onProgress?.(100);
      break;
    }
  }

  if (!finalAudioUri) {
    let streamResult: ResolvedStreamResult;
    let ext = '.m4a';

    try {
      streamResult = await resolveOnlineStreamUrl(track, { verify: true });
      if (streamResult.url.includes('.mp3') || streamResult.url.includes('audius.co')) {
        ext = '.mp3';
      }
    } catch (err: any) {
      throw new Error(err?.message || `Failed to resolve download stream for "${track.title}".`);
    }

    const { url: streamUrl, headers } = streamResult;
    const fileUri = `${tracksDir}${baseFileName}${ext}`;

    // Notify initial progress
    onProgress?.(0);

    const downloadHeaders: Record<string, string> = headers || {
      'User-Agent': YOUTUBE_MOBILE_USER_AGENT,
    };

    const downloadResumable = FileSystem.createDownloadResumable(
      streamUrl,
      fileUri,
      {
        headers: downloadHeaders,
      },
      (downloadProgress) => {
        const totalBytes = downloadProgress.totalBytesExpectedToWrite;
        const writtenBytes = downloadProgress.totalBytesWritten;
        if (totalBytes > 0) {
          const pct = Math.min(100, Math.max(0, Math.round((writtenBytes / totalBytes) * 100)));
          onProgress?.(pct);
        }
      }
    );

    activeDownloads.set(track.id, { resumable: downloadResumable, fileUri });

    try {
      const downloadResult = await downloadResumable.downloadAsync();
      if (!downloadResult || !downloadResult.uri) {
        throw new Error('Audio download failed. No local URI returned.');
      }
      if (
        typeof downloadResult.status === 'number' &&
        (downloadResult.status < 200 || downloadResult.status >= 300)
      ) {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch {
          // ignore
        }
        throw new Error(
          `Audio download failed with HTTP status ${downloadResult.status}. Please try another track.`
        );
      }

      // Verify downloaded audio file existence and size (> 10 KB = 10000 bytes)
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists || (fileInfo.size !== undefined && fileInfo.size <= 10000)) {
        try {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        } catch {
          // ignore
        }
        throw new Error(
          `Audio download failed: received invalid stream or 403 response (${fileInfo.exists ? fileInfo.size : 0} bytes). Please try another track.`
        );
      }
      finalAudioUri = normalizeLocalFileUri(downloadResult.uri) || downloadResult.uri;
    } catch (err: any) {
      // If cancelled or failed, ensure partial file is wiped
      try {
        const info = await FileSystem.getInfoAsync(fileUri);
        if (info.exists) {
          await FileSystem.deleteAsync(fileUri, { idempotent: true });
        }
      } catch {
        // ignore
      }
      throw err;
    } finally {
      activeDownloads.delete(track.id);
    }

    onProgress?.(100);
  }

  // Optional: save thumbnail locally for offline display (bounded so slow artwork never stalls SQLite save)
  let localArtworkUri: string | null = track.thumbnailUrl;
  if (track.thumbnailUrl) {
    try {
      const artworkDir = `${tracksDir}artwork/`;
      const artDirInfo = await FileSystem.getInfoAsync(artworkDir);
      if (!artDirInfo.exists) {
        await FileSystem.makeDirectoryAsync(artworkDir, { intermediates: true });
      }

      const artExt = track.thumbnailUrl.includes('.png') ? '.png' : '.jpg';
      const artFileUri = `${artworkDir}art_${track.source}_${track.id}${artExt}`;
      const artResult = await withTimeout(
        FileSystem.downloadAsync(track.thumbnailUrl, artFileUri),
        5000,
        'Artwork download'
      );
      if (
        artResult?.uri &&
        (!artResult.status || (artResult.status >= 200 && artResult.status < 300))
      ) {
        localArtworkUri = normalizeLocalFileUri(artResult.uri) || artResult.uri;
      }
    } catch {
      // Non-fatal, use remote URL or null
      localArtworkUri = track.thumbnailUrl;
    }
  }

  const isPlaylistOnly = options?.isPlaylistOnly ? 1 : 0;
  const activeUserId = getActiveUserId();

  // Insert into SQLite database
  const newTrack: Track = {
    id: options?.targetTrackId || `online_${track.source}_${track.id}`,
    user_id: activeUserId,
    youtube_id: track.source === 'youtube' ? track.id : null,
    title: track.title,
    artist: track.artist,
    local_audio_uri: finalAudioUri,
    local_artwork_uri: localArtworkUri,
    duration: track.duration || 0,
    source: 'youtube', // valid according to SQLite CHECK(source IN ('local', 'youtube'))
    is_synced: 0,
    created_at: new Date().toISOString(),
    is_playlist_only: isPlaylistOnly,
  };

  await saveTrack(newTrack, activeUserId);

  // Refresh playerStore ONLY if this is a personal library track (not playlist-isolated)
  if (!isPlaylistOnly) {
    const allTracks = await getAllTracks(activeUserId);
    usePlayerStore.getState().setTracks(allTracks);
  }

  return newTrack;
}
