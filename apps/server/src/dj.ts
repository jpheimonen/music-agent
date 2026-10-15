import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recommendationRequest, recommendationResult, artistInfo, type DjMessageRequest, type MediaItem, type RecommendationRequest } from '@music/contracts';
import { CodexRunner, CodexError } from './codex.js';
import { LibraryService } from './library.js';
import type { DjMemory } from './memory.js';
import { TasteRepository } from './taste.js';
import { YoutubeService, normalizeText } from './youtube.js';

const clean = (value: string) => value.slice(0, 500).replace(/[\u0000-\u001f]/g, ' ');
// One key per song, whichever video or file carries it.
const songKey = (artist: string | null, title: string) => `${normalizeText(artist ?? '')}|${normalizeText(title)}`;
export class DjService {
  private inflightArtists = new Map<string, Promise<unknown>>();
  private artistFailures = new Map<string, number>();
  constructor(private codex: CodexRunner, private library: LibraryService, private youtube: YoutubeService, private taste: TasteRepository, private dataDir: string, private memory: DjMemory) {}
  // What the listener said, how they reacted and what they skipped, for every DJ decision.
  private listenerContext() {
    return {
      notes: this.memory.notes.map(note => note.text),
      recentPlays: this.memory.recentPlays(25).map(play => ({ title:play.title.slice(0,120), artist:play.artist?.slice(0,100) ?? null, outcome:play.outcome, listenedSeconds:play.listenedSeconds, durationSeconds:play.durationSeconds })),
    };
  }
  async synthesize(signal?: AbortSignal) {
    const snapshot = this.taste.snapshot();
    this.taste.setSynthesisStatus('pending');
    try {
      const result = await this.codex.run('synthesizeTaste', { feedbackRevision:snapshot.feedbackRevision, summaryRevision:snapshot.summaryRevision, feedback:this.taste.agentContext(), ...this.listenerContext(), currentSummary:snapshot.summaryMarkdown?.slice(0,6000) ?? null }, signal);
      if (signal?.aborted) throw new CodexError('cancelled', false);
      return await this.taste.commitSummary({ body:result.body, basedOnFeedbackRevision:snapshot.feedbackRevision, expectedSummaryRevision:snapshot.summaryRevision });
    } catch (error) { this.taste.setSynthesisStatus('failed'); throw error; }
  }
  async recommend(raw: unknown, signal?: AbortSignal) {
    const request = recommendationRequest.parse(raw);
    const boundedSignal = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(request.source === 'youtube' ? 150_000 : 120_000)]);
    // The playing track may come from another source than the one the DJ now picks from.
    const seedId = request.seedId?.startsWith(`${request.source}:`) ? request.seedId : undefined;
    const snapshot = this.taste.snapshot();
    const feedback = this.taste.agentContext();
    const excluded = new Set([...request.queuedIds, ...request.recentIds, ...(seedId ? [seedId] : []), ...Object.entries(snapshot.feedback).filter(([,v]) => v === 'dislike').map(([id]) => id)]);
    let items = request.source === 'local'
      ? await this.pickLocal(request, seedId, snapshot.summaryMarkdown, feedback, excluded, boundedSignal)
      : await this.pickYoutube(request, snapshot.summaryMarkdown, feedback, excluded, boundedSignal);
    if (boundedSignal.aborted) throw new CodexError(signal?.aborted ? 'cancelled' : 'deadline_exceeded', false);
    // A dislike saved while the DJ was choosing drops that track instead of failing the batch.
    const latest = this.taste.snapshot();
    items = items.filter(item => latest.feedback[item.media.id] !== 'dislike');
    return recommendationResult.parse({ sessionId:request.sessionId, modeEpoch:request.modeEpoch, source:request.source, feedbackRevision:snapshot.feedbackRevision, summaryRevision:snapshot.summaryRevision, items, ...(items.length ? {} : {emptyReason:'no_verified_candidates'}) });
  }
  private async pickLocal(request: RecommendationRequest, seedId: string | undefined, taste: string | null, feedback: unknown, excluded: Set<string>, signal: AbortSignal) {
    const plan = await this.codex.run('planDiscovery', { source:'local', taste:taste?.slice(0,6000) ?? null, feedback, ...this.listenerContext(), seedId, direction:request.direction?.slice(0,500) }, signal);
    let candidates: MediaItem[] = [];
    for (const query of plan.queries) {
      const page = this.library.page(query, 0, 100);
      candidates.push(...page.items.filter(item => item.availability === 'available' && !excluded.has(item.id)));
    }
    if (!candidates.length) candidates = this.library.page('',0,100).items.filter(item => item.availability === 'available' && !excluded.has(item.id));
    candidates = [...new Map(candidates.map(item => [item.id, item])).values()].slice(0,50);
    if (!candidates.length) return [];
    const selected = await this.codex.run('selectCandidates', { source:'local', taste:taste?.slice(0,6000) ?? null, feedback, ...this.listenerContext(), direction:request.direction?.slice(0,500), candidates:candidates.map(item => ({id:item.id,title:clean(item.title).slice(0,180),artist:item.artist?.displayName.slice(0,180) ?? null})) }, signal);
    const allowed = new Map(candidates.map(item => [item.id, item]));
    const ids = new Set<string>();
    return selected.selections.map(entry => {
      const media = allowed.get(entry.id);
      if (!media || ids.has(entry.id)) throw new CodexError('invalid_agent_output', false);
      ids.add(entry.id); return { media, reason:entry.reason };
    });
  }
  // The DJ names tracks; each is then looked up on YouTube and kept only if it
  // can be streamed. A quick first batch stops at three so music starts sooner.
  private async pickYoutube(request: RecommendationRequest, taste: string | null, feedback: unknown, excluded: Set<string>, signal: AbortSignal) {
    const recentTracks = (request.recentTracks ?? []).map(track => ({ title:clean(track.title).slice(0,150), artist:track.artist ? clean(track.artist).slice(0,100) : null }));
    const listener = this.listenerContext();
    const { picks } = await this.codex.run('pickTracks', { count:request.quick ? 5 : 8, direction:request.direction?.slice(0,500) ?? null, taste:taste?.slice(0,6000) ?? null, feedback, ...listener, recentTracks }, signal, { quick:request.quick });
    // Songs played in recent sessions are not repeated either.
    const heard = new Set([...recentTracks, ...this.memory.recentPlays(60)].map(track => songKey(track.artist, track.title)));
    const fresh = picks.filter(pick => { const key = songKey(pick.artist, pick.title); if (heard.has(key)) return false; heard.add(key); return true; });
    const wanted = request.quick ? 3 : 5;
    const found: { order: number; media: MediaItem; reason: string }[] = [];
    const taken = new Set(excluded);
    const enough = new AbortController();
    const lookups = AbortSignal.any([signal, enough.signal]);
    let next = 0;
    let failure: unknown = null;
    const worker = async () => {
      while (next < fresh.length && found.length < wanted && !lookups.aborted) {
        const order = next++;
        const pick = fresh[order];
        try {
          const media = await this.youtube.findTrack(pick, id => taken.has(id), lookups);
          if (!media || taken.has(media.id) || found.length >= wanted) continue;
          taken.add(media.id);
          found.push({ order, media, reason:pick.reason });
          if (found.length >= wanted) enough.abort();
        } catch (error) { if (!lookups.aborted) failure ??= error; }
      }
    };
    await Promise.all(Array.from({ length:5 }, worker));
    if (!found.length && failure) throw failure;
    return found.sort((a, b) => a.order - b.order).map(({ media, reason }) => ({ media, reason }));
  }
  // One turn of conversation. The exchange and any notes are saved only when the DJ answers.
  async converse(input: DjMessageRequest, signal?: AbortSignal) {
    const snapshot = this.taste.snapshot();
    const result = await this.codex.run('converse', {
      mode:input.mode, message:input.text || null, djOn:input.djOn, djJustStarted:Boolean(input.starting), nowPlaying:input.nowPlaying ?? null,
      conversation:this.memory.conversation.slice(-20).map(message => ({ role:message.role === 'dj' ? 'dj' : 'listener', text:message.text.slice(0,600) })),
      notes:this.memory.notes.map(note => ({ id:note.id, text:note.text })),
      taste:snapshot.summaryMarkdown?.slice(0,3000) ?? null, reactions:this.taste.agentContext(20), recentPlays:this.listenerContext().recentPlays,
    }, signal, { quick:true });
    if (signal?.aborted) throw new CodexError('cancelled', false);
    const message = await this.memory.recordExchange({ you:input.text || null, reply:result.reply, suggestions:result.suggestions, addNotes:result.notesToAdd, removeNoteIds:result.noteIdsToRemove });
    return { message, steer:result.steer || null, interviewDone:input.mode === 'interview' && result.interviewDone, memory:this.memory.snapshot() };
  }
  async searchYoutube(query: string, signal?: AbortSignal) {
    const items = await this.youtube.search(query, signal);
    return { items, nextPageToken:null, ...(items.length ? {} : {emptyReason:'no_verified_candidates'}) };
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
