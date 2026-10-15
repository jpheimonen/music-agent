import test from 'node:test';
import assert from 'node:assert/strict';
import { stationCatalog, stationId, stationDescriptor, stationResolution, stationNowPlaying } from '@music/contracts';
import { stationDescriptors, resolveStation } from '../dist/stations.js';
import { StationNowPlayingService } from '../dist/station-now-playing.js';

const now = Date.parse('2026-10-15T14:40:00Z');
const iso = offset => new Date(now + offset).toISOString();
const json = (body, headers = {}, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const kexp = (offset = -30_000) => ({ results: [{ play_type: 'trackplay', song: 'River of Deceit', artist: 'Mad Season', airdate: iso(offset) }] });

test('all curated stations have consistent IDs, descriptions and HTTPS resolutions', () => {
  const descriptors = stationDescriptors();
  assert.equal(descriptors.length, 22);
  assert.deepEqual(descriptors.map(station => station.stationId), stationId.options);
  for (const station of descriptors) {
    stationDescriptor.parse(station);
    assert.equal(station.label, stationCatalog[station.stationId].label);
    assert.ok(stationCatalog[station.stationId].note.length > 15);
    const resolved = stationResolution.parse(resolveStation({ stationOverrides: {} }, station.stationId));
    assert.equal(new URL(resolved.url).protocol, 'https:');
    assert.equal(new URL(resolved.url).username, '');
  }
  assert.equal(resolveStation({ stationOverrides: { kexp: 'https://example.com/custom' } }, 'kexp').url, 'https://example.com/custom');
});

test('KEXP uses a fixed endpoint, bounded request, cache and shared in-flight work', async () => {
  let count = 0;
  let time = now;
  const service = new StationNowPlayingService(async (url, init) => {
    count++;
    assert.equal(url, 'https://api.kexp.org/v2/plays/?limit=1');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    return json(kexp());
  }, () => time);
  const [a, b] = await Promise.all([service.get('kexp'), service.get('kexp')]);
  stationNowPlaying.parse(a);
  assert.equal(a.status, 'current');
  assert.equal(a.title, 'River of Deceit');
  assert.deepEqual(a, b);
  await service.get('kexp');
  assert.equal(count, 1);
  time += 31_000;
  await service.get('kexp');
  assert.equal(count, 2);
});

test('old or future KEXP records and stale HTTP caches cannot claim current tracks', async () => {
  for (const response of [json(kexp(-20 * 60_000)), json(kexp(60_000)), json(kexp(), { age: '200' }), json(kexp(), { date: iso(-10 * 60_000) })]) {
    const result = await new StationNowPlayingService(async () => response, () => now).get('kexp');
    assert.equal(result.status, 'stale');
    assert.equal(result.title, undefined);
  }
});

test('talk breaks clear a previously reported KEXP track and errors never extend it', async () => {
  let time = now;
  let next = () => json(kexp());
  const service = new StationNowPlayingService(async () => next(), () => time);
  assert.equal((await service.get('kexp')).status, 'current');
  time += 31_000;
  next = () => json({ results: [{ play_type: 'airbreak', song: null, artist: null, airdate: iso(0) }] });
  assert.equal((await service.get('kexp')).status, 'unavailable');
  time += 31_000;
  next = () => { throw new TypeError('offline'); };
  assert.equal((await service.get('kexp')).status, 'unavailable');
});

test('Radio Helsinki extracts current song or programme as text and decodes entities', async () => {
  const get = html => new StationNowPlayingService(async () => new Response(html, { headers: { 'content-type': 'text/html' } }), () => now).get('radio-helsinki');
  const song = await get('<span class="current-song-title">A &amp; B &#x266b;</span><span class="current-song-artist"><b>Artist</b></span>');
  assert.equal(song.title, 'A & B ♫');
  assert.equal(song.artist, 'Artist');
  assert.equal(song.kind, 'track');
  const programme = await get('<h2 class="current-program-title">Live show</h2>');
  assert.equal(programme.kind, 'programme');
  assert.equal(programme.artist, null);
  assert.equal((await get('<html>New markup without current information</html>')).status, 'unavailable');
});

test('FIP chooses the current song by its time range, not payload order', async () => {
  const step = (title, start, end) => ({ title, authors: 'Musician', embedType: 'song', start: (now + start) / 1000, end: (now + end) / 1000 });
  const result = await new StationNowPlayingService(async () => json({ steps: { future: step('Next', 60_000, 180_000), old: step('Past', -300_000, -60_000), live: step('Present', -60_000, 20_000) } }), () => now).get('fip');
  assert.equal(result.title, 'Present');
  assert.equal(result.expiresAt, iso(20_000));
  const stale = await new StationNowPlayingService(async () => json({ steps: { old: step('Past', -300_000, -60_000) } }), () => now).get('fip');
  assert.equal(stale.status, 'stale');
});

test('NTS looks up the selected channel and reports programmes, never invented tracks', async () => {
  const payload = { results: ['2', '1'].map(channel_name => ({ channel_name, now: { broadcast_title: `Show ${channel_name} &amp; friends`, start_timestamp: iso(-60_000), end_timestamp: iso(10_000) } })) };
  for (const channel of ['1', '2']) {
    const result = await new StationNowPlayingService(async () => json(payload, { 'content-type': 'application/vnd.live-list+json; charset=utf-8', age: '400', date: iso(-400_000) }), () => now).get(`nts-${channel}`);
    assert.equal(result.kind, 'programme');
    assert.equal(result.title, `Show ${channel} & friends`);
    assert.equal(result.expiresAt, iso(10_000));
    assert.equal(result.artist, null);
  }
});

test('Radio Paradise expiry is bounded by both remaining track time and freshness', async () => {
  for (const [remaining, expiry] of [[10, 10_000], [200, 90_000]]) {
    const result = await new StationNowPlayingService(async () => json({ title: 'Avalanche', artist: 'Grace Ives', time: remaining }), () => now).get('radio-paradise');
    assert.equal(result.expiresAt, iso(expiry));
  }
});

test('HTTP cache age reduces relative song duration instead of extending an old title', async () => {
  const service = new StationNowPlayingService(async () => json({ title: 'Song', artist: 'Artist', time: 60 }, { age: '45', date: iso(-45_000) }), () => now);
  assert.equal((await service.get('radio-paradise')).expiresAt, iso(15_000));
  const ended = await new StationNowPlayingService(async () => json({ title: 'Song', artist: 'Artist', time: 30 }, { age: '45' }), () => now).get('radio-paradise');
  assert.equal(ended.status, 'stale');
});

test('unsupported stations and replacement streams do not request misleading metadata', async () => {
  const service = new StationNowPlayingService(async () => { assert.fail('must not fetch'); }, () => now, { kexp: 'https://example.com/replacement' });
  for (const id of ['yle1', 'wfmu', 'worldwide-fm', 'kexp', 'radio-nova', 'wwoz', 'cashmere-radio', 'oe1']) assert.equal((await service.get(id)).status, 'unsupported');
});

test('provider errors, malformed bodies, oversized bodies and timeouts are unavailable', async () => {
  const responses = [
    () => json({}, {}, 403),
    () => json(kexp(), { 'content-type': 'text/html' }),
    () => json(kexp(), { age: 'invalid' }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => json({ invalid: true }),
    () => json({ padding: 'x'.repeat(513 * 1024) }),
    () => { throw new DOMException('timeout', 'TimeoutError'); },
  ];
  for (const response of responses) {
    const result = await new StationNowPlayingService(async () => response(), () => now).get('kexp');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.title, undefined);
  }
});

test('unexpected internal errors remain visible', async () => {
  await assert.rejects(new StationNowPlayingService(async () => { throw new Error('implementation bug'); }, () => now).get('kexp'), /implementation bug/);
});

// A stream that carries ICY metadata: `interval` bytes of audio, a length byte, then the padded metadata.
const icyStream = (title, encoding = 'utf8', interval = 16) => {
  const metadata = Buffer.from(`StreamTitle='${title}';StreamUrl='';`, encoding);
  const blocks = Math.ceil(metadata.length / 16);
  const body = Buffer.concat([Buffer.alloc(interval, 0xff), Buffer.from([blocks]), metadata, Buffer.alloc(blocks * 16 - metadata.length), Buffer.alloc(32, 0xff)]);
  return new Response(body, { headers: { 'content-type': 'audio/mpeg', 'icy-metaint': String(interval) } });
};

test('stations that name tracks inside the stream report artist and title from the stream itself', async () => {
  let request;
  const service = new StationNowPlayingService(async (url, init) => { request = { url, init }; return icyStream("Tanika Charles - Don't like you anymore"); }, () => now);
  const result = stationNowPlaying.parse(await service.get('radio-meuh'));
  assert.equal(request.url, resolveStation({ stationOverrides: {} }, 'radio-meuh').url);
  assert.equal(request.init.headers['Icy-MetaData'], '1');
  assert.deepEqual([result.status, result.kind, result.artist, result.title], ['current', 'track', 'Tanika Charles', "Don't like you anymore"]);
  assert.equal(result.startedAt, null);
  assert.equal(result.expiresAt, iso(90_000), 'a stream title expires like an undated report');
  const intergalactic = await new StationNowPlayingService(async () => icyStream('Colbourne - In The Big City | Special Mix | The CBS Archives'), () => now).get('intergalactic-fm');
  assert.deepEqual([intergalactic.artist, intergalactic.title], ['Colbourne', 'In The Big City']);
  const latin = await new StationNowPlayingService(async () => icyStream('Björk - Jóga', 'latin1'), () => now).get('radio-swiss-jazz');
  assert.deepEqual([latin.artist, latin.title], ['Björk', 'Jóga']);
});

test('show-based stations report the programme, and placeholders or missing metadata are unavailable', async () => {
  const show = await new StationNowPlayingService(async () => icyStream('Rogue Planets - Resonance 104.4FM'), () => now).get('resonance-fm');
  assert.deepEqual([show.status, show.kind, show.title, show.artist], ['current', 'programme', 'Rogue Planets', null]);
  for (const placeholder of [' - ', '', 'Airtime - offline']) {
    const result = await new StationNowPlayingService(async () => icyStream(placeholder), () => now).get('noods-radio');
    assert.equal(result.status, 'unavailable');
  }
  const noMetadata = await new StationNowPlayingService(async () => new Response(Buffer.alloc(64), { headers: { 'content-type': 'audio/mpeg' } }), () => now).get('dublab');
  assert.equal(noMetadata.status, 'unavailable');
  const ended = await new StationNowPlayingService(async () => new Response(Buffer.alloc(8), { headers: { 'icy-metaint': '16' } }), () => now).get('dublab');
  assert.equal(ended.status, 'unavailable');
});
