import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DjService } from '../dist/dj.js';

const first = { id:`local:${'a'.repeat(64)}`, source:'local', title:'One', artist:{id:'tag:artist',displayName:'Artist',confidence:'medium',provenance:'id3'}, availability:'available' };
const second = { id:`local:${'b'.repeat(64)}`, source:'local', title:'Two', artist:null, availability:'available' };
const request = { sessionId:'11111111-1111-4111-8111-111111111111', modeEpoch:2, source:'local', queuedIds:[], recentIds:[] };
const setup = (runner, feedback = {}) => {
  const taste = { revision:1, snapshot() { return {feedbackRevision:this.revision,summaryRevision:1,summaryMarkdown:'Ambient piano',feedback,summaryStatus:'current'}; }, agentContext() { return Object.entries(feedback).map(([mediaId,reaction]) => ({mediaId,reaction,title:'Synthetic',artist:''})); } };
  const library = { page(q,cursor) { return { items:cursor === 0 ? [first,second] : [], nextCursor:null }; } };
  return { service:new DjService(runner,library,{},taste,'/tmp'), taste };
};

test('selection IDs must be in the current candidate set', async () => {
  const runner = { async run(kind) { return kind === 'planDiscovery' ? {queries:['One']} : { selections:[{id:`local:${'c'.repeat(64)}`,reason:'Good'}] }; } };
  const {service} = setup(runner);
  await assert.rejects(service.recommend(request), error => error.code === 'invalid_agent_output');
});

test('new feedback revision invalidates in-flight output', async () => {
  let release;
  const runner = { run(kind) { return kind === 'planDiscovery' ? Promise.resolve({queries:['One']}) : new Promise(resolve => { release=resolve; }); } };
  const {service,taste} = setup(runner);
  const pending = service.recommend(request);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  taste.revision++;
  release({selections:[{id:first.id,reason:'Good'}]});
  await assert.rejects(pending,error => error.code === 'revision_conflict');
});

test('disliked and repeated IDs are not offered to Codex; accepted output keeps session identity', async () => {
  let input;
  const runner = { async run(kind,value) { if (kind === 'planDiscovery') return {queries:['Two']}; input=value; return {selections:[{id:second.id,reason:'Fits'}]}; } };
  const {service} = setup(runner,{[first.id]:'dislike'});
  const result = await service.recommend({...request,recentIds:[first.id]});
  assert.deepEqual(input.candidates.map(item => item.id),[second.id]);
  assert.equal(result.items[0].media.id,second.id);
  assert.equal(result.sessionId,request.sessionId);
  assert.equal(result.modeEpoch,2);
});

test('artist generation coalesces and persists a reusable cache record', async () => {
  const dir = await mkdtemp(join(tmpdir(),'music-artist-'));
  try {
    let calls=0;
    const runner = { async run() { calls++; await new Promise(resolve => setTimeout(resolve,10)); return {introduction:'Artist introduction',text:'Known for music.'}; } };
    const taste = { snapshot:() => ({}) };
    const library = { page:() => ({items:[first],nextCursor:null}) };
    const service = new DjService(runner,library,{},taste,dir);
    const [a,b] = await Promise.all([service.describeArtist('tag:artist'),service.describeArtist('tag:artist')]);
    assert.deepEqual(a,b); assert.equal(calls,1);
    const restarted = new DjService(runner,library,{},taste,dir);
    const cached = await restarted.describeArtist('tag:artist');
    assert.equal(cached.status,'cached'); assert.equal(calls,1);
    assert.equal((await restarted.artist('unknown')).status,'unavailable');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
