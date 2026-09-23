import type { MediaItem } from '@music/contracts';
import { canonicalVideoUrl } from './search-evidence.mjs';

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
export type SearchCandidate = { videoId:string; canonicalWatchUrl:string; searchResultUrl:string; searchEventId:string; eventQuery:string|null; resultTitle:string|null; whyRelevant:string };
export type VerifiedCandidate = { media:MediaItem; evidence:{schemaVersion:1;method:'codex_web_search';runtimeVersion:'0.156.1';searchEventId:string;eventQuery:string|null;requestedQuery?:string;searchResultUrl:string;canonicalWatchUrl:string;verifiedTitle:string;verifiedAt:string;verificationMethod:'youtube_oembed'}; whyRelevant:string };
async function boundedJson(response: Response) {
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json(?:;|$)/i.test(type)) throw new YoutubeProviderError('provider_invalid_response',502,false);
  const reader = response.body?.getReader();
  if (!reader) throw new YoutubeProviderError('provider_invalid_response',502,false);
  const chunks: Uint8Array[] = []; let total=0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > 64 * 1024) throw new YoutubeProviderError('provider_invalid_response',502,false);
      chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))); } catch { throw new YoutubeProviderError('provider_invalid_response',502,false); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new YoutubeProviderError('provider_invalid_response',502,false);
  return value as Record<string,unknown>;
}
export class YoutubeService {
  private sessionCache = new Map<string, Map<string, MediaItem>>();
  private discoveryFailure: string | null = null;
  get failure() { return this.discoveryFailure; }
  constructor(private request: typeof fetch = fetch) {}
  async verify(candidate: SearchCandidate, sessionKey: string, signal?: AbortSignal, requestedQuery?: string): Promise<VerifiedCandidate | null> {
    const parsed = canonicalVideoUrl(candidate.canonicalWatchUrl);
    if (!parsed || parsed.videoId !== candidate.videoId || canonicalVideoUrl(candidate.searchResultUrl)?.videoId !== candidate.videoId) throw new YoutubeProviderError('invalid_candidate',400,false);
    const session = this.sessionCache.get(sessionKey) ?? new Map<string,MediaItem>();
    this.sessionCache.set(sessionKey,session);
    let media = session.get(candidate.videoId);
    if (!media) {
      const url = new URL('https://www.youtube.com/oembed');
      url.search = new URLSearchParams({ url:parsed.canonicalWatchUrl, format:'json' }).toString();
      const timeout = AbortSignal.timeout(10_000);
      let response: Response;
      try { response = await this.request(url,{redirect:'error',signal:signal ? AbortSignal.any([signal,timeout]) : timeout}); }
      catch {
        if (signal?.aborted) throw new YoutubeProviderError('cancelled',499,false);
        throw new YoutubeProviderError(timeout.aborted ? 'deadline_exceeded' : 'provider_unavailable',503,true);
      }
      if (response.status === 404 || response.status === 400) return null;
      if (response.status === 429) throw new YoutubeProviderError('provider_quota_exceeded',503,true);
      if (!response.ok) throw new YoutubeProviderError('provider_unavailable',503,response.status >= 500);
      const payload = await boundedJson(response);
      if (payload.provider_name !== 'YouTube' || typeof payload.title !== 'string' || !payload.title.trim() || payload.title.length > 500) return null;
      const author = typeof payload.author_name === 'string' && payload.author_name.length <= 200 ? payload.author_name : undefined;
      media = youtubeItem(candidate.videoId,payload.title.trim(),author);
      session.set(candidate.videoId,media);
      // Session metadata is short-lived and does not persist provider HTML.
      if (this.sessionCache.size > 100) this.sessionCache.delete(this.sessionCache.keys().next().value!);
    }
    return {media, whyRelevant:candidate.whyRelevant, evidence:{schemaVersion:1,method:'codex_web_search',runtimeVersion:'0.156.1',searchEventId:candidate.searchEventId,eventQuery:candidate.eventQuery,...(requestedQuery ? {requestedQuery} : {}),searchResultUrl:candidate.searchResultUrl,canonicalWatchUrl:parsed.canonicalWatchUrl,verifiedTitle:media.title,verifiedAt:new Date().toISOString(),verificationMethod:'youtube_oembed'}};
  }
  async verifyBatch(candidates: SearchCandidate[], sessionKey: string, signal?: AbortSignal, requestedQuery?: string) {
    const results: VerifiedCandidate[] = []; const failures: YoutubeProviderError[] = [];
    let cursor=0;
    const worker = async () => {
      for (;;) {
        const index=cursor++;
        if (index >= candidates.length) return;
        if (signal?.aborted) throw new YoutubeProviderError('cancelled',499,false);
        try { const result=await this.verify(candidates[index],sessionKey,signal,requestedQuery); if (result) results.push(result); }
        catch (error) { if (error instanceof YoutubeProviderError && error.code !== 'cancelled') failures.push(error); else throw error; }
      }
    };
    await Promise.all([worker(),worker()]);
    if (!results.length && failures.length) { this.discoveryFailure = failures[0].code; throw failures[0]; }
    this.discoveryFailure = null;
    return results;
  }
}
