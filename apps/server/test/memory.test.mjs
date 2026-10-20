import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DjMemory } from '../dist/memory.js';

const track = { id: 'youtube:abcdefghijk', source: 'youtube', title: 'Song', artist: { id: 'name:band', displayName: 'Band', confidence: 'medium', provenance: 'dj_pick' }, availability: 'available' };

test('an unreadable memory file is kept aside, not overwritten', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'music-memory-'));
  try {
    await writeFile(join(dir, 'dj-memory.json'), '{"schemaVersion":1,"notes":"broken"');
    const memory = await DjMemory.open(dir);
    assert.deepEqual(memory.snapshot(), { notes: [], conversation: [] });
    const kept = (await readdir(dir)).filter(name => name.startsWith('dj-memory.invalid-'));
    assert.equal(kept.length, 1);
    assert.equal(await readFile(join(dir, kept[0]), 'utf8'), '{"schemaVersion":1,"notes":"broken"');
    await memory.recordPlay({ media: track, outcome: 'finished', listenedSeconds: 200.4, durationSeconds: 201 });
    assert.deepEqual((await DjMemory.open(dir)).recentPlays(5).map(play => [play.title, play.artist, play.outcome, play.listenedSeconds]), [['Song', 'Band', 'finished', 200]]);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('history is bounded and notes can be removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'music-memory-bounds-'));
  try {
    const memory = await DjMemory.open(dir);
    await Promise.all(Array.from({ length: 305 }, (_, index) => memory.recordPlay({ media: { ...track, title: `Song ${index}` }, outcome: 'skipped', listenedSeconds: index, durationSeconds: null })));
    const plays = memory.recentPlays(1000);
    assert.equal(plays.length, 300);
    assert.equal(plays.at(-1).title, 'Song 304', 'concurrent writes keep their order');
    await memory.recordExchange({ you: 'Hi', reply: 'Hello', suggestions: [], addNotes: ['Loves drone', 'loves  DRONE '], removeNoteIds: [] });
    assert.deepEqual(memory.notes.map(note => note.text), ['Loves drone']);
    await memory.removeNote(memory.notes[0].id);
    await memory.clearConversation();
    assert.deepEqual((await DjMemory.open(dir)).snapshot(), { notes: [], conversation: [] });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('imported notes replace the current ones and keep the conversation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'music-memory-import-'));
  try {
    const memory = await DjMemory.open(dir);
    await memory.recordExchange({ you: 'hi', reply: 'Hello', suggestions: [], addNotes: ['Likes jazz'], removeNoteIds: [] });
    const notes = [{ id: '3f1c2a52-8a43-4c4b-9a35-0b7f7f0d2d11', text: 'Loves Nick Drake', createdAt: '2026-01-01T00:00:00.000Z' }];
    await memory.replaceNotes(notes);
    const reopened = await DjMemory.open(dir);
    assert.deepEqual(reopened.notes, notes);
    assert.equal(reopened.conversation.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
