import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { JobRegistry } from './jobs.js';
import { capabilities, stationId, mediaId, feedbackRequest, scanRequest, youtubeResolveRequest, youtubeSearchQuery, recommendationRequest, type Capabilities } from '@music/contracts';
import { LibraryService, LibraryError, parseRange } from './library.js';
import { stationDescriptors, resolveStation } from './stations.js';
import { YoutubeService, YoutubeProviderError, parseVideoId, youtubeItem } from './youtube.js';
import { TasteRepository, TasteError } from './taste.js';
import { CodexRunner } from './codex.js';
import { DjService } from './dj.js';

const config = loadConfig();
const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 64 * 1024 });
const jobs = new JobRegistry();
const library = new LibraryService(config.libraryRoot, config.dataDir);
await library.initialize();
const youtube = new YoutubeService(config.youtubeKey);
const tasteRepository = await TasteRepository.open(config.dataDir);
const codex = await CodexRunner.create(config);
const dj = new DjService(codex, library, youtube, tasteRepository, config.dataDir);
const artistJobs = new Map<string,string>();
const sessionJobs = new Map<string,string>();
let synthesisJobId: string | null = null;
function scheduleSynthesis() {
  if (codex.capability.state !== 'ready') return;
  if (tasteRepository.snapshot().summaryStatus === 'current') return;
  const current = synthesisJobId && jobs.get(synthesisJobId);
  if (current && (current.status === 'queued' || current.status === 'running')) return;
  const job = jobs.start('synthesizeTaste', signal => dj.synthesize(signal));
  synthesisJobId = job.id;
  void jobs.settled(job.id).then(() => {
    if (synthesisJobId !== job.id) return;
    synthesisJobId = null;
    // A feedback write during this run invalidates its snapshot. Retry once from the current state.
    if (jobs.get(job.id)?.error?.code === 'revision_conflict') scheduleSynthesis();
  });
}
if (tasteRepository.snapshot().summaryStatus === 'pending') scheduleSynthesis();
const capabilitySnapshot = (): Capabilities => capabilities.parse({
  library: library.state,
  codex: { ...codex.capability, synthesisStatus: codex.capability.state === 'ready' ? tasteRepository.snapshot().summaryStatus : 'unavailable' },
  youtubeDiscovery: config.youtubeConfigured ? { state: 'ready' } : { state: 'not_configured', reason: 'Set YOUTUBE_DATA_API_KEY.' },
  youtubeEmbed: { state: 'ready' },
  stations: { kexp: { state: 'ready' }, yle1: { state: 'ready' }, 'radio-helsinki': { state: 'ready' } },
});
function fail(code: string, message: string, status: number, requestId: string, retryable = false) { return { status, body: { error: { code, message, retryable, requestId } } }; }
app.addHook('onRequest', async (request, reply) => {
  const host = request.headers.host;
  if (!host || !/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$/.test(host)) { const e = fail('invalid_host', 'Use the local app address.', 403, request.id); return reply.code(e.status).send(e.body); }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) { const e = fail('invalid_origin', 'Request origin is not allowed.', 403, request.id); return reply.code(e.status).send(e.body); }
    if (request.method !== 'DELETE' && request.headers['content-type']?.split(';')[0] !== 'application/json') { const e = fail('unsupported_media_type', 'JSON is required.', 415, request.id); return reply.code(e.status).send(e.body); }
  }
});
app.setErrorHandler((error: FastifyError, request, reply) => {
  if (error instanceof LibraryError || error instanceof YoutubeProviderError) return reply.code(error.status).send(fail(error.code, error.message, error.status, request.id, error instanceof YoutubeProviderError ? error.retryable : false).body);
  const invalid = error instanceof z.ZodError || error.validation;
  const status = invalid ? 400 : (error.statusCode && error.statusCode < 500 ? error.statusCode : 500);
  const code = invalid ? 'invalid_request' : status === 404 ? 'not_found' : 'internal_error';
  if (status === 500) request.log.error({ err: error }, 'request failed');
  reply.code(status).send(fail(code, invalid ? 'Invalid request.' : status === 500 ? 'Internal server error.' : error.message, status, request.id).body);
});
app.get('/api/v1/capabilities', async () => capabilitySnapshot());
app.post('/api/v1/library/scans', async (request, reply) => {
  if (library.state.state === 'not_configured' || library.state.state === 'error') throw new LibraryError('library_unavailable');
  const { full } = scanRequest.parse(request.body || {});
  const job = jobs.start('scan', (signal, progress) => library.scan(Boolean(full), signal, progress));
  return reply.code(202).send({ jobId: job.id });
});
app.get('/api/v1/library/tracks', async request => {
  const query = z.object({ q: z.string().max(200).optional(), cursor: z.coerce.number().int().nonnegative().default(0), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
  return library.page(query.q, query.cursor, query.limit);
});
async function streamLocal(request: FastifyRequest, reply: FastifyReply) {
  const { id } = z.object({ id: mediaId }).parse(request.params);
  if (!id.startsWith('local:')) throw new LibraryError('media_missing', 404);
  const { handle, size } = await library.open(id);
  let range;
  try { range = parseRange(request.headers.range, size); } catch (error) { await handle.close(); reply.header('Content-Range', `bytes */${size}`); throw error; }
  const start = range?.start ?? 0; const end = range?.end ?? size - 1;
  reply.header('Accept-Ranges', 'bytes').header('Content-Type', 'audio/mpeg').header('Content-Length', String(end - start + 1));
  if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`);
  if (request.method === 'HEAD') { await handle.close(); return reply.send(); }
  const stream = handle.createReadStream({ start, end, autoClose: true });
  reply.raw.on('close', () => stream.destroy());
  return reply.send(stream);
}
app.get('/api/v1/media/local/:id', streamLocal);
app.post('/api/v1/youtube/resolve', async request => {
  const { input } = youtubeResolveRequest.parse(request.body);
  let id: string; try { id = parseVideoId(input); } catch { throw new LibraryError('invalid_youtube_url', 400); }
  return youtubeItem(id);
});
app.get('/api/v1/youtube/search', async request => {
  const { q, maxResults } = youtubeSearchQuery.parse(request.query);
  return youtube.search(q, maxResults, request.raw.aborted ? AbortSignal.abort() : undefined);
});
app.get('/api/v1/taste', async (request) => {
  const query = z.object({ mediaIds: z.string().optional() }).parse(request.query);
  const ids = query.mediaIds?.split(',').filter(Boolean);
  if (ids && ids.length > 100) throw new z.ZodError([]);
  ids?.forEach(id => mediaId.parse(id));
  return tasteRepository.snapshot(ids);
});
app.put('/api/v1/feedback/:mediaId', async (request, reply) => {
  const { mediaId: id } = z.object({ mediaId }).parse(request.params);
  const body = feedbackRequest.parse(request.body);
  const key = request.headers['idempotency-key'];
  if (typeof key !== 'string') return reply.code(400).send(fail('invalid_request', 'Idempotency-Key header is required.', 400, request.id).body);
  try { const result = await tasteRepository.react({ mediaId: id, ...body, idempotencyKey: key }); scheduleSynthesis(); return result; }
  catch (error) {
    if (error instanceof TasteError) {
      const status = error.code === 'revision_conflict' || error.code === 'external_file_change' ? 409 : 503;
      const body = fail(error.code, error.message, status, request.id, error.code === 'storage_unavailable').body;
      if (error.code === 'revision_conflict') Object.assign(body.error, { details: tasteRepository.snapshot([id]) });
      return reply.code(status).send(body);
    }
    throw error;
  }
});
app.post('/api/v1/dj/recommendations', async (request, reply) => {
  const input = recommendationRequest.parse(request.body);
  if (codex.capability.state !== 'ready') return reply.code(503).send(fail('setup_required', codex.capability.reason ?? 'Set up Codex login.', 503, request.id).body);
  if (input.source === 'youtube' && !config.youtubeConfigured) return reply.code(503).send(fail('setup_required', 'Set YOUTUBE_DATA_API_KEY for YouTube discovery.', 503, request.id).body);
  const previous = sessionJobs.get(input.sessionId);
  if (previous) jobs.cancel(previous);
  const job = jobs.start('recommendations', signal => dj.recommend(input, signal));
  sessionJobs.set(input.sessionId,job.id);
  void jobs.settled(job.id).then(() => { if (sessionJobs.get(input.sessionId) === job.id) sessionJobs.delete(input.sessionId); });
  return reply.code(202).send({ jobId: job.id });
});
app.get('/api/v1/artists/:key/info', async request => {
  const { key } = z.object({ key:z.string().min(1).max(200) }).parse(request.params);
  const current = await dj.artist(key);
  if (current.status === 'cached' || current.status === 'failed' || !dj.hasArtist(key) || codex.capability.state !== 'ready') return current;
  const existing = artistJobs.get(key);
  if (existing && ['queued','running'].includes(jobs.get(existing)?.status ?? '')) return { artistKey:key, status:'pending', jobId:existing };
  const job = jobs.start('describeArtist', signal => dj.describeArtist(key, signal));
  artistJobs.set(key,job.id);
  void jobs.settled(job.id).then(() => { if (artistJobs.get(key) === job.id) artistJobs.delete(key); });
  return { artistKey:key, status:'pending', jobId:job.id };
});
app.post('/api/v1/artists/:key/info/refresh', async (request, reply) => {
  const { key } = z.object({ key:z.string().min(1).max(200) }).parse(request.params);
  if (codex.capability.state !== 'ready') return reply.code(503).send(fail('setup_required', codex.capability.reason ?? 'Set up Codex login.', 503, request.id).body);
  const current = await dj.artist(key);
  if (!dj.hasArtist(key)) return reply.code(404).send(fail('identity_uncertain','Artist identity is unavailable.',404,request.id).body);
  const job = jobs.start('describeArtist', signal => dj.describeArtist(key, signal, true));
  artistJobs.set(key,job.id);
  void jobs.settled(job.id).then(() => { if (artistJobs.get(key) === job.id) artistJobs.delete(key); });
  return reply.code(202).send({jobId:job.id});
});
app.get('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.get(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.delete('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.cancel(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.get('/api/v1/stations', async () => stationDescriptors());
app.post('/api/v1/stations/:id/resolve', async request => resolveStation(config, stationId.parse((request.params as {id:string}).id)));
app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/')) return reply.code(404).send(fail('not_found', 'API route not found.', 404, request.id).body); return reply.code(404).send('Not found'); });
const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
app.addHook('onClose', async () => { await jobs.stop(); await codex.stop(); await tasteRepository.close(); });
try { await app.listen({ port: config.port, host: '127.0.0.1' }); } catch (error) { app.log.error(error); process.exitCode = 1; }
