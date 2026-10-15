import test from 'node:test';
import assert from 'node:assert/strict';
import { watchStationMetadata } from './radio-metadata.ts';

const now = Date.parse('2026-10-15T14:40:00Z');
const current = (stationId = 'kexp', ttl = 90_000) => ({ stationId, status: 'current', kind: 'track', title: 'Title', artist: 'Artist', checkedAt: new Date(now).toISOString(), startedAt: null, expiresAt: new Date(now + ttl).toISOString(), sourceUrl: 'https://www.kexp.org/playlist/' });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function clock() {
  let time = now, id = 0;
  const pending = new Map();
  return {
    now: () => time,
    setTimeout: (callback, delay) => { pending.set(++id, { at: time + delay, callback }); return id; },
    clearTimeout: id => pending.delete(id),
    async advance(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        time = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
        await flush();
      }
      time = end;
    },
    pending,
  };
}

test('a title expires even when the next metadata request is still pending', async () => {
  const fake = clock(), received = [];
  let calls = 0;
  const stop = watchStationMetadata('kexp', data => received.push(data), async () => ++calls === 1 ? current() : new Promise(() => {}), fake);
  await flush();
  assert.equal(received.at(-1).status, 'current');
  await fake.advance(90_000);
  assert.equal(calls, 2);
  assert.equal(received.at(-1).status, 'stale');
  assert.equal(received.at(-1).title, undefined);
  stop();
  assert.equal(fake.pending.size, 0);
});

test('stop or retune aborts polling and ignores a late response from the old station', async () => {
  const fake = clock(), received = [];
  let resolve, signal;
  const stop = watchStationMetadata('kexp', data => received.push(data), (_id, abort) => { signal = abort; return new Promise(done => { resolve = done; }); }, fake);
  stop();
  assert.equal(signal.aborted, true);
  resolve(current());
  await flush();
  assert.deepEqual(received.map(data => data.status), ['loading']);
  assert.equal(fake.pending.size, 0);
});

test('already expired or mismatched station data is never displayed as current', async () => {
  for (const data of [current('kexp', -1), current('nts-1')]) {
    const received = [];
    const stop = watchStationMetadata('kexp', item => received.push(item), async () => data, clock());
    await flush();
    assert.notEqual(received.at(-1).status, 'current');
    stop();
  }
});

test('unsupported metadata stops polling while a failed request can recover', async () => {
  const fake = clock(), received = [];
  let calls = 0;
  const stop = watchStationMetadata('kexp', data => received.push(data), async () => {
    calls++;
    if (calls === 1) throw new TypeError('offline');
    return current();
  }, fake);
  await flush();
  assert.equal(received.at(-1).status, 'unavailable');
  await fake.advance(30_000);
  assert.equal(received.at(-1).status, 'current');
  stop();
  const stopUnsupported = watchStationMetadata('yle1', () => {}, async () => ({ stationId: 'yle1', status: 'unsupported', checkedAt: new Date(now).toISOString(), sourceUrl: null }), fake);
  await flush();
  assert.equal(fake.pending.size, 0);
  stopUnsupported();
});

test('default timers do not receive the helper clock as their browser receiver', async () => {
  const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
  const checkReceiver = receiver => assert.ok(receiver === undefined || receiver === globalThis, 'browser timers reject a custom receiver');
  try {
    globalThis.setTimeout = function () { checkReceiver(this); return 1; };
    globalThis.clearTimeout = function () { checkReceiver(this); };
    const received = [];
    const stop = watchStationMetadata('kexp', data => received.push(data), async () => ({ ...current(), expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    await flush();
    assert.equal(received.at(-1).status, 'current');
    stop();
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});
