import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

const releases = 'https://github.com/yt-dlp/yt-dlp/releases';
const dayMs = 24 * 60 * 60 * 1000;
const videoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export class YoutubeProviderError extends Error {
  constructor(public code: string, public status: number, public retryable: boolean) { super(code); }
}

export type YtDlpState = { state: 'ready' | 'scanning' | 'unavailable'; reason?: string; version?: string };
export type SearchEntry = { id: string; title: string; channel: string | null; durationSeconds: number | null; viewCount: number | null; liveStatus: string | null };
export type AudioStream = { url: string; headers: Record<string, string>; mimeType: string; size: number | null; expiresAt: number };

const searchResult = z.object({
  entries: z.array(z.object({
    id: z.string(),
    title: z.string().nullish(),
    channel: z.string().nullish(),
    uploader: z.string().nullish(),
    duration: z.number().nullish(),
    view_count: z.number().nullish(),
    live_status: z.string().nullish(),
  }).passthrough()).default([]),
}).passthrough();
const audioFormat = z.object({
  url: z.string().url(),
  ext: z.string(),
  filesize: z.number().nullish(),
  vcodec: z.string().nullish(),
  http_headers: z.record(z.string(), z.string()).default({}),
}).passthrough();

async function download(url: string, request: typeof fetch, limit: number) {
  const response = await request(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new YoutubeProviderError('ytdlp_install_failed', 503, true);
  const chunks: Uint8Array[] = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > limit) throw new YoutubeProviderError('ytdlp_install_failed', 503, true);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Installs the official yt-dlp zipapp. The release tag is resolved first so the
// file and its checksum list come from the same release.
export async function installYtDlp(path: string, request: typeof fetch = fetch) {
  const latest = await request(`${releases}/latest`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const tag = /\/releases\/tag\/([\w.-]+)$/.exec(latest.headers.get('location') ?? '')?.[1];
  if (!tag) throw new YoutubeProviderError('ytdlp_install_failed', 503, true);
  const [binary, sums] = await Promise.all([
    download(`${releases}/download/${tag}/yt-dlp`, request, 64 * 1024 * 1024),
    download(`${releases}/download/${tag}/SHA2-256SUMS`, request, 64 * 1024),
  ]);
  const expected = sums.toString('utf8').split('\n').map(line => line.trim().split(/\s+/)).find(([, name]) => name === 'yt-dlp')?.[0];
  if (!expected || createHash('sha256').update(binary).digest('hex') !== expected) throw new YoutubeProviderError('ytdlp_checksum_mismatch', 503, false);
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, binary);
  await chmod(temp, 0o755);
  await rename(temp, path);
}

function failureCode(stderr: string) {
  if (/python/i.test(stderr) && /(not found|no such file|is no longer supported|unsupported)/i.test(stderr)) return 'ytdlp_needs_python';
  if (/not a bot|confirm you.?re not/i.test(stderr)) return 'youtube_bot_check';
  if (/requested format is not available/i.test(stderr)) return 'youtube_no_audio_format';
  if (/(video unavailable|is unavailable|private video|has been removed|not available in your country|confirm your age|members-only|copyright)/i.test(stderr)) return 'youtube_video_unavailable';
  return 'ytdlp_failed';
}

export class YtDlp {
  state: YtDlpState = { state: 'scanning', reason: 'ytdlp_starting' };
  private running = 0;
  private draining = false;
  private wakers: Array<() => void> = [];
  private updateTimer?: NodeJS.Timeout;
  readonly binary: string;
  private readonly managed: boolean;
  private readonly stampPath: string;
  private readonly cacheDir: string;

  constructor(private options: { toolsDir: string; binary?: string; request?: typeof fetch; maxProcesses?: number }) {
    this.managed = !options.binary;
    this.binary = options.binary ?? join(options.toolsDir, 'yt-dlp');
    this.stampPath = join(options.toolsDir, 'yt-dlp.checked');
    this.cacheDir = join(options.toolsDir, 'yt-dlp-cache');
  }

  // Installs a missing managed copy, updates a stale one and confirms it runs.
  async start() {
    try {
      if (this.managed) {
        await mkdir(this.options.toolsDir, { recursive: true, mode: 0o700 });
        if (!(await stat(this.binary).catch(() => null))) {
          this.state = { state: 'scanning', reason: 'ytdlp_installing' };
          await installYtDlp(this.binary, this.options.request);
          await writeFile(this.stampPath, new Date().toISOString(), { mode: 0o600 });
        } else await this.updateIfStale();
        this.updateTimer = setInterval(() => void this.updateIfStale(), dayMs / 4);
        this.updateTimer.unref();
      }
      this.state = { state: 'ready', version: await this.version() };
    } catch (error) {
      this.state = { state: 'unavailable', reason: error instanceof YoutubeProviderError ? error.code : 'ytdlp_unavailable' };
    }
  }

  stop() { clearInterval(this.updateTimer); }

  private async version() {
    try { return (await this.exec(['--version'], { timeout: 20_000 })).trim().slice(0, 40); }
    catch (error) { throw new YoutubeProviderError(error instanceof YoutubeProviderError ? error.code : 'ytdlp_unavailable', 503, false); }
  }

  // yt-dlp must follow YouTube's changes, so the managed copy updates itself
  // once a day. The update waits until no yt-dlp process is running: replacing
  // the zipapp under a running process could break its lazy imports.
  private async updateIfStale() {
    const checked = Date.parse(await readFile(this.stampPath, 'utf8').catch(() => ''));
    if (Number.isFinite(checked) && Date.now() - checked < dayMs) return;
    await this.acquire(undefined, true);
    try {
      await this.exec(['--update'], { timeout: 120_000 }).catch(() => { /* Keep the working copy and try again later. */ });
      await writeFile(this.stampPath, new Date().toISOString(), { mode: 0o600 });
    } finally { this.release(true); }
    if (this.state.state === 'ready') this.state = { state: 'ready', version: await this.version().catch(() => this.state.version) };
  }

  private async acquire(signal?: AbortSignal, exclusive = false) {
    const limit = this.options.maxProcesses ?? 6;
    if (exclusive) this.draining = true;
    while (exclusive ? this.running > 0 : this.draining || this.running >= limit) {
      if (signal?.aborted) throw new YoutubeProviderError('cancelled', 499, false);
      await new Promise<void>(resolve => { this.wakers.push(resolve); signal?.addEventListener('abort', () => resolve(), { once: true }); });
    }
    this.running += exclusive ? limit : 1;
    if (exclusive) this.draining = false;
  }
  private release(exclusive = false) {
    this.running -= exclusive ? (this.options.maxProcesses ?? 6) : 1;
    for (const wake of this.wakers.splice(0)) wake();
  }

  private exec(args: string[], options: { signal?: AbortSignal; timeout: number; maxBuffer?: number }) {
    return new Promise<string>((resolve, reject) => {
      execFile(this.binary, args, {
        timeout: options.timeout, maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024, signal: options.signal, killSignal: 'SIGKILL',
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
      }, (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        if (options.signal?.aborted) return reject(new YoutubeProviderError('cancelled', 499, false));
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new YoutubeProviderError('ytdlp_unavailable', 503, false));
        if (error.killed) return reject(new YoutubeProviderError('deadline_exceeded', 504, true));
        const code = failureCode(String(stderr));
        reject(new YoutubeProviderError(code, code === 'youtube_video_unavailable' || code === 'youtube_no_audio_format' ? 404 : 502, code !== 'youtube_video_unavailable'));
      });
    });
  }

  private async run(args: string[], options: { signal?: AbortSignal; timeout: number; maxBuffer?: number }) {
    if (this.state.state !== 'ready') throw new YoutubeProviderError(this.state.reason ?? 'ytdlp_unavailable', 503, true);
    await this.acquire(options.signal);
    try {
      // The server's own Node solves YouTube's JavaScript challenges.
      return await this.exec(['--ignore-config', '--no-warnings', '--no-progress', '--js-runtimes', `node:${process.execPath}`, '--cache-dir', this.cacheDir, ...args], options);
    } finally { this.release(); }
  }

  async search(query: string, limit: number, signal?: AbortSignal): Promise<SearchEntry[]> {
    const text = query.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    const output = await this.run(['--flat-playlist', '--dump-single-json', '--', `ytsearch${limit}:${text}`], { signal, timeout: 30_000 });
    return searchResult.parse(JSON.parse(output)).entries.filter(entry => videoIdPattern.test(entry.id) && entry.title).map(entry => ({
      id: entry.id, title: entry.title!.slice(0, 300), channel: (entry.channel ?? entry.uploader)?.slice(0, 200) ?? null,
      durationSeconds: entry.duration ?? null, viewCount: entry.view_count ?? null, liveStatus: entry.live_status ?? null,
    }));
  }

  // Prefers AAC in m4a, which every browser plays; Opus in webm is the fallback.
  async audioStream(videoId: string, signal?: AbortSignal): Promise<AudioStream> {
    if (!videoIdPattern.test(videoId)) throw new YoutubeProviderError('invalid_youtube_url', 400, false);
    const output = await this.run(['-J', '--no-playlist', '-f', 'bestaudio[ext=m4a][protocol=https]/bestaudio[protocol=https]', '--', `https://www.youtube.com/watch?v=${videoId}`], { signal, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 });
    const format = audioFormat.safeParse(JSON.parse(output));
    if (!format.success || (format.data.vcodec && format.data.vcodec !== 'none')) throw new YoutubeProviderError('youtube_no_audio_format', 404, false);
    const url = new URL(format.data.url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googlevideo.com')) throw new YoutubeProviderError('youtube_stream_unavailable', 502, true);
    const expire = Number(url.searchParams.get('expire')) * 1000;
    return {
      url: url.toString(), headers: format.data.http_headers,
      mimeType: format.data.ext === 'webm' ? 'audio/webm' : 'audio/mp4',
      size: format.data.filesize ?? null,
      // Refresh ten minutes early so a long pause never resumes on a dead URL.
      expiresAt: Number.isFinite(expire) && expire > 0 ? expire - 10 * 60_000 : Date.now() + 60 * 60_000,
    };
  }
}
