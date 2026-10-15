import { z } from 'zod';
import type { StationId, StationNowPlaying } from '@music/contracts';
import { stationStreams } from './stations.js';

const text = z.string().trim().min(1).max(300);
const stamp = z.string().datetime({ offset: true }).transform(value => Date.parse(value));
const seconds = z.number().finite().nonnegative().max(8_640_000_000_000).transform(value => value * 1000);
const refreshMs = 30_000;
const freshnessMs = 90_000;
class FeedError extends Error {}
class StaleFeed extends FeedError {}
type Report = { kind: 'track' | 'programme'; title: string; artist: string | null; start?: number; end?: number };
type Feed = { url: string; sourceUrl: string; html?: boolean };
// Stations that name what's on inside the audio stream itself (ICY metadata):
// some name tracks as "Artist - Title", others name the show.
type IcyFeed = { icy: 'track' | 'programme'; sourceUrl: string; clean?: (title: string) => string };
const icyFeeds: Partial<Record<StationId, IcyFeed>> = {
  dublab: { icy: 'programme', sourceUrl: 'https://www.dublab.com/' },
  'refuge-worldwide': { icy: 'programme', sourceUrl: 'https://refugeworldwide.com/' },
  'radio-80000': { icy: 'programme', sourceUrl: 'https://www.radio80k.de/', clean: title => title.replace(/^radio80k\s*-\s*/i, '') },
  'noods-radio': { icy: 'programme', sourceUrl: 'https://www.noodsradio.com/' },
  'resonance-fm': { icy: 'programme', sourceUrl: 'https://www.resonancefm.com/', clean: title => title.replace(/\s*-\s*Resonance 104\.4\s*FM$/i, '') },
  'radio-meuh': { icy: 'track', sourceUrl: 'https://www.radiomeuh.com/' },
  'intergalactic-fm': { icy: 'track', sourceUrl: 'https://www.intergalactic.fm/', clean: title => title.split(' | ')[0] },
  'radio-swiss-jazz': { icy: 'track', sourceUrl: 'https://www.radioswissjazz.ch/' },
};

function feedFor(id: StationId): Feed | null {
  switch (id) {
    case 'radio-helsinki': return { url: 'https://www.radiohelsinki.fi/', sourceUrl: 'https://www.radiohelsinki.fi/', html: true };
    case 'kexp': return { url: 'https://api.kexp.org/v2/plays/?limit=1', sourceUrl: 'https://www.kexp.org/playlist/' };
    case 'fip': return { url: 'https://api.radiofrance.fr/livemeta/pull/7', sourceUrl: 'https://www.radiofrance.fr/fip' };
    case 'nts-1': case 'nts-2': return { url: 'https://www.nts.live/api/v2/live', sourceUrl: `https://www.nts.live/${id === 'nts-1' ? '1' : '2'}` };
    case 'radio-paradise': return { url: 'https://api.radioparadise.com/api/now_playing?chan=0', sourceUrl: 'https://radioparadise.com/' };
    default: return null;
  }
}

function decodeEntities(value: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (whole, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? whole;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  }).trim();
}

function helsinkiText(html: string, className: string): string | null {
  // These are the station's server-rendered current-song/current-program fields.
  const match = html.match(new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, 'i'));
  if (!match) return null;
  const value = decodeEntities(match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
  return value ? text.parse(value) : null;
}

