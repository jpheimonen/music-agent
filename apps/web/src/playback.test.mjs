import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { PlaybackController, trackFailed } from './playback.ts';

const local = id => ({
  id: `local:${id.repeat(64)}`,
  source: 'local',
  title: id,
  artist: null,
  availability: 'available',
});

class FakeAudio {
  static instances = [];
  listeners = new Map();
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = 100;
  paused = true;
  src = '';
  constructor(src = '') {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  addEventListener(name, listener) {
    const list = this.listeners.get(name) || [];
    list.push(listener);
    this.listeners.set(name, list);
  }
  emit(name) {
    for (const listener of this.listeners.get(name) || []) listener();
  }
  async play() {
    this.paused = false;
    this.emit('playing');
  }
  pause() {
    this.paused = true;
    this.emit('pause');
  }
  removeAttribute(name) {
    if (name === 'src') this.src = '';
  }
  load() {}
  canPlayType() { return ''; }
}

beforeEach(() => {
  FakeAudio.instances = [];
  globalThis.Audio = FakeAudio;
  globalThis.window = { setTimeout, clearTimeout, setInterval, clearInterval };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: undefined } });
});
afterEach(() => {
  delete globalThis.Audio;
  delete globalThis.window;
  delete globalThis.navigator;
  delete globalThis.document;
  delete globalThis.location;
});

test('starting a new local item stops and detaches the previous element', async () => {
  const player = new PlaybackController();
  await player.playTrack(local('a'));
  const first = FakeAudio.instances[0];
  assert.equal(first.src, `/api/v1/media/local/${encodeURIComponent(local('a').id)}`);
  assert.equal(player.snapshot().status, 'playing');
  await player.playTrack(local('b'));
  assert.equal(first.paused, true);
  assert.equal(first.src, '');
  assert.equal(player.snapshot().status, 'playing');
  assert.equal(FakeAudio.instances.filter(audio => !audio.paused).length, 1);
  first.emit('error');
  first.emit('ended');
  assert.equal(player.snapshot().status, 'playing', 'late old events must not change current playback');
  player.dispose();
  assert.equal(FakeAudio.instances[1].paused, true);
});

test('station stop detaches audio and late live events cannot revive it', async () => {
  const player = new PlaybackController();
  await player.playStation({ stationId: 'kexp', playbackKind: 'direct-audio', url: 'https://example.com/stream', expiresAt: null, sourceRevision: '1' });
  const audio = FakeAudio.instances[0];
  assert.equal(player.snapshot().status, 'playing');
  player.stop();
  audio.emit('playing');
  assert.equal(player.snapshot().status, 'stopped');
  assert.equal(audio.src, '');
  player.dispose();
});

test('primary play restarts a retained local item after teardown and resumes a pause', async () => {
  const player = new PlaybackController();
  const item = local('a');
  await player.playOrResume(item);
  const first = FakeAudio.instances[0];
  player.pause();
  assert.equal(player.snapshot().status, 'paused');
  await player.playOrResume(item);
  assert.equal(FakeAudio.instances.length, 1, 'pause uses the existing element');
  player.stop(); // Source return, queue exhaustion, or a new controller on reload.
  await player.playOrResume(item);
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(FakeAudio.instances[1].paused, false);
  assert.equal(first.src, '');
  FakeAudio.instances[1].emit('error');
  assert.equal(player.snapshot().status, 'failed');
  await player.playOrResume(item);
  assert.equal(FakeAudio.instances.length, 3, 'retry replaces the failed element');
  player.dispose();

  const reloaded = new PlaybackController();
  assert.equal(reloaded.snapshot().status, 'stopped');
  assert.equal(FakeAudio.instances.length, 3, 'reloading alone must not autoplay');
  await reloaded.playOrResume(item);
  assert.equal(FakeAudio.instances.length, 4);
  reloaded.dispose();
});

test('YouTube items stream through the local server like collection files', async () => {
  const player = new PlaybackController();
  await player.playTrack({ id: 'youtube:ab-cd_efghi', source: 'youtube', title: 'Video', artist: null, availability: 'available', durationSeconds: 259 });
  const audio = FakeAudio.instances[0];
  assert.equal(audio.src, '/api/v1/media/youtube/ab-cd_efghi');
  assert.equal(player.snapshot().status, 'playing');
  player.pause();
  assert.equal(player.snapshot().status, 'paused');
  await player.playOrResume({ id: 'youtube:ab-cd_efghi', source: 'youtube', title: 'Video', artist: null, availability: 'available' });
  assert.equal(FakeAudio.instances.length, 1, 'resume keeps the same stream');
  player.dispose();
});

test('a dropped connection mid-track reconnects at the same position, at most twice', async () => {
  const player = new PlaybackController();
  const item = local('a');
  await player.playTrack(item);
  const audio = FakeAudio.instances[0];
  for (const position of [42, 80]) {
    audio.currentTime = position;
    audio.src = 'broken';
    audio.emit('error');
    assert.equal(audio.src, `/api/v1/media/local/${encodeURIComponent(item.id)}`, 'the same stream is reloaded');
    assert.equal(player.snapshot().status, 'playing');
    audio.currentTime = 0;
    audio.emit('loadedmetadata');
    assert.equal(audio.currentTime, position, 'playback continues where it stopped');
  }
  audio.currentTime = 120;
  audio.emit('error');
  assert.equal(player.snapshot().status, 'failed');
  assert.equal(player.snapshot().error, trackFailed);
  player.dispose();
});

test('a track that fails before playing anything is reported, not retried', async () => {
  const player = new PlaybackController();
  await player.playTrack(local('a'));
  FakeAudio.instances[0].emit('error');
  assert.equal(player.snapshot().status, 'failed');
  assert.equal(player.snapshot().error, trackFailed);
  assert.equal(FakeAudio.instances.length, 1);
  player.dispose();
});
