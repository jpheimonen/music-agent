import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recommendationRequest, recommendationResult, artistInfo, type MediaItem } from '@music/contracts';
import { CodexRunner, CodexError } from './codex.js';
import { LibraryService } from './library.js';
import { TasteRepository, TasteError } from './taste.js';
import { YoutubeService } from './youtube.js';

const clean = (value: string) => value.slice(0, 500).replace(/[\u0000-\u001f]/g, ' ');
export class DjService {
  private inflightArtists = new Map<string, Promise<unknown>>();
  private artistFailures = new Map<string, number>();
  constructor(private codex: CodexRunner, private library: LibraryService, private youtube: YoutubeService, private taste: TasteRepository, private dataDir: string) {}
  async synthesize(signal?: AbortSignal) {
    const snapshot = this.taste.snapshot();
    this.taste.setSynthesisStatus('pending');
    try {
      const result = await this.codex.run('synthesizeTaste', { feedbackRevision:snapshot.feedbackRevision, summaryRevision:snapshot.summaryRevision, feedback:this.taste.agentContext(), currentSummary:snapshot.summaryMarkdown?.slice(0,6000) ?? null }, signal);
      if (signal?.aborted) throw new CodexError('cancelled', false);
      return await this.taste.commitSummary({ body:result.body, basedOnFeedbackRevision:snapshot.feedbackRevision, expectedSummaryRevision:snapshot.summaryRevision });
    } catch (error) { this.taste.setSynthesisStatus('failed'); throw error; }
  }
  async recommend(raw: unknown, signal?: AbortSignal) {
    const request = recommendationRequest.parse(raw);
    const boundedSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(120_000)]);
    if (request.seedId && !request.seedId.startsWith(`${request.source}:`)) throw new CodexError('invalid_request',false);
    const snapshot = this.taste.snapshot();
    const feedback = this.taste.agentContext();
    const excluded = new Set([...request.queuedIds, ...request.recentIds, ...(request.seedId ? [request.seedId] : []), ...Object.entries(snapshot.feedback).filter(([,v]) => v === 'dislike').map(([id]) => id)]);
    let candidates: MediaItem[] = [];
    if (request.source === 'local') {
      const plan = await this.codex.run('planDiscovery', { source:'local', taste:snapshot.summaryMarkdown?.slice(0,6000) ?? null, feedback, seedId:request.seedId, direction:request.direction?.slice(0,500) }, boundedSignal);
      for (const query of plan.queries) {
        const page = this.library.page(query, 0, 100);
        candidates.push(...page.items.filter(item => item.availability === 'available' && !excluded.has(item.id)));
      }
      if (!candidates.length) candidates = this.library.page('',0,100).items.filter(item => item.availability === 'available' && !excluded.has(item.id));
    } else {
      const plan = await this.codex.run('planDiscovery', { source:'youtube', taste:snapshot.summaryMarkdown?.slice(0,6000) ?? null, feedback, seedId:request.seedId, direction:request.direction?.slice(0,500) }, boundedSignal);
      for (const query of plan.queries) {
        if (boundedSignal.aborted) throw new CodexError(signal?.aborted ? 'cancelled' : 'deadline_exceeded', false);
        const page = await this.youtube.search(query, 10, boundedSignal);
        candidates.push(...page.items.filter(item => !excluded.has(item.id)));
      }
    }
    candidates = [...new Map(candidates.map(item => [item.id, item])).values()].slice(0,50);
    if (!candidates.length) {
      const latest = this.taste.snapshot();
      if (boundedSignal.aborted) throw new CodexError(signal?.aborted ? 'cancelled' : 'deadline_exceeded', false);
      if (latest.feedbackRevision !== snapshot.feedbackRevision || latest.summaryRevision !== snapshot.summaryRevision) throw new TasteError('revision_conflict','Taste changed during discovery.');
      return recommendationResult.parse({ sessionId:request.sessionId, modeEpoch:request.modeEpoch, source:request.source, feedbackRevision:snapshot.feedbackRevision, summaryRevision:snapshot.summaryRevision, items:[] });
    }
    const selected = await this.codex.run('selectCandidates', { source:request.source, taste:snapshot.summaryMarkdown?.slice(0,6000) ?? null, feedback, direction:request.direction?.slice(0,500), candidates:candidates.map(item => ({id:item.id,title:clean(item.title).slice(0,180),artist:item.artist?.displayName.slice(0,180) ?? null})) }, boundedSignal);
    if (boundedSignal.aborted) throw new CodexError(signal?.aborted ? 'cancelled' : 'deadline_exceeded', false);
    const latest = this.taste.snapshot();
    if (latest.feedbackRevision !== snapshot.feedbackRevision || latest.summaryRevision !== snapshot.summaryRevision) throw new TasteError('revision_conflict','Taste changed during discovery.');
    const allowed = new Map(candidates.map(item => [item.id, item]));
    const ids = new Set<string>();
    const items = selected.selections.map(entry => {
      const media = allowed.get(entry.id);
      if (!media || media.source !== request.source || ids.has(entry.id) || latest.feedback[entry.id] === 'dislike') throw new CodexError('invalid_agent_output', false);
      ids.add(entry.id); return { media, reason:entry.reason };
    });
    return recommendationResult.parse({ sessionId:request.sessionId, modeEpoch:request.modeEpoch, source:request.source, feedbackRevision:snapshot.feedbackRevision, summaryRevision:snapshot.summaryRevision, items });
  }
  private knownArtist(key: string) {
    for (let cursor = 0; cursor < 500; cursor += 100) {
      const page = this.library.page('', cursor, 100);
      const item = page.items.find(item => item.artist?.id === key && item.artist.confidence !== 'low' && item.artist.provenance === 'id3');
      if (item?.artist) return item.artist;
      if (!page.nextCursor) break;
    }
    return null;
  }
  hasArtist(key: string) { return Boolean(this.knownArtist(key)); }
  private cachePath(key: string) { return join(this.dataDir, 'artist-cache', createHash('sha256').update(`v1:en:${key}`).digest('hex') + '.json'); }
  async artist(key: string) {
    const identity = this.knownArtist(key);
    if (!identity) return artistInfo.parse({ artistKey:key, status:'unavailable' });
    try {
      const cached = artistInfo.parse(JSON.parse(await readFile(this.cachePath(key),'utf8')));
      if (cached.artistKey === key && cached.status === 'cached') return cached;
    } catch { /* cache miss */ }
    return artistInfo.parse({ artistKey:key, status:this.inflightArtists.has(key) ? 'pending' : (this.artistFailures.get(key) ?? 0) > Date.now() ? 'failed' : 'unavailable' });
  }
  async describeArtist(key: string, signal?: AbortSignal, refresh = false) {
    const identity = this.knownArtist(key);
    if (!identity) return artistInfo.parse({ artistKey:key, status:'unavailable' });
    if (!refresh) { const cached = await this.artist(key); if (cached.status === 'cached') return cached; }
    if ((this.artistFailures.get(key) ?? 0) > Date.now()) throw new CodexError('provider_unavailable');
    const existing = this.inflightArtists.get(key);
    if (existing) return existing;
    const work = (async () => {
      const generated = await this.codex.run('describeArtist', { artistKey:key, displayName:identity.displayName, provenance:identity.provenance, instruction:'Describe this artist conservatively. If uncertain, say so. Do not invent citations.' }, signal);
      if (signal?.aborted) throw new CodexError('cancelled',false);
      const record = artistInfo.parse({ artistKey:key,status:'cached',generatedAt:new Date().toISOString(),introduction:generated.introduction,text:generated.text,provenance:'Codex 0.156.1' });
      const path = this.cachePath(key); await mkdir(join(this.dataDir,'artist-cache'),{recursive:true,mode:0o700});
      const temp = `${path}.${process.pid}.tmp`; await writeFile(temp,JSON.stringify(record),{mode:0o600}); await rename(temp,path);
      return record;
    })();
    this.inflightArtists.set(key,work);
    try { const result = await work; this.artistFailures.delete(key); return result; }
    catch (error) { this.artistFailures.set(key, Date.now() + 60_000); throw error; }
    finally { this.inflightArtists.delete(key); }
  }
}
