export const SEARCH_RUNTIME_VERSION = '0.156.1';
export const SEARCH_SCHEMA = 'codex-search-results-v1';
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function canonicalVideoUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  let videoId = null;
  if (url.hostname === 'youtube.com' || url.hostname === 'www.youtube.com') {
    if (url.pathname !== '/watch') return null;
    const ids = url.searchParams.getAll('v');
    if (ids.length !== 1) return null;
    videoId = ids[0];
  } else if (url.hostname === 'youtu.be') {
    if (!/^\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) return null;
    videoId = url.pathname.slice(1);
  } else return null;
  if (!videoIdPattern.test(videoId)) return null;
  return { videoId, canonicalWatchUrl: `https://www.youtube.com/watch?v=${videoId}` };
}

export class SearchEvidenceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export class SearchEvidenceCollector {
  constructor(runtimeVersion) {
    if (runtimeVersion !== SEARCH_RUNTIME_VERSION) throw new SearchEvidenceError('unsupported_search_runtime');
    this.events = new Set(); this.members = new Map(); this.completed = 0; this.bytes = 0;
  }
  add(event) {
    this.bytes += Buffer.byteLength(JSON.stringify(event));
    if (this.bytes > 1024 * 1024) throw new SearchEvidenceError('search_provenance_unavailable');
    if (!event || event.type !== 'item.completed' || !event.item || event.item.type !== 'web_search') return;
    const item = event.item;
    if (typeof item.id !== 'string' || !item.id || item.id.length > 200) throw new SearchEvidenceError('search_provenance_unavailable');
    if (this.events.has(item.id)) return;
    this.events.add(item.id);
    this.completed++;
    if (this.completed > 6) throw new SearchEvidenceError('search_limit_exceeded');
    if (!Array.isArray(item.results) || item.results.length > 200) throw new SearchEvidenceError('search_provenance_unavailable');
    const eventQuery = typeof item.query === 'string' && item.query.trim() ? item.query.slice(0,200) : null;
    for (const result of item.results) {
      if (!result || typeof result !== 'object' || typeof result.url !== 'string') continue;
      const parsed = canonicalVideoUrl(result.url);
      if (!parsed || this.members.has(parsed.videoId)) continue;
      this.members.set(parsed.videoId, {
        videoId:parsed.videoId, canonicalWatchUrl:parsed.canonicalWatchUrl,
        searchResultUrl:result.url,
        resultTitle:typeof result.title === 'string' ? result.title.slice(0,300) : null,
        searchEventId:item.id, eventQuery,
      });
    }
  }
  candidates(final) {
    if (this.completed === 0) throw new SearchEvidenceError('search_provenance_unavailable');
    if (!final || !Array.isArray(final.candidates) || final.candidates.length > 10) throw new SearchEvidenceError('invalid_agent_output');
    const found=[]; const seen=new Set();
    for (const candidate of final.candidates) {
      if (!candidate || typeof candidate !== 'object' || typeof candidate.videoId !== 'string' || typeof candidate.watchUrl !== 'string') continue;
      const parsed=canonicalVideoUrl(candidate.watchUrl);
      if (!parsed || parsed.videoId !== candidate.videoId || seen.has(parsed.videoId)) continue;
      const evidence=this.members.get(parsed.videoId);
      if (!evidence) continue;
      seen.add(parsed.videoId);
      found.push({ videoId:parsed.videoId, whyRelevant:typeof candidate.why_relevant === 'string' ? candidate.why_relevant.slice(0,300) : '', ...evidence });
    }
    return found;
  }
}
