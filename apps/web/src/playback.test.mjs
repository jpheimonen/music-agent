import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { PlaybackController } from './playback.ts';

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
  await player.playLocal(local('a'));
  const first = FakeAudio.instances[0];
  assert.equal(first.src, `/api/v1/media/local/${encodeURIComponent(local('a').id)}`);
  assert.equal(player.snapshot().status, 'playing');
  await player.playLocal(local('b'));
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

test('YouTube state callbacks from a destroyed iframe are ignored', async () => {
  let callback;
  let destroyed = false;
  globalThis.document = { createElement: () => ({}) };
  window.YT = {
    Player: class {
      constructor(_element, options) {
        callback = options.events.onStateChange;
        options.events.onReady();
      }
      playVideo() {}
      pauseVideo() {}
      stopVideo() {}
      destroy() { destroyed = true; }
      setVolume() {}
      mute() {}
      unMute() {}
      getCurrentTime() { return 0; }
      getDuration() { return 0; }
      seekTo() {}
    },
  };
  const host = { replaceChildren() {}, append() {} };
  globalThis.location = { origin: 'http://localhost' };
  const player = new PlaybackController();
  player.setYoutubeHost(host);
  await player.playYoutube({ id: 'youtube:abcdefghijk', source: 'youtube', title: 'Video', artist: null, availability: 'available' });
  callback({ data: 1 });
  assert.equal(player.snapshot().status, 'playing');
  player.stop();
  callback({ data: 1 });
  assert.equal(destroyed, true);
  assert.equal(player.snapshot().status, 'stopped');
  player.dispose();
});
