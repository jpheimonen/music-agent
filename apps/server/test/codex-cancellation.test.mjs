import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexRunner } from '../dist/codex.js';
import { loadConfig } from '../dist/config.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForPid(path) {
  for (let i=0;i<100;i++) {
    try { return Number(await readFile(path,'utf8')); } catch { await delay(20); }
  }
  throw new Error('Synthetic active tool did not start');
}
function running(pid) {
  try { const state = requireState(pid); return state !== 'Z' && state !== 'X'; } catch { return false; }
}
function requireState(pid) {
  const text = readFileSync(`/proc/${pid}/stat`,'utf8');
  return text.slice(text.lastIndexOf(')')+2).split(' ')[0];
}

test('cancelling an active synthetic CLI reaps its descendant before releasing the runner', async () => {
  if (process.platform !== 'linux') return;
  const dir = await mkdtemp(join(tmpdir(),'music-cancel-'));
  const pidPath = join(dir,'tool.pid');
  const fakeCli = join(dir,'fake-codex');
  const script = `#!/usr/bin/env node\nconst {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); fs.writeFileSync(${JSON.stringify(pidPath)},String(child.pid)); setInterval(()=>{},1000);\n`;
  await writeFile(fakeCli,script,{mode:0o700});
  const config = loadConfig({ MUSIC_DATA_DIR:dir, MUSIC_CODEX_HOME:join(dir,'home') });
  const runner = new CodexRunner(config);
  runner.capability.state='ready'; runner.binary=fakeCli;
  const abort = new AbortController();
  try {
    const pending = runner.run('synthesizeTaste',{synthetic:true},abort.signal);
    const childPid = await waitForPid(pidPath);
    assert.equal(running(childPid),true);
    abort.abort();
    await assert.rejects(pending,error => error.code === 'cancelled');
    for (let i=0;i<50 && running(childPid);i++) await delay(20);
    assert.equal(running(childPid),false);
    assert.equal(runner.capability.state,'ready');
  } finally { abort.abort(); await runner.stop(); await rm(dir,{recursive:true,force:true}); }
});

test('queued DJ work takes priority over artist description', async () => {
  const runner = new CodexRunner(loadConfig({MUSIC_DATA_DIR:tmpdir()}));
  const order=[];
  await runner.acquire('synthesizeTaste');
  const artist=runner.acquire('describeArtist').then(() => order.push('artist'));
  const dj=runner.acquire('selectCandidates').then(() => order.push('dj'));
  runner.release();
  await dj;
  assert.deepEqual(order,['dj']);
  runner.release();
  await artist;
  assert.deepEqual(order,['dj','artist']);
  runner.release();
  await runner.stop();
});
