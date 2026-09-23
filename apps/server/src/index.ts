import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { JobRegistry } from './jobs.js';
import { capabilities, stationId, type Capabilities } from '@music/contracts';
import { LibraryService, LibraryError, parseRange } from './library.js';
import { stationDescriptors, resolveStation } from './stations.js';
import { YoutubeService, YoutubeProviderError, parseVideoId, youtubeItem } from './youtube.js';
import { mediaId, scanRequest, youtubeResolveRequest, youtubeSearchQuery } from '@music/contracts';

const config = loadConfig();
const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 64 * 1024 });
const jobs = new JobRegistry();
const library = new LibraryService(config.libraryRoot, config.dataDir);
await library.initialize();
const youtube = new YoutubeService(config.youtubeKey);
const unavailable = (reason: string) => ({ state: 'unavailable' as const, reason });
const unimplemented = (feature: string) => ({ state: 'unavailable' as const, reason: `${feature} is not installed yet.` });
const capabilitySnapshot = (): Capabilities => capabilities.parse({
  library: library.state,
  codex: unimplemented('Codex integration'),
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
app.get('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.get(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.delete('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.cancel(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.get('/api/v1/stations', async () => stationDescriptors());
app.post('/api/v1/stations/:id/resolve', async request => resolveStation(config, stationId.parse((request.params as {id:string}).id)));
app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/')) return reply.code(404).send(fail('not_found', 'API route not found.', 404, request.id).body); return reply.code(404).send('Not found'); });
const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
app.addHook('onClose', async () => { await jobs.stop(); });
try { await app.listen({ port: config.port, host: '127.0.0.1' }); } catch (error) { app.log.error(error); process.exitCode = 1; }
