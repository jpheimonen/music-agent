import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DjService } from '../dist/dj.js';
import { DjMemory } from '../dist/memory.js';

const first = { id:`local:${'a'.repeat(64)}`, source:'local', title:'One', artist:{id:'tag:artist',displayName:'Artist',confidence:'medium',provenance:'id3'}, availability:'available' };
const second = { id:`local:${'b'.repeat(64)}`, source:'local', title:'Two', artist:null, availability:'available' };
// A memory with nothing in it, for tests that are not about notes or plays.
const blank = { notes:[], conversation:[], recentPlays:() => [] };
const request = { sessionId:'11111111-1111-4111-8111-111111111111', modeEpoch:2, source:'local', queuedIds:[], recentIds:[] };
const setup = (runner, feedback = {}) => {
  const taste = { revision:1, snapshot() { return {feedbackRevision:this.revision,summaryRevision:1,summaryMarkdown:'Ambient piano',feedback,summaryStatus:'current'}; }, agentContext() { return Object.entries(feedback).map(([mediaId,reaction]) => ({mediaId,reaction,title:'Synthetic',artist:''})); } };
  const library = { page(q,cursor) { return { items:cursor === 0 ? [first,second] : [], nextCursor:null }; } };
  return { service:new DjService(runner,library,{},taste,'/tmp',blank), taste };
};

test('selection IDs must be in the current candidate set', async () => {
  const runner = { async run(kind) { return kind === 'planDiscovery' ? {queries:['One']} : { selections:[{id:`local:${'c'.repeat(64)}`,reason:'Good'}] }; } };
  const {service} = setup(runner);
  await assert.rejects(service.recommend(request), error => error.code === 'invalid_agent_output');
});

test('a dislike saved while the DJ picks drops that track instead of failing the batch', async () => {
  let release;
  const feedback = {};
  const runner = { run(kind) { return kind === 'planDiscovery' ? Promise.resolve({queries:['One']}) : new Promise(resolve => { release=resolve; }); } };
  const {service,taste} = setup(runner,feedback);
  const pending = service.recommend(request);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  feedback[first.id] = 'dislike'; taste.revision++;
  release({selections:[{id:first.id,reason:'Good'},{id:second.id,reason:'Also good'}]});
  const result = await pending;
  assert.deepEqual(result.items.map(item => item.media.id),[second.id]);
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
    const service = new DjService(runner,library,{},taste,dir,blank);
    const [a,b] = await Promise.all([service.describeArtist('tag:artist'),service.describeArtist('tag:artist')]);
    assert.deepEqual(a,b); assert.equal(calls,1);
    const restarted = new DjService(runner,library,{},taste,dir,blank);
    const cached = await restarted.describeArtist('tag:artist');
    assert.equal(cached.status,'cached'); assert.equal(calls,1);
    assert.equal((await restarted.artist('unknown')).status,'unavailable');
  } finally { await rm(dir,{recursive:true,force:true}); }
});

