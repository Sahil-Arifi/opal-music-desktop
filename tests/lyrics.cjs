const {test} = require('node:test');
const assert = require('node:assert/strict');
const {getLyrics, createLyrics, parseLRC} = require('../src/main/lyrics.cjs');

const track = {title:'The Harbor', artist:'Fixture Quartet', album:'Coast', duration:180};
const record = {
  trackName:track.title, artistName:track.artist, albumName:track.album, duration:180,
  syncedLyrics:'[00:03.58]A lighthouse blinks (echo)\n[00:10.20]Across the water',
  plainLyrics:'A lighthouse blinks (echo)\nAcross the water',
};

function fixture(handler, options={}) {
  const calls=[];
  const lookup=createLyrics({spacing:0,wordLyrics:null, ...options, fetchImpl:async(url,init)=>{
    calls.push({url,init});
    return handler(url,init);
  }});
  return {lookup,calls};
}

test('LRC offsets, repeated timestamps, simultaneous backing vocals, and breaks retain supplied timings',()=>{
  const input=[
    '[ti:Test]', '[00:20.25][00:10.2]North (echo)', '[00:10.20] (answer)',
    '[00:10.20]Second singer', '[00:10.20]Second singer', '[00:13.55][bg:over the water]',
    '[00:15.500]', '[offset:+200]', '[01:99]invalid',
    '[00:00.10]<00:00.10>First <00:00.80>light',
  ].join('\r\n');
  assert.deepEqual(parseLRC(input),[
    {time:0,text:'First light',words:[{text:'First ',start:0,end:.6},{text:'light',start:.6}]},
    {time:10,text:'North (echo)\n(answer)\nSecond singer'},
    {time:13.35,text:'',adlibs:['over the water'],backing:[{text:'over the water',start:13.35}]}, {time:15.3,text:''},
    {time:20.05,text:'North (echo)'},
  ]);
  assert.deepEqual(parseLRC('[offset:-250]\n[00:02]Sung alone'),[{time:2.25,text:'Sung alone'}]);
  assert.deepEqual(parseLRC('[00:01]\n[00:10]'),[]);
  assert.deepEqual(parseLRC('plain only'),[]);
});

