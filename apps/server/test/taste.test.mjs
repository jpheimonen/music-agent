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

test('exported taste imports unchanged into a fresh data directory', async () => {
  await withRepo(async (source) => {
    const id = radioSongId(song);
    await source.react({ mediaId: id, reaction: 'like', expectedRevision: 0, idempotencyKey: 'export-like-1', radioSong: song });
    await source.react({ mediaId: 'youtube:abcdefghijk', reaction: 'dislike', expectedRevision: 1, idempotencyKey: 'export-dislike-1', media: { id: 'youtube:abcdefghijk', source: 'youtube', title: 'Loud, "very" loud', artist: { id: 'name:band', displayName: 'Band', confidence: 'medium', provenance: 'dj_pick' }, availability: 'available' } });
    await source.commitSummary({ body: 'You like quiet folk.', basedOnFeedbackRevision: 2, expectedSummaryRevision: 0 });
    const exported = JSON.parse(JSON.stringify(source.exportFiles()));
    await withRepo(async (target, dir, reopen) => {
      await target.react({ mediaId: 'youtube:zzzzzzzzzzz', reaction: 'like', expectedRevision: 0, idempotencyKey: 'target-like-1' });
      const imported = await target.replaceAll(exported);
      assert.deepEqual(imported.feedback, source.snapshot().feedback);
      assert.equal(imported.summaryMarkdown, 'You like quiet folk.\n');
      assert.equal(imported.summaryStatus, 'current');
      assert.equal(imported.feedbackRevision, 2);
      assert.equal(await readFile(join(dir, 'likes.csv'), 'utf8'), exported.files['likes.csv']);
      assert.equal(await readFile(join(dir, 'dislikes.csv'), 'utf8'), exported.files['dislikes.csv']);
      const again = await reopen();
      assert.deepEqual(again.snapshot(), imported);
      await again.react({ mediaId: id, reaction: 'neutral', expectedRevision: 2, idempotencyKey: 'target-unlike-1' });
    });
  });
});

test('an imported summary that was out of date is rewritten from the imported reactions', async () => {
  await withRepo(async (source) => {
    await source.commitSummary({ body: 'Old notes.', basedOnFeedbackRevision: 0, expectedSummaryRevision: 0 });
    await source.react({ mediaId: radioSongId(song), reaction: 'like', expectedRevision: 0, idempotencyKey: 'stale-like-1', radioSong: song });
    const exported = source.exportFiles();
    await withRepo(async (target) => {
      const imported = await target.replaceAll(exported);
      assert.equal(imported.summaryStatus, 'pending');
      assert.equal(imported.summaryMarkdown, 'Old notes.\n');
    });
  });
});

test('an invalid taste file is rejected and the current taste is kept', async () => {
  await withRepo(async (repo, dir) => {
    await repo.react({ mediaId: radioSongId(song), reaction: 'like', expectedRevision: 0, idempotencyKey: 'keep-like-1', radioSong: song });
    const before = await readFile(join(dir, 'likes.csv'), 'utf8');
    const good = repo.exportFiles();
    const broken = [
      { ...good.files, 'likes.csv': 'not,a,taste,file\n' },
      { ...good.files, 'musical_taste.md': 'no front matter' },
      { ...good.files, 'dislikes.csv': good.files['likes.csv'] },
    ];
    for (const files of broken) await assert.rejects(repo.replaceAll({ files, feedbackRevision: 1 }), error => error.code === 'invalid_import');
    assert.equal(await readFile(join(dir, 'likes.csv'), 'utf8'), before);
    assert.equal(repo.snapshot().feedbackRevision, 1);
  });
});

test('importing taste without a summary shows no summary', async () => {
  await withRepo(async (source) => {
    const exported = source.exportFiles();
    await withRepo(async (target) => {
      await target.commitSummary({ body: 'Notes to replace.', basedOnFeedbackRevision: 0, expectedSummaryRevision: 0 });
      assert.equal((await target.replaceAll(exported)).summaryMarkdown, null);
    });
  });
});