const youtubeMedia = (id, title, artist) => ({ id:`youtube:${id}`, source:'youtube', title, artist:{id:`name:${artist.toLowerCase()}`,displayName:artist,confidence:'medium',provenance:'dj_pick'}, availability:'available', attribution:'YouTube', artwork:`https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
const youtubeTaste = feedback => ({ snapshot() { return {feedbackRevision:1,summaryRevision:1,summaryMarkdown:'Krautrock',feedback,summaryStatus:'current'}; }, agentContext() { return []; } });

test('the DJ names tracks and only playable YouTube matches are queued, in the DJ\'s order', async () => {
  const calls = [];
  const runner = { async run(kind,input,signal,options) { calls.push({kind,input,options}); return { picks:[
    { artist:'Circle', title:'Kuivaamo', reason:'Hypnotic Finnish repetition.' },
    { artist:'Nobody', title:'Invented song', reason:'Never found.' },
    { artist:'Can', title:'Mushroom', reason:'Krautrock groove.' },
    { artist:'Neu!', title:'Hallogallo', reason:'Motorik.' },
    { artist:'Circle', title:'Kuivaamo', reason:'Duplicate.' },
    { artist:'Darkthrone', title:'Transilvanian Hunger', reason:'Heard already.' },
  ] }; } };
  const looked = [];
  const youtube = { async findTrack(pick,skip) {
    looked.push(pick.title);
    if (pick.title === 'Invented song') return null;
    if (pick.title === 'Mushroom') { await new Promise(resolve => setTimeout(resolve,20)); return youtubeMedia('mushroom000','Mushroom','Can'); }
    if (pick.title === 'Hallogallo') { assert.equal(skip('youtube:disliked000'),true,'disliked videos are skipped'); return youtubeMedia('hallogallo0','Hallogallo','Neu!'); }
    return youtubeMedia('kuivaamo000',pick.title,pick.artist);
  } };
  const service = new DjService(runner,{},youtube,youtubeTaste({'youtube:disliked000':'dislike'}),'/tmp',blank);
  const result = await service.recommend({...request,source:'youtube',quick:true,recentTracks:[{title:'Transilvanian Hunger',artist:'Darkthrone'}]});
  assert.deepEqual(result.items.map(item => item.media.id),['youtube:kuivaamo000','youtube:mushroom000','youtube:hallogallo0']);
  assert.deepEqual(result.items.map(item => item.reason),['Hypnotic Finnish repetition.','Krautrock groove.','Motorik.']);
  assert.equal(calls.length,1);
  assert.equal(calls[0].kind,'pickTracks');
  assert.deepEqual(calls[0].options,{quick:true});
  assert.equal(calls[0].input.count,5);
  assert.deepEqual(calls[0].input.recentTracks,[{title:'Transilvanian Hunger',artist:'Darkthrone'}]);
  assert.ok(!looked.includes('Transilvanian Hunger'),'recently heard songs are not looked up');
  assert.equal(looked.filter(title => title === 'Kuivaamo').length,1,'a repeated pick is looked up once');
});

test('lookup errors fail the batch only when no track was found', async () => {
  const runner = { async run() { return { picks:[{artist:'A',title:'One',reason:'First'},{artist:'B',title:'Two',reason:'Second'}] }; } };
  const failure = Object.assign(new Error('ytdlp_failed'),{code:'ytdlp_failed'});
  const failing = { async findTrack() { throw failure; } };
  await assert.rejects(new DjService(runner,{},failing,youtubeTaste({}),'/tmp',blank).recommend({...request,source:'youtube'}),error => error.code === 'ytdlp_failed');
  const partly = { async findTrack(pick) { if (pick.title === 'One') throw failure; return youtubeMedia('two00000000','Two','B'); } };
  const result = await new DjService(runner,{},partly,youtubeTaste({}),'/tmp',blank).recommend({...request,source:'youtube'});
  assert.deepEqual(result.items.map(item => item.media.id),['youtube:two00000000']);
});

test('notes and recent plays guide picks, and recently played songs are not repeated', async () => {
  const dir = await mkdtemp(join(tmpdir(),'music-dj-memory-'));
  try {
    const memory = await DjMemory.open(dir);
    await memory.recordExchange({ you:'I love Finnish psych', reply:'Noted!', suggestions:[], addNotes:['Loves Finnish psych rock'], removeNoteIds:[] });
    await memory.recordPlay({ media:youtubeMedia('kuivaamo000','Kuivaamo','Circle'), outcome:'skipped', listenedSeconds:12, durationSeconds:630 });
    let input;
    const runner = { async run(kind,value) { input = value; return { picks:[{artist:'Circle',title:'Kuivaamo',reason:'Again'},{artist:'Can',title:'Mushroom',reason:'Groove'}] }; } };
    const looked = [];
    const youtube = { async findTrack(pick) { looked.push(pick.title); return youtubeMedia('mushroom000','Mushroom','Can'); } };
    const result = await new DjService(runner,{},youtube,youtubeTaste({}),dir,memory).recommend({...request,source:'youtube'});
    assert.deepEqual(input.notes,['Loves Finnish psych rock']);
    assert.deepEqual(input.recentPlays,[{title:'Kuivaamo',artist:'Circle',outcome:'skipped',listenedSeconds:12,durationSeconds:630}]);
    assert.deepEqual(looked,['Mushroom'],'a song played in an earlier session is not picked again');
    assert.deepEqual(result.items.map(item => item.media.id),['youtube:mushroom000']);
  } finally { await rm(dir,{recursive:true,force:true}); }
});

test('a conversation turn saves the exchange and notes, and passes steering to the player', async () => {
  const dir = await mkdtemp(join(tmpdir(),'music-dj-converse-'));
  try {
    const memory = await DjMemory.open(dir);
    await memory.recordExchange({ you:null, reply:'What do you love?', suggestions:['Jazz'], addNotes:['Likes pop'], removeNoteIds:[] });
    const wrong = memory.notes[0].id;
    let call;
    const runner = { async run(kind,input,signal,options) { call = {kind,input,options}; return { reply:'Got it, no pop. Going darker now.', notesToAdd:['Never mainstream pop','Loves Circle','Loves Circle'], noteIdsToRemove:[wrong], steer:'darker Finnish psych', suggestions:['More like this','Something calmer'], interviewDone:true }; } };
    const service = new DjService(runner,{},{},youtubeTaste({}),dir,memory);
    const reply = await service.converse({ text:'I hate pop actually, play something darker', mode:'chat', djOn:true, nowPlaying:{title:'Kuivaamo',artist:'Circle'} });
    assert.equal(call.kind,'converse');
    assert.deepEqual(call.options,{quick:true});
    assert.equal(call.input.message,'I hate pop actually, play something darker');
    assert.deepEqual(call.input.notes,[{id:wrong,text:'Likes pop'}]);
    assert.deepEqual(call.input.conversation,[{role:'dj',text:'What do you love?'}]);
    assert.equal(reply.steer,'darker Finnish psych');
    assert.equal(reply.interviewDone,false,'only an interview can finish');
    assert.deepEqual(reply.memory.notes.map(note => note.text),['Never mainstream pop','Loves Circle']);
    assert.deepEqual(reply.message.notesAdded.map(note => note.text),['Never mainstream pop','Loves Circle']);
    assert.deepEqual(reply.memory.conversation.map(message => [message.role,message.text]),[['dj','What do you love?'],['you','I hate pop actually, play something darker'],['dj','Got it, no pop. Going darker now.']]);
    const reopened = await DjMemory.open(dir);
    assert.deepEqual(reopened.snapshot(),reply.memory,'the exchange survives a restart');
  } finally { await rm(dir,{recursive:true,force:true}); }
});