test('accurate recordings use the provider signature once across concurrent lookups and subsequent reads',async()=>{
  const {lookup,calls}=fixture(async()=>Response.json(record));
  const [first,second]=await Promise.all([lookup(track),lookup({...track,title:'The Harbor (Official Audio)',artist:'Fixture Quartet - Topic'})]);
  assert.equal(calls.length,1);
  assert.deepEqual(first,second);assert.equal(first.source,'LRCLIB');assert.equal(first.synced,true);
  assert.equal(first.lines[0].time,3.58);
  assert.equal(first.lines[0].text,'A lighthouse blinks (echo)');
  assert.equal(first.lines[0].adlibs,undefined);
  assert.equal(calls[0].url.origin,'https://lrclib.net');
  assert.equal(calls[0].url.pathname,'/api/get');
  assert.equal(calls[0].url.searchParams.get('duration'),'180');
  assert.equal(calls[0].url.searchParams.get('album_name'),'Coast');
  assert.equal(calls[0].init.redirect,'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  assert.match(calls[0].init.headers['User-Agent'],/YouTubeMusicMac/);
  await lookup(track);assert.equal(calls.length,1);
});

test('enhanced LRC preserves source syllables, whitespace, boundaries and separately timed backing without inferring a vocal role',()=>{
  const [line,repeat]=parseLRC('[00:01][00:09]<00:01.10>Moon<00:01.3>light <00:02>rises<00:02.4>\n[00:01][bg:<00:01.40>(oh) <00:02.2>yes<00:02.6>]');
  assert.deepEqual(line.words,[{text:'Moon',start:1.1,end:1.3},{text:'light ',start:1.3,end:2},{text:'rises',start:2,end:2.4}]);
  assert.deepEqual(line.backing,[{text:'(oh) yes',start:1.4,end:2.6,words:[{text:'(oh) ',start:1.4,end:2.2},{text:'yes',start:2.2,end:2.6}]}]);
  assert.equal(repeat.words,undefined);assert.equal(repeat.text,'Moonlight rises');
  for(const raw of ['[00:01]Still (a lead line)','[00:01]Still <00:02>untimed','[00:01]<00:02>bad <00:01.5>clock']){
    const [cue]=parseLRC(raw);assert.equal(cue.words,undefined);assert.equal(cue.backing,undefined);
  }
});

test('fallback matches the same recording identity and duration, protecting remixes, live versions and covers',async()=>{
  const {lookup,calls}=fixture(async url=>Response.json(url.pathname.endsWith('/get') ?
    {...record,duration:204} :
    [{...record,trackName:'The Harbor (Live)'},{...record,artistName:'Cover band'},{...record,duration:188},
     {...record,albumName:'Compilation',syncedLyrics:'[00:01]Compilation'},
     {...record,duration:181,syncedLyrics:'[00:04]Correct edition'}]));
  assert.equal((await lookup(track)).lines[0].text,'Correct edition');
  assert.deepEqual(calls.map(c=>c.url.pathname),['/api/get','/api/search']);
  const mismatch=fixture(async url=>url.pathname.endsWith('/get') ? new Response(null,{status:404}) :
    Response.json([{...record,trackName:'The Harbor (Radio Edit)'},{...record,duration:186,albumName:'Another release'}]));
  assert.deepEqual(await mismatch.lookup(track),{synced:false,lines:[]});
});

test('recording duration arriving later upgrades an album-matched plain result to synced lines',async()=>{
  const {lookup,calls}=fixture(async()=>Response.json(record));
  const plain=await lookup({...track,duration:0});
  assert.equal(plain.synced,false);assert.equal(plain.plain,record.plainLyrics);
  assert.deepEqual(plain.lines,[]);
  assert.equal((await lookup(track)).synced,true);
  assert.equal(calls.length,2);
});

test('plain lyrics, instrumental records, absent lyrics and transient errors remain distinct',async()=>{
  const plain=fixture(async()=>Response.json({...record,syncedLyrics:null}));
  assert.deepEqual(await plain.lookup(track),{source:'LRCLIB',synced:false,lines:[],plain:record.plainLyrics});
  const instrumental=fixture(async()=>Response.json({...record,instrumental:true,plainLyrics:null,syncedLyrics:null}));
  assert.deepEqual(await instrumental.lookup(track),{source:'LRCLIB',synced:false,lines:[],instrumental:true});
  const absent=fixture(async()=>new Response(null,{status:404}));
  assert.deepEqual(await absent.lookup(track),{lines:[],synced:false});
  const failing=fixture(async()=>{throw Error('upstream');});
  assert.match((await failing.lookup(track)).error,/unavailable/);
  await failing.lookup(track);assert.equal(failing.calls.length,2);
});

test('a throttled provider is not retried during its requested cooldown',async()=>{
  const {lookup,calls}=fixture(async()=>new Response('',{status:429,headers:{'Retry-After':'60'}}));
  assert.ok((await lookup(track)).error);
  assert.ok((await lookup({...track,title:'Another recording'})).error);
  assert.equal(calls.length,1);
});

test('collaborator credits may move between artist and title while live versions and unrelated performers stay distinct',async()=>{
  const withGuests={...track,artist:'Fixture Quartet & Guest Singer'};
  const accepted={...record,trackName:'The Harbor (feat. Guest Singer)'};
  const {lookup,calls}=fixture(async url=>{
    if(url.pathname.endsWith('/get'))return new Response(null,{status:404});
    if(url.searchParams.get('artist_name')!==track.artist)return Response.json([]);
    return Response.json([{...record,trackName:'The Harbor (Live) (with Guest Singer)'},record,
      {...record,trackName:'The Harbor (feat. Other Singer)'},accepted]);
  });
  assert.equal((await lookup(withGuests)).synced,true);
  assert.deepEqual(calls.map(({url})=>url.searchParams.get('artist_name')),[withGuests.artist,withGuests.artist,track.artist]);
  const otherOrder=fixture(async()=>Response.json({...record,artistName:'Guest Singer • Fixture Quartet'}));
  assert.equal((await otherOrder.lookup({...track,title:'The Harbor (ft. Guest Singer)'})).synced,true);
  const solo=fixture(async url=>url.pathname.endsWith('/get')?new Response(null,{status:404}):Response.json([record]));
  assert.deepEqual(await solo.lookup(withGuests),{synced:false,lines:[]});
});

test('an alternate duration can provide clearly untimed words when the exact song, credits and release are confirmed',async()=>{
  const {lookup}=fixture(async url=>url.pathname.endsWith('/get')?new Response(null,{status:404}):
    Response.json([{...record,duration:95,artistName:'Fixture Quartet, Guest Singer'}]));
  assert.deepEqual(await lookup({...track,artist:'Fixture Quartet & Guest Singer',duration:288}),
    {lines:[],synced:false,plain:record.plainLyrics,source:'LRCLIB'});
  const ambiguous=fixture(async url=>url.pathname.endsWith('/get')?new Response(null,{status:404}):
    Response.json([{...record,id:1,duration:95},{...record,id:1,duration:95}]));
  assert.deepEqual(await ambiguous.lookup({...track,album:'',duration:288}),{lines:[],synced:false});
});

test('an unidentifiable local file or invalid duration does not query the provider',async()=>{
  const {lookup,calls}=fixture(()=>{throw Error('unexpected');});
  for(const input of [null,{}, {...track,artist:'Local audio'}, {...track,title:'x'.repeat(501)},
    {...track,album:'',duration:0}, {...track,duration:Infinity},{...track,duration:-3}]) {
    assert.deepEqual(await lookup(input),{lines:[],synced:false});
  }
  assert.equal(calls.length,0);
  assert.equal(typeof getLyrics,'function');
});

