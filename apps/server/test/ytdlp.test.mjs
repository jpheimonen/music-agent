import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { YtDlp, installYtDlp } from '../dist/ytdlp.js';

// A stand-in for yt-dlp that logs its arguments and answers like the real one.
const fakeYtDlp = log => `#!/usr/bin/env node
const args = process.argv.slice(2);
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args.includes('--version')) { console.log('2026.08.19'); process.exit(0); }
const target = args[args.length - 1];
if (args.includes('--flat-playlist')) {
  console.log(JSON.stringify({ entries: [
    { id: 'KphlVeJX6fE', title: 'Transilvanian Hunger (Studio)', channel: 'Darkthrone - Topic', duration: 370, view_count: 4624296, live_status: null },
    { id: 'not-a-video-id', title: 'A channel, not a video' },
  ] }));
  process.exit(0);
}
if (target.endsWith('v=AAAAAAAAAAA')) { console.error('ERROR: [youtube] AAAAAAAAAAA: Video unavailable'); process.exit(1); }
if (target.endsWith('v=BBBBBBBBBBB')) { console.log(JSON.stringify({ url: 'https://evil.example/audio', ext: 'm4a', vcodec: 'none' })); process.exit(0); }
console.log(JSON.stringify({ url: 'https://rr1---sn-test.googlevideo.com/videoplayback?expire=2000000000&id=1', ext: 'm4a', filesize: 123, vcodec: 'none', http_headers: { 'User-Agent': 'UA' } }));
`;

test('yt-dlp runs with the server\'s Node, fixed options and an end-of-options marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'music-ytdlp-'));
  try {
    const log = join(dir, 'args.log');
    const binary = join(dir, 'yt-dlp');
    await writeFile(binary, fakeYtDlp(log), { mode: 0o755 });
    const ytdlp = new YtDlp({ toolsDir: join(dir, 'tools'), binary });
    await ytdlp.start();
    assert.deepEqual(ytdlp.state, { state: 'ready', version: '2026.08.19' });

    const results = await ytdlp.search('-Darkthrone\n Transilvanian Hunger', 8);
    assert.deepEqual(results, [{ id: 'KphlVeJX6fE', title: 'Transilvanian Hunger (Studio)', channel: 'Darkthrone - Topic', durationSeconds: 370, viewCount: 4624296, liveStatus: null }]);
    const stream = await ytdlp.audioStream('KphlVeJX6fE');
    assert.equal(stream.mimeType, 'audio/mp4');
    assert.deepEqual(stream.headers, { 'User-Agent': 'UA' });
    assert.equal(stream.expiresAt, 2_000_000_000_000 - 600_000, 'refreshed ten minutes before YouTube expires it');

    await assert.rejects(ytdlp.audioStream('AAAAAAAAAAA'), error => error.code === 'youtube_video_unavailable' && error.status === 404);
    await assert.rejects(ytdlp.audioStream('BBBBBBBBBBB'), error => error.code === 'youtube_stream_unavailable');
    await assert.rejects(ytdlp.audioStream('../../etc/x'), error => error.code === 'invalid_youtube_url');

    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const search = calls.find(args => args.includes('--flat-playlist'));
    assert.deepEqual(search.slice(0, 5), ['--ignore-config', '--no-warnings', '--no-progress', '--js-runtimes', `node:${process.execPath}`]);
    assert.deepEqual(search.slice(-2), ['--', 'ytsearch8:-Darkthrone  Transilvanian Hunger']);
    assert.ok(calls.every(args => !args.includes('--update')), 'a person\'s own yt-dlp is never updated by the app');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the managed copy is installed only when it matches the release checksum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'music-ytdlp-install-'));
  try {
    const script = fakeYtDlp(join(dir, 'args.log'));
    const release = (sum) => async (url, init) => {
      if (String(url).endsWith('/releases/latest')) {
        assert.equal(init.redirect, 'manual');
        return new Response(null, { status: 302, headers: { location: 'https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19' } });
      }
      if (String(url).endsWith('/download/2026.08.19/yt-dlp')) return new Response(script);
      if (String(url).endsWith('/download/2026.08.19/SHA2-256SUMS')) return new Response(`${sum}  yt-dlp.exe\n${sum === 'bad' ? '0'.repeat(64) : sum}  yt-dlp\n`);
      return new Response('missing', { status: 404 });
    };
    await assert.rejects(installYtDlp(join(dir, 'rejected'), release('bad')), error => error.code === 'ytdlp_checksum_mismatch');
    await assert.rejects(stat(join(dir, 'rejected')), { code: 'ENOENT' });

    const good = createHash('sha256').update(script).digest('hex');
    const ytdlp = new YtDlp({ toolsDir: join(dir, 'tools'), request: release(good) });
    await ytdlp.start();
    ytdlp.stop();
    assert.equal(ytdlp.state.state, 'ready');
    assert.equal(await readFile(join(dir, 'tools', 'yt-dlp'), 'utf8'), script);
    assert.equal((await stat(join(dir, 'tools', 'yt-dlp'))).mode & 0o777, 0o755);
    assert.ok(Date.parse(await readFile(join(dir, 'tools', 'yt-dlp.checked'), 'utf8')) > Date.now() - 60_000, 'a fresh install counts as checked today');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a missing yt-dlp is reported instead of breaking the server', async () => {
  const ytdlp = new YtDlp({ toolsDir: tmpdir(), binary: '/nonexistent/yt-dlp' });
  await ytdlp.start();
  assert.deepEqual(ytdlp.state, { state: 'unavailable', reason: 'ytdlp_unavailable' });
  await assert.rejects(ytdlp.search('anything', 3), error => error.code === 'ytdlp_unavailable' && error.status === 503);
});
