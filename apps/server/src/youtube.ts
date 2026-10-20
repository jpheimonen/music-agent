import { artistNameKey, normalizeText, type MediaItem } from '@music/contracts';
import { YoutubeProviderError, type AudioStream, type SearchEntry, type YtDlp } from './ytdlp.js';

export { YoutubeProviderError };

const videoId = /^[A-Za-z0-9_-]{11}$/;
export function parseVideoId(input: string): string {
  const value = input.trim();
  if (videoId.test(value)) return value;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('invalid_youtube_url'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid_youtube_url');
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(embed|shorts|live)\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) id = url.pathname.split('/')[2];
  }
  if (!id || !videoId.test(id)) throw new Error('invalid_youtube_url');
  return id;
}

export { normalizeText };

export function youtubeItem(id: string, title = `YouTube video ${id}`, channel?: string, extra: { artist?: string; durationSeconds?: number | null } = {}): MediaItem {
  return {
    id: `youtube:${id}`, source: 'youtube', title,
    artist: extra.artist ? { id: artistNameKey(extra.artist), displayName: extra.artist, confidence: 'medium', provenance: 'dj_pick' } : null,
    availability: 'available',
    attribution: channel ? `YouTube · ${channel}` : 'YouTube',
    // The 16:9 thumbnail has no letterbox bars, so a square crop shows the cover art.
    artwork: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    ...(extra.durationSeconds ? { durationSeconds: extra.durationSeconds } : {}),
  };
}

// Words that mark a different version from the recording the DJ named.
const variantWords = ['live', 'cover', 'karaoke', 'instrumental', 'remix', 'reaction', 'lesson', 'tutorial', 'slowed', 'sped', 'nightcore', '8d', 'playthrough', 'rehearsal', 'acoustic', 'concert', 'loop', 'hour', 'hours', 'teaser', 'trailer', 'interview', 'review', 'mashup', 'parody', 'drumless'];
const wholeRelease = /\b(full album|full length|full ep|album stream|complete album|discography|full show|full concert|full set)\b/;

// Scores how well a search result matches the DJ's pick. null means it is not that song.
export function scoreCandidate(pick: { artist: string; title: string }, candidate: { title: string; channel: string | null; durationSeconds: number | null; viewCount: number | null }) {
  const title = ` ${normalizeText(candidate.title)} `;
  const topic = /\s-\stopic$/i.test(candidate.channel ?? '');
  const channel = normalizeText((candidate.channel ?? '').replace(/\s-\stopic$/i, ''));
  const wantedTitle = normalizeText(pick.title);
  const wantedArtist = normalizeText(pick.artist);
  if (!wantedTitle || !wantedArtist) return null;
  const share = (words: string[], text: string) => words.filter(word => text.includes(` ${word} `)).length / words.length;
  const titleWords = wantedTitle.split(' ');
  const titleMatch = title.includes(` ${wantedTitle} `) ? 1 : share(titleWords, title);
  if (titleMatch < 0.75) return null;
  const artistWords = wantedArtist.split(' ');
  const compactArtist = wantedArtist.replace(/\b(the|of|and)\b/g, '').replace(/\s+/g, '');
  const artistInChannel = ` ${channel} `.includes(` ${wantedArtist} `) || share(artistWords, ` ${channel} `) >= 0.67 || (compactArtist.length >= 4 && channel.replace(/\s+/g, '').includes(compactArtist));
  const artistInTitle = title.includes(` ${wantedArtist} `) || share(artistWords, title) >= 0.67;
  if (!artistInChannel && !artistInTitle) return null;

  let score = 100 * titleMatch;
  if (artistInChannel) score += topic ? 40 : 25;
  if (/\bofficial audio\b/.test(title)) score += 10;
  const named = ` ${wantedTitle} `;
  for (const word of variantWords) if (title.includes(` ${word} `) && !named.includes(` ${word} `)) score -= 60;
  if (wholeRelease.test(title) && !wholeRelease.test(named)) score -= 80;
  if (/\blyrics?\b/.test(title)) score -= 5;
  const duration = candidate.durationSeconds;
  if (duration !== null && duration < 60) score -= 50;
  if (duration !== null && duration > 1500) score -= 60;
  else if (duration !== null && duration > 900) score -= 15;
  return score + Math.min(12, Math.log10((candidate.viewCount ?? 0) + 1) * 2);
}

