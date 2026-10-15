import test from 'node:test';
import assert from 'node:assert/strict';
import { YoutubeService, YoutubeProviderError, displayTitle, scoreCandidate } from '../dist/youtube.js';

const pick = { artist: 'Darkthrone', title: 'Transilvanian Hunger' };
const entry = (id, title, channel, durationSeconds = 360, viewCount = 1000) => ({ id, title, channel, durationSeconds, viewCount, liveStatus: null });
const stream = (id, attempt) => ({ url: `https://rr1---sn-test.googlevideo.com/videoplayback?id=${id}&attempt=${attempt}`, headers: { 'User-Agent': 'UA' }, mimeType: 'audio/mp4', size: 100, expiresAt: Date.now() + 3_600_000 });

function fakeYtdlp(entries, unavailable = new Set()) {
  const calls = { search: [], extract: [] };
  return {
    calls,
    async search(query) { calls.search.push(query); return entries; },
    async audioStream(id) {
      calls.extract.push(id);
      if (unavailable.has(id)) throw new YoutubeProviderError('youtube_video_unavailable', 404, false);
      return stream(id, calls.extract.filter(other => other === id).length);
    },
  };
}
const audio = (status = 206) => new Response(new Uint8Array([1, 2]), { status, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-1/100' } });

test('the official Topic upload outranks fan uploads, and other versions are rejected', () => {
  const topic = scoreCandidate(pick, entry('a', 'Transilvanian Hunger (Studio)', 'Darkthrone - Topic', 370, 4_600_000));
  const fan = scoreCandidate(pick, entry('b', 'Darkthrone - Transilvanian Hunger (Official Music Video)', 'NaerMataronKaiadas', 362, 2_800_000));
  assert.ok(topic > fan && fan >= 60);
  assert.ok(scoreCandidate(pick, entry('c', 'DARKTHRONE Transilvanian Hunger (Full-length,1994)', 'Extreme Metal Music', 2345)) < 60, 'a full album is not the track');
  assert.ok(scoreCandidate(pick, entry('d', 'Second To Sun – Transilvanian Hunger (Darkthrone cover)', 'Second To Sun', 264)) < 60, 'a cover is not the track');
  assert.ok(scoreCandidate(pick, entry('e', 'Darkthrone - Transilvanian Hunger (Live in Oslo)', 'Darkthrone', 380)) < topic);
  assert.equal(scoreCandidate(pick, entry('f', 'Darkthrone - Under a Funeral Moon', 'Darkthrone - Topic')), null, 'another song by the artist');
  assert.equal(scoreCandidate(pick, entry('g', 'Transilvanian Hunger', 'Some Other Band - Topic')), null, 'the same title by another artist');
  assert.ok(scoreCandidate({ artist: 'Queens of the Stone Age', title: 'No One Knows' }, entry('h', 'Queens Of The Stone Age - No One Knows (Official Music Video)', 'QueensStoneAgeVEVO', 259)) >= 100, 'compact VEVO channel names count as the artist');
  assert.ok(scoreCandidate({ artist: 'Kingston Wall', title: 'Mushrooms (Live)' }, entry('i', 'Kingston Wall - Mushrooms (Live)', 'Kingston Wall - Topic')) >= 100, 'a version the DJ asked for is not penalised');
});

test('display titles drop a repeated artist prefix and video labels', () => {
  assert.equal(displayTitle('Darkthrone - Transilvanian Hunger (Official Music Video)', 'Darkthrone'), 'Transilvanian Hunger');
  assert.equal(displayTitle('Transilvanian Hunger (Studio)', 'Darkthrone'), 'Transilvanian Hunger (Studio)');
  assert.equal(displayTitle('Other - Song [Official Audio] (Lyrics)', 'Darkthrone'), 'Other - Song');
});

test('a pick plays only when its stream opens; unavailable matches fall through to the next result', async () => {
  const ytdlp = fakeYtdlp([
    entry('live0000000', 'Darkthrone - Transilvanian Hunger (Live)', 'Darkthrone', 380),
    entry('topic000000', 'Transilvanian Hunger', 'Darkthrone - Topic', 370),
    entry('official000', 'Darkthrone - Transilvanian Hunger (Official Video)', 'Darkthrone', 362),
    entry('queued00000', 'Transilvanian Hunger', 'Darkthrone - Topic', 370),
  ], new Set(['topic000000']));
  const ranges = [];
  const service = new YoutubeService(ytdlp, async (url, init) => { ranges.push(init.headers.Range); return audio(); });
  const media = await service.findTrack(pick, id => id === 'youtube:queued00000');
  assert.equal(media.id, 'youtube:official000');
  assert.equal(media.title, 'Transilvanian Hunger');
  assert.equal(media.artist.displayName, 'Darkthrone');
  assert.equal(media.artwork, 'https://i.ytimg.com/vi/official000/mqdefault.jpg');
  assert.deepEqual(ytdlp.calls.search, ['Darkthrone - Transilvanian Hunger']);
  assert.ok(!ytdlp.calls.extract.includes('queued00000'), 'skipped IDs are never opened');
  assert.deepEqual(ranges, ['bytes=0-1']);
});

test('no matching result means no track, while broken yt-dlp is an error', async () => {
  const none = new YoutubeService(fakeYtdlp([entry('x0000000000', 'Something else', 'Nobody')]), async () => audio());
  assert.equal(await none.findTrack(pick, () => false), null);
  const broken = new YoutubeService({ async search() { throw new YoutubeProviderError('ytdlp_unavailable', 503, false); } }, async () => audio());
  await assert.rejects(broken.findTrack(pick, () => false), error => error.code === 'ytdlp_unavailable');
});

test('a refused stream URL is replaced by a fresh extraction; a working one is reused', async () => {
  const ytdlp = fakeYtdlp([]);
  const responses = [audio(403), audio(206), audio(206)];
  const urls = [];
  const service = new YoutubeService(ytdlp, async url => { urls.push(String(url)); return responses.shift(); });
  const first = await service.open('abcdefghijk', 'bytes=0-');
  assert.equal(first.response.status, 206);
  assert.deepEqual(ytdlp.calls.extract, ['abcdefghijk', 'abcdefghijk']);
  assert.match(urls[1], /attempt=2/);
  await service.open('abcdefghijk', 'bytes=10-');
  assert.equal(ytdlp.calls.extract.length, 2, 'the fresh URL is cached');
});

test('the proxy gives up after repeated refusals and only follows YouTube stream hosts', async () => {
  const refused = new YoutubeService(fakeYtdlp([]), async () => audio(403));
  await assert.rejects(refused.open('abcdefghijk'), error => error.code === 'youtube_stream_unavailable');
  const redirected = new YoutubeService(fakeYtdlp([]), async () => ({ ok: true, status: 206, url: 'https://elsewhere.example/audio', headers: new Headers(), body: null }));
  await assert.rejects(redirected.open('abcdefghijk'), error => error.code === 'youtube_stream_unavailable');
  await assert.rejects(refused.open('not-an-id'), error => error.code === 'invalid_youtube_url');
});

test('cancelling a request stops waiting for the extraction', async () => {
  const slow = { async audioStream() { await new Promise(resolve => setTimeout(resolve, 200)); return stream('abcdefghijk', 1); } };
  const service = new YoutubeService(slow, async () => audio());
  const abort = new AbortController();
  const pending = service.open('abcdefghijk', undefined, abort.signal);
  abort.abort();
  await assert.rejects(pending, error => error.code === 'cancelled');
});
