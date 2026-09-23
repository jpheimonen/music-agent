import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { JobRegistry } from './jobs.js';
import { capabilities, stationId, type Capabilities } from '@music/contracts';

const config = loadConfig();
const app = Fastify({ logger: { redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 64 * 1024 });
const jobs = new JobRegistry();
const unavailable = (reason: string) => ({ state: 'unavailable' as const, reason });
const unimplemented = (feature: string) => ({ state: 'unavailable' as const, reason: `${feature} is not installed yet.` });
const capabilitySnapshot = (): Capabilities => capabilities.parse({
  library: config.libraryRoot ? unimplemented('Library scanner') : { state: 'not_configured', reason: 'Set MUSIC_LIBRARY_ROOT.' },
  codex: unimplemented('Codex integration'),
  youtubeDiscovery: config.youtubeConfigured ? unimplemented('YouTube discovery') : { state: 'not_configured', reason: 'Set YOUTUBE_DATA_API_KEY.' },
  youtubeEmbed: unimplemented('YouTube resolver'),
  stations: { kexp: unimplemented('KEXP adapter'), yle1: unimplemented('Yle Radio 1 adapter'), 'radio-helsinki': unimplemented('Radio Helsinki adapter') },
});
function fail(code: string, message: string, status: number, requestId: string, retryable = false) { return { status, body: { error: { code, message, retryable, requestId } } }; }
app.addHook('onRequest', async (request, reply) => {
  const host = request.headers.host;
  if (!host || !/^127\.0\.0\.1(?::\d+)?$|^localhost(?::\d+)?$/.test(host)) { const e = fail('invalid_host', 'Use the local app address.', 403, request.id); return reply.code(e.status).send(e.body); }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && ![`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`, 'http://127.0.0.1:5173', 'http://localhost:5173'].includes(origin)) { const e = fail('invalid_origin', 'Request origin is not allowed.', 403, request.id); return reply.code(e.status).send(e.body); }
    if (request.headers['content-type']?.split(';')[0] !== 'application/json') { const e = fail('unsupported_media_type', 'JSON is required.', 415, request.id); return reply.code(e.status).send(e.body); }
  }
});
app.setErrorHandler((error: FastifyError, request, reply) => {
  const invalid = error instanceof z.ZodError || error.validation;
  const status = invalid ? 400 : (error.statusCode && error.statusCode < 500 ? error.statusCode : 500);
  const code = invalid ? 'invalid_request' : status === 404 ? 'not_found' : 'internal_error';
  if (status === 500) request.log.error({ err: error }, 'request failed');
  reply.code(status).send(fail(code, invalid ? 'Invalid request.' : status === 500 ? 'Internal server error.' : error.message, status, request.id).body);
});
app.get('/api/v1/capabilities', async () => capabilitySnapshot());
app.get('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.get(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.delete('/api/v1/jobs/:id', async (request, reply) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const job = jobs.cancel(id); if (!job) return reply.code(404).send(fail('not_found', 'Job not found.', 404, request.id).body); return job; });
app.get('/api/v1/stations', async (_request, reply) => reply.code(503).send(fail('feature_unavailable', 'Station adapters are not installed yet.', 503, _request.id, true).body));
app.post('/api/v1/stations/:id/resolve', async (request, reply) => { stationId.parse((request.params as {id:string}).id); return reply.code(503).send(fail('feature_unavailable', 'Station adapter is not installed yet.', 503, request.id, true).body); });
app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/')) return reply.code(404).send(fail('not_found', 'API route not found.', 404, request.id).body); return reply.code(404).send('Not found'); });
const webDist = resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/', wildcard: false });
app.addHook('onClose', async () => { await jobs.stop(); });
try { await app.listen({ port: config.port, host: '127.0.0.1' }); } catch (error) { app.log.error(error); process.exitCode = 1; }
