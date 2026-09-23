import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEvidenceCollector, canonicalVideoUrl } from '../dist/search-evidence.mjs';

const result = { title:'Sebastian Zawadzki Nordic Trio - YouTube', url:'https://www.youtube.com/watch?v=jt43N-PhrVc' };
const event = (id='search-4',results=[result],query='') => ({type:'item.completed',item:{type:'web_search',id,query,results}});

test('sanitized completed-search fixture accepts one member and rejects model-only IDs', () => {
  const collector=new SearchEvidenceCollector('0.156.1');
  collector.add(event());
  const candidates=collector.candidates({candidates:[
    {videoId:'jt43N-PhrVc',watchUrl:result.url,title:'model title',why_relevant:'Nordic jazz'},
    {videoId:'MD--5xBt50M',watchUrl:'https://www.youtube.com/watch?v=MD--5xBt50M'},
    {videoId:'QF9x22eDZ7M',watchUrl:'https://www.youtube.com/watch?v=QF9x22eDZ7M'},
    {videoId:'ZZZZZZZZZZZ',watchUrl:'https://www.youtube.com/watch?v=ZZZZZZZZZZZ'},
  ]});
  assert.deepEqual(candidates.map(x=>x.videoId),['jt43N-PhrVc']);
  assert.equal(candidates[0].eventQuery,null);
  assert.equal(candidates[0].searchEventId,'search-4');
});

test('URL parser rejects deceptive and ambiguous URLs and canonicalizes short links', () => {
  for (const url of [
    'http://www.youtube.com/watch?v=jt43N-PhrVc',
    'https://youtube.com.evil.test/watch?v=jt43N-PhrVc',
    'https://www.youtube.com:444/watch?v=jt43N-PhrVc',
    'https://www.youtube.com/watch?v=jt43N-PhrVc&v=MD--5xBt50M',
    'https://www.youtube.com/embed/jt43N-PhrVc',
    'https://user@www.youtube.com/watch?v=jt43N-PhrVc',
    'https://youtu.be/jt43N-PhrVc/extra',
  ]) assert.equal(canonicalVideoUrl(url),null,url);
  assert.deepEqual(canonicalVideoUrl('https://youtu.be/jt43N-PhrVc?t=5'),{videoId:'jt43N-PhrVc',canonicalWatchUrl:'https://www.youtube.com/watch?v=jt43N-PhrVc'});
});

test('completed search may have empty query and empty results; missing results fail closed', () => {
  const empty=new SearchEvidenceCollector('0.156.1'); empty.add(event('empty',[],undefined));
  assert.deepEqual(empty.candidates({candidates:[]}),[]);
  const missing=new SearchEvidenceCollector('0.156.1');
  assert.throws(()=>missing.add({type:'item.completed',item:{type:'web_search',id:'missing'}}),e=>e.code==='search_provenance_unavailable');
  assert.throws(()=>new SearchEvidenceCollector('0.157.0'),e=>e.code==='unsupported_search_runtime');
});

test('event limits, duplicate IDs, mismatches, and partial invalid entries', () => {
  const collector=new SearchEvidenceCollector('0.156.1');
  collector.add(event('one',[{url:'https://evil.test/watch?v=jt43N-PhrVc'},result]));
  collector.add(event('one',[{url:'https://www.youtube.com/watch?v=MD--5xBt50M'}]));
  assert.equal(collector.completed,1);
  assert.deepEqual(collector.candidates({candidates:[{videoId:'MD--5xBt50M',watchUrl:result.url},{videoId:'jt43N-PhrVc',watchUrl:result.url},{videoId:'jt43N-PhrVc',watchUrl:result.url}]}).map(x=>x.videoId),['jt43N-PhrVc']);
  for(let i=2;i<=6;i++) collector.add(event(`event-${i}`,[]));
  assert.throws(()=>collector.add(event('event-7',[])),e=>e.code==='search_limit_exceeded');
  const oversized=new SearchEvidenceCollector('0.156.1');
  assert.throws(()=>oversized.add(event('large',[{url:'https://www.youtube.com/watch?v=jt43N-PhrVc',snippet:'x'.repeat(1024*1024)}])),e=>e.code==='search_provenance_unavailable');
});
