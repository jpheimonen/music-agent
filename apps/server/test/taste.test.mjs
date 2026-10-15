import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TasteRepository, radioSongId } from '../dist/taste.js';

const song = { title: 'Pink Moon', artist: 'Nick Drake' };

async function withRepo(run) {
  const dir = await mkdtemp(join(tmpdir(), 'music-taste-'));
  let repo = await TasteRepository.open(dir);
  try { await run(repo, dir, async () => { await repo.close(); repo = await TasteRepository.open(dir); return repo; }); }
  finally { await repo.close(); await rm(dir, { recursive: true, force: true }); }
}

test('a radio song gets the same ID whatever the case and spacing', () => {
  const id = radioSongId(song);
  assert.match(id, /^radio:[a-f0-9]{64}$/);
  assert.equal(radioSongId({ title: '  pink   MOON ', artist: 'nick drake' }), id);
  assert.notEqual(radioSongId({ title: 'Pink Moon', artist: null }), id);
});

test('a liked radio song is saved to likes.csv, survives a restart and reaches the DJ', async () => {
  await withRepo(async (repo, dir, reopen) => {
    const id = radioSongId(song);
    const saved = await repo.react({ mediaId: id, reaction: 'like', expectedRevision: 0, idempotencyKey: 'radio-like-1', radioSong: song });
    assert.deepEqual(saved, { mediaId: id, reaction: 'like', feedbackRevision: 1 });
    assert.match(await readFile(join(dir, 'likes.csv'), 'utf8'), new RegExp(`"1","${id}","radio","Pink Moon","Nick Drake",`));
    const again = await reopen();
    assert.equal(again.snapshot().feedback[id], 'like');
    assert.deepEqual(again.agentContext().map(({ source, title, artist, reaction }) => ({ source, title, artist, reaction })), [{ source: 'radio', title: 'Pink Moon', artist: 'Nick Drake', reaction: 'like' }]);
    await again.react({ mediaId: id, reaction: 'neutral', expectedRevision: 1, idempotencyKey: 'radio-unlike-1' });
    assert.equal(again.snapshot().feedback[id], undefined);
  });
});

test('a radio like must name the song it was given the ID for', async () => {
  await withRepo(async (repo) => {
    const id = radioSongId(song);
    await assert.rejects(repo.react({ mediaId: id, reaction: 'like', expectedRevision: 0, idempotencyKey: 'radio-like-2', radioSong: { title: 'Other', artist: null } }), /identity mismatch/);
    await assert.rejects(repo.react({ mediaId: id, reaction: 'like', expectedRevision: 0, idempotencyKey: 'radio-like-3' }), /needs the song title/);
    assert.equal(repo.snapshot().feedbackRevision, 0);
  });
});
