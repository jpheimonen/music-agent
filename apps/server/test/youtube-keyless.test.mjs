import test from 'node:test';
import assert from 'node:assert/strict';
import { YoutubeService } from '../dist/youtube.js';

const candidate = {videoId:'jt43N-PhrVc',canonicalWatchUrl:'https://www.youtube.com/watch?v=jt43N-PhrVc',searchResultUrl:'https://www.youtube.com/watch?v=jt43N-PhrVc',searchEventId:'search-4',eventQuery:null,resultTitle:'Untrusted title',whyRelevant:'Jazz'};
const response = (body,status=200,contentType='application/json') => new Response(JSON.stringify(body),{status,headers:{'content-type':contentType}});

test('oEmbed requests a fixed host, rejects redirects and uses verified display metadata', async () => {
  let calls=0;
  const service=new YoutubeService(async (url,init) => {
    calls++;
    assert.equal(url.origin,'https://www.youtube.com');
    assert.equal(url.pathname,'/oembed');
    assert.equal(url.searchParams.get('url'),candidate.canonicalWatchUrl);
    assert.equal(init.redirect,'error');
    return response({provider_name:'YouTube',title:'Verified title',author_name:'Channel'});
  });
  const first=await service.verify(candidate,'session-1');
  const second=await service.verify(candidate,'session-1');
  assert.equal(calls,1);
  assert.equal(first.media.title,'Verified title');
  assert.equal(first.media.artist,null);
  assert.equal(first.evidence.verifiedTitle,'Verified title');
  assert.equal(second.media.id,first.media.id);
});

test('404 is unavailable; transport and quota failures are errors, not empty results', async () => {
  assert.deepEqual(await new YoutubeService(async()=>response({},404)).verifyBatch([candidate],'s'),[]);
  await assert.rejects(new YoutubeService(async()=>{throw new Error('offline')}).verifyBatch([candidate],'s'),e=>e.code==='provider_unavailable');
  await assert.rejects(new YoutubeService(async()=>response({},429)).verifyBatch([candidate],'s'),e=>e.code==='provider_quota_exceeded');
});

test('malformed and oversized metadata cannot become a playable candidate', async () => {
  assert.deepEqual(await new YoutubeService(async()=>response({provider_name:'Other',title:'Wrong'})).verifyBatch([candidate],'s'),[]);
  await assert.rejects(new YoutubeService(async()=>response({provider_name:'YouTube',title:'x'.repeat(70000)})).verifyBatch([candidate],'s'),e=>e.code==='provider_invalid_response');
});

test('cancellation interrupts metadata validation', async () => {
  const abort=new AbortController(); abort.abort();
  await assert.rejects(new YoutubeService(async()=>response({provider_name:'YouTube',title:'Video'})).verifyBatch([candidate],'s',abort.signal),e=>e.code==='cancelled');
});
