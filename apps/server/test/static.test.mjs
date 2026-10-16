import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const webDist = fileURLToPath(new URL('../../web/dist/', import.meta.url));
const serverEntry = fileURLToPath(new URL('../dist/index.js', import.meta.url));

// A running server must serve files that a rebuild adds to web/dist, such as new icons.
// Before this, the server only knew the files present at startup and returned 404 for the rest.
test('serves web files added after the server started', { skip: !existsSync(webDist) && 'web app is not built' }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'music-static-'));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const name = `added-after-start-${process.pid}.txt`;
  const server = spawn(process.execPath, [serverEntry], {
    env: { PATH: process.env.PATH, HOME: base, MUSIC_PORT: String(port), MUSIC_DATA_DIR: base, MUSIC_CODEX_HOME: join(base, 'codex'), MUSIC_CODEX_BIN: '/bin/false', MUSIC_YTDLP_BIN: '/bin/false' },
    stdio: 'ignore',
  });
  t.after(async () => { server.kill(); await rm(join(webDist, name), { force: true }); await rm(base, { recursive: true, force: true }); });
  const url = path => `http://127.0.0.1:${port}${path}`;
  for (let attempt = 0; ; attempt++) {
    try { await fetch(url('/api/v1/capabilities')); break; }
    catch (error) { if (attempt > 100) throw error; await new Promise(done => setTimeout(done, 100)); }
  }
  await writeFile(join(webDist, name), 'added');
  const added = await fetch(url(`/${name}`));
  assert.equal(added.status, 200);
  assert.equal(await added.text(), 'added');
  assert.equal((await fetch(url('/favicon.ico'))).headers.get('content-type'), 'image/vnd.microsoft.icon');
  const missing = await fetch(url('/missing-file.txt'));
  assert.equal(missing.status, 404);
  const missingApi = await fetch(url('/api/v1/missing'));
  assert.equal(missingApi.status, 404);
  assert.equal((await missingApi.json()).error.code, 'not_found');
});
