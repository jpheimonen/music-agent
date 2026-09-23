import type { MediaItem } from '@music/contracts';

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
export function youtubeItem(id: string, title = `YouTube video ${id}`, channel?: string): MediaItem {
  return { id: `youtube:${id}`, source: 'youtube', title, artist: null, availability: 'available', attribution: channel ? `YouTube · ${channel}` : 'YouTube' };
}
export class YoutubeProviderError extends Error {
  constructor(public code: string, public status: number, public retryable: boolean) { super(code); }
}
export class YoutubeService {
  constructor(private key?: string, private request: typeof fetch = fetch, private timeoutMs = 15_000) {}
  async search(q: string, maxResults = 10, signal?: AbortSignal) {
    if (!this.key) throw new YoutubeProviderError('setup_required', 503, false);
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', maxResults: String(maxResults), q, key: this.key }).toString();
    let response: Response;
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try { response = await this.request(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
    catch { throw new YoutubeProviderError(timeout.aborted ? 'deadline_exceeded' : 'provider_unavailable', 503, true); }
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) throw new YoutubeProviderError(response.status === 429 ? 'provider_quota_exceeded' : 'provider_auth_or_quota_failed', 503, false);
      throw new YoutubeProviderError(response.status === 400 || response.status === 401 ? 'provider_auth_failed' : 'provider_unavailable', 503, response.status >= 500);
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new YoutubeProviderError('provider_invalid_response', 502, true); }
    if (!payload || typeof payload !== 'object' || !Array.isArray((payload as {items?: unknown}).items)) throw new YoutubeProviderError('provider_invalid_response', 502, true);
    const data = payload as { items: unknown[]; nextPageToken?: unknown };
    const items: MediaItem[] = [];
    for (const raw of data.items) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as { id?: { videoId?: unknown }; snippet?: { title?: unknown; channelTitle?: unknown } };
      if (typeof item.id?.videoId !== 'string' || !videoId.test(item.id.videoId) || typeof item.snippet?.title !== 'string') continue;
      items.push(youtubeItem(item.id.videoId, item.snippet.title, typeof item.snippet.channelTitle === 'string' ? item.snippet.channelTitle : undefined));
    }
    return { items, nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null };
  }
}