function parseReport(id: StationId, body: string, now: number): Report | null {
  if (id === 'radio-helsinki') {
    const title = helsinkiText(body, 'current-song-title');
    if (title) return { kind: 'track', title, artist: helsinkiText(body, 'current-song-artist') };
    const programme = helsinkiText(body, 'current-program-title');
    return programme ? { kind: 'programme', title: programme, artist: null } : null;
  }
  const payload: unknown = JSON.parse(body);
  if (id === 'kexp') {
    const { results } = z.object({ results: z.array(z.object({ play_type: z.string(), song: text.nullable().optional(), artist: text.nullable().optional(), airdate: stamp })).max(10) }).parse(payload);
    const latest = results[0];
    if (!latest || latest.play_type !== 'trackplay' || !latest.song) return null;
    // KEXP logs starts, not ends. Do not keep yesterday's last song on air.
    return { kind: 'track', title: latest.song, artist: latest.artist ?? null, start: latest.airdate, end: latest.airdate + 15 * 60_000 };
  }
  if (id === 'nts-1' || id === 'nts-2') {
    const { results } = z.object({ results: z.array(z.object({ channel_name: z.string(), now: z.object({ broadcast_title: text, start_timestamp: stamp, end_timestamp: stamp }).nullable() })).max(10) }).parse(payload);
    const current = results.find(channel => channel.channel_name === (id === 'nts-1' ? '1' : '2'))?.now;
    return current ? { kind: 'programme', title: text.parse(decodeEntities(current.broadcast_title)), artist: null, start: current.start_timestamp, end: current.end_timestamp } : null;
  }
  if (id === 'fip') {
    const { steps } = z.object({ steps: z.record(z.string(), z.object({ embedType: z.string().optional(), title: text, authors: z.string().max(300).optional(), start: seconds, end: seconds })) }).parse(payload);
    const songs = Object.values(steps).filter(step => step.embedType === 'song');
    const current = songs.filter(step => step.start <= now && step.end > now).sort((a, b) => b.start - a.start)[0];
    if (!current && songs.length) throw new StaleFeed();
    return current ? { kind: 'track', title: current.title, artist: current.authors?.trim() || null, start: current.start, end: current.end } : null;
  }
  if (id === 'radio-paradise') {
    const current = z.object({ title: text, artist: text, time: z.number().finite().positive().max(3600) }).parse(payload);
    return { kind: 'track', title: current.title, artist: current.artist, end: now + current.time * 1000 };
  }
  return null;
}