// Removes an "Artist - " prefix and "(Official Video)"-style suffixes, since the artist is shown separately.
export function displayTitle(title: string, artist: string) {
  let value = title.trim();
  const separator = /^(.+?)\s+[-–—:]\s+(.+)$/.exec(value);
  if (separator && normalizeText(separator[1]) === normalizeText(artist)) value = separator[2];
  for (;;) {
    const trimmed = value.replace(/\s*[([](official\s+)?(music\s+|lyric\s+)?(video|audio|visuali[sz]er|lyrics?|hd|hq|4k)[)\]]\s*$/i, '').trim();
    if (trimmed === value || !trimmed) break;
    value = trimmed;
  }
  return value;
}

const cancelled = () => new YoutubeProviderError('cancelled', 499, false);
function withSignal<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
// Failures that rule out one video but say nothing about the others.
const videoFailure = (error: unknown) => error instanceof YoutubeProviderError && /^(youtube_video_unavailable|youtube_no_audio_format|youtube_stream_unavailable|deadline_exceeded)$/.test(error.code);

export class YoutubeService {
  private streams = new Map<string, AudioStream>();
  private extracting = new Map<string, Promise<AudioStream>>();
  constructor(private ytdlp: YtDlp, private request: typeof fetch = fetch, private now: () => number = Date.now) {}

  async search(query: string, signal?: AbortSignal): Promise<MediaItem[]> {
    const entries = await this.ytdlp.search(query, 10, signal);
    return entries.filter(entry => entry.liveStatus !== 'is_live' && entry.liveStatus !== 'is_upcoming').map(entry => youtubeItem(entry.id, entry.title, entry.channel ?? undefined, { durationSeconds: entry.durationSeconds }));
  }

  // Finds the DJ's pick on YouTube and returns it only if its audio can be streamed.
  // null means no search result is that song in a playable form.
  async findTrack(pick: { artist: string; title: string }, skip: (mediaId: string) => boolean, signal?: AbortSignal): Promise<MediaItem | null> {
    const entries = await this.ytdlp.search(`${pick.artist} - ${pick.title}`, 8, signal);
    const ranked = entries
      .filter(entry => !skip(`youtube:${entry.id}`) && entry.liveStatus !== 'is_live' && entry.liveStatus !== 'is_upcoming')
      .map(entry => ({ entry, score: scoreCandidate(pick, entry) }))
      .filter((match): match is { entry: SearchEntry; score: number } => match.score !== null && match.score >= 60)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    for (const { entry } of ranked) {
      try {
        const { response } = await this.open(entry.id, 'bytes=0-1', signal);
        await response.body?.cancel().catch(() => {});
        if (response.ok) return youtubeItem(entry.id, displayTitle(entry.title, pick.artist), entry.channel ?? undefined, { artist: pick.artist, durationSeconds: entry.durationSeconds });
      } catch (error) { if (!videoFailure(error)) throw error; }
    }
    return null;
  }

  // Stream URLs are cached until shortly before YouTube expires them. One extraction serves concurrent callers.
  private stream(id: string, refresh: boolean) {
    const cached = this.streams.get(id);
    if (cached && !refresh && cached.expiresAt > this.now()) return Promise.resolve(cached);
    if (refresh) this.streams.delete(id);
    let pending = this.extracting.get(id);
    if (!pending) {
      pending = this.ytdlp.audioStream(id).then(stream => {
        this.streams.set(id, stream);
        if (this.streams.size > 300) this.streams.delete(this.streams.keys().next().value!);
        return stream;
      }).finally(() => this.extracting.delete(id));
      this.extracting.set(id, pending);
    }
    return pending;
  }

  // Opens the audio for a range request. A refused or expired URL is replaced with a fresh extraction.
  async open(id: string, range: string | undefined, signal?: AbortSignal) {
    if (!videoId.test(id)) throw new YoutubeProviderError('invalid_youtube_url', 400, false);
    for (let attempt = 0; attempt < 3; attempt++) {
      const stream = await withSignal(this.stream(id, attempt > 0), signal);
      let response: Response;
      try { response = await this.request(stream.url, { headers: { ...stream.headers, ...(range ? { Range: range } : {}) }, redirect: 'follow', signal }); }
      catch { if (signal?.aborted) throw cancelled(); continue; }
      if (!new URL(response.url || stream.url).hostname.endsWith('.googlevideo.com')) { await response.body?.cancel().catch(() => {}); throw new YoutubeProviderError('youtube_stream_unavailable', 502, true); }
      if (response.ok || response.status === 416) return { response, stream };
      await response.body?.cancel().catch(() => {});
    }
    throw new YoutubeProviderError('youtube_stream_unavailable', 502, true);
  }
}