// Reads the stream only as far as its first metadata block and returns StreamTitle.
async function readIcyTitle(response: Response): Promise<string> {
  const interval = Number(response.headers.get('icy-metaint'));
  if (!Number.isInteger(interval) || interval < 1 || interval > 256 * 1024) throw new FeedError('no stream metadata');
  const reader = response.body?.getReader();
  if (!reader) throw new FeedError('missing body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      if (total > interval) {
        const bytes = Buffer.concat(chunks);
        const end = interval + 1 + bytes[interval] * 16;
        if (total >= end) {
          const block = bytes.subarray(interval + 1, end);
          let metadata = new TextDecoder('utf-8').decode(block);
          // Older servers send Latin-1.
          if (metadata.includes('\uFFFD')) metadata = new TextDecoder('latin1').decode(block);
          return /StreamTitle='(.*?)';/s.exec(metadata)?.[1] ?? '';
        }
      }
      const chunk = await reader.read();
      if (chunk.done) throw new FeedError('stream ended');
      total += chunk.value.byteLength;
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function icyReport(feed: IcyFeed, raw: string): Report | null {
  const value = (feed.clean ? feed.clean(raw) : raw).replace(/\s+/g, ' ').trim();
  // Between shows some stations send placeholders such as " - ".
  if (!/[\p{L}\p{N}]/u.test(value) || /^(airtime|unknown|offline)\b/i.test(value)) return null;
  if (feed.icy === 'programme') return { kind: 'programme', title: text.parse(value.slice(0, 300)), artist: null };
  const split = value.indexOf(' - ');
  const artist = split > 0 ? value.slice(0, split).trim() : '';
  const title = split > 0 ? value.slice(split + 3).trim() : value;
  return { kind: 'track', title: text.parse((title || value).slice(0, 300)), artist: artist ? text.parse(artist.slice(0, 300)) : null };
}

async function readBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new FeedError('missing body');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 512 * 1024) throw new FeedError('oversized body');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class StationNowPlayingService {
  private cache = new Map<StationId, { until: number; data: StationNowPlaying }>();
  private pending = new Map<StationId, Promise<StationNowPlaying>>();
  constructor(private request: typeof fetch = fetch, private now: () => number = Date.now, private overrides: Partial<Record<StationId, string>> = {}) {}

  async get(id: StationId): Promise<StationNowPlaying> {
    const feed = feedFor(id) ?? icyFeeds[id];
    // A replacement stream may carry another programme entirely.
    if (!feed || this.overrides[id]) return { stationId: id, status: 'unsupported', checkedAt: new Date(this.now()).toISOString(), sourceUrl: null };
    const cached = this.cache.get(id);
    if (cached && cached.until > this.now()) return cached.data;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const work = this.load(id, feed);
    this.pending.set(id, work);
    try {
      const data = await work;
      const until = Math.min(this.now() + refreshMs, data.status === 'current' ? Date.parse(data.expiresAt) : Infinity);
      this.cache.set(id, { until, data });
      return data;
    } finally {
      this.pending.delete(id);
    }
  }

  private async load(id: StationId, feed: Feed | IcyFeed): Promise<StationNowPlaying> {
    const base = { stationId: id, sourceUrl: feed.sourceUrl };
    try {
      if ('icy' in feed) {
        const response = await this.request(stationStreams[id].url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'Icy-MetaData': '1' } });
        if (!response.ok) { await response.body?.cancel(); throw new FeedError(`HTTP ${response.status}`); }
        const report = icyReport(feed, await readIcyTitle(response));
        const now = this.now();
        if (!report) return { ...base, checkedAt: new Date(now).toISOString(), status: 'unavailable' };
        // The stream does not say when a track or show ends, so the title expires like an undated feed.
        return { ...base, checkedAt: new Date(now).toISOString(), status: 'current', kind: report.kind, title: report.title, artist: report.artist, startedAt: null, expiresAt: new Date(now + freshnessMs).toISOString() };
      }
      const response = await this.request(feed.url, { redirect: 'error', signal: AbortSignal.timeout(8000), headers: { Accept: feed.html ? 'text/html' : 'application/json', 'Cache-Control': 'no-cache' } });
      if (!response.ok) { await response.body?.cancel(); throw new FeedError(`HTTP ${response.status}`); }
      const contentType = response.headers.get('content-type') ?? '';
      if (!(feed.html ? /^text\/html\b/i : /^application\/(?:[\w.-]+\+)?json\b/i).test(contentType)) {
        await response.body?.cancel();
        throw new FeedError('unexpected content type');
      }
      const body = await readBody(response);
      const now = this.now();
      const checkedAt = new Date(now).toISOString();
      const date = Date.parse(response.headers.get('date') ?? '');
      const age = Number(response.headers.get('age') ?? 0);
      if (!Number.isFinite(age) || age < 0) throw new FeedError('invalid cache age');
      const responseAge = Math.max(0, age * 1000, Number.isFinite(date) ? now - date : 0);
      // NTS caches schedules for 15 minutes. Their explicit current intervals
      // (and FIP's song intervals) remain meaningful independently of HTTP age.
      const timedFeed = id === 'nts-1' || id === 'nts-2' || id === 'fip';
      if (!timedFeed && (responseAge > 120_000 || (Number.isFinite(date) && date - now > 60_000))) throw new StaleFeed();
      const report = parseReport(id, body, now);
      if (!report) return { ...base, checkedAt, status: 'unavailable' };
      // Remaining durations and undated HTML were measured at the origin.
      if (id === 'radio-paradise' && report.end !== undefined) report.end -= responseAge;
      if ((report.start !== undefined && report.start > now + 30_000) || (report.end !== undefined && report.end <= now)) throw new StaleFeed();
      const expires = Math.min(now + freshnessMs - (id === 'radio-helsinki' ? responseAge : 0), report.end ?? Infinity);
      if (expires <= now) throw new StaleFeed();
      return { ...base, checkedAt, status: 'current', kind: report.kind, title: report.title, artist: report.artist, startedAt: report.start === undefined ? null : new Date(report.start).toISOString(), expiresAt: new Date(expires).toISOString() };
    } catch (error) {
      if (error instanceof StaleFeed) return { ...base, checkedAt: new Date(this.now()).toISOString(), status: 'stale' };
      if (error instanceof FeedError || error instanceof z.ZodError || error instanceof SyntaxError || error instanceof TypeError || error instanceof DOMException) return { ...base, checkedAt: new Date(this.now()).toISOString(), status: 'unavailable' };
      throw error;
    }
  }
}
