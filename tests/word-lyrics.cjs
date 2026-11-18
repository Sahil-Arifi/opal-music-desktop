const test=require('node:test'),assert=require('node:assert/strict');
const {createWordLyrics,parseTTML}=require('../src/main/word-lyrics.cjs');
const {createLyrics}=require('../src/main/lyrics.cjs');
const sample='<tt xmlns="http://www.w3.org/ns/ttml" xmlns:meta="http://www.w3.org/ns/ttml#metadata"><body dur="03:00.00"><div>'+
 '<p begin="00:01.000" end="00:04"><span begin="1s" end="1.4s">Re</span><span begin="1.4s" end="2s">turn</span> <span begin="2.5s" end="3.9s">home</span>'+
 '<span meta:role="x-bg"><span begin="2.2s" end="2.4s">Oh</span> <span begin="3.2s" end="4s">yes</span><span meta:role="x-translation">翻訳</span></span>'+
 '<span meta:role="x-roman">Excluded</span></p><p begin="5.01s">(Lead vocals)</p></div></body></tt>';
const t={title:'Return',artist:'Quartet',album:'Coast',duration:180,credit:{base:'Return',names:['quartet']}};
const record={rawLyricFile:'1700000000000-12345-abcdef01.ttml',metadata:[['musicName',['Return']],['artists',['Quartet']],['album',['Coast']]]};

test('TTML reads timed lead syllables, inter-word spaces, overlapping backing roles and timing variants',()=>{
 const data=parseTTML(sample,180);
 assert.equal(data.lines.length,2);assert.equal(data.lines[0].text,'Return home');
 assert.deepEqual(data.lines[0].words,[{text:'Re',start:1,end:1.4},{text:'turn ',start:1.4,end:2},{text:'home',start:2.5,end:3.9}]);
 assert.deepEqual(data.lines[0].backing,[{text:'Oh yes',start:2.2,end:4,words:[{text:'Oh ',start:2.2,end:2.4},{text:'yes',start:3.2,end:4}]}]);
 assert.deepEqual(data.lines[1],{time:5.01,text:'(Lead vocals)'});
 assert.equal(parseTTML(sample.replace('03:00.00','03:04.00'),180),null);
 assert.equal(parseTTML('<!DOCTYPE tt [<!ENTITY f SYSTEM "file:///etc/passwd">]>'+sample,180),null);
 assert.equal(parseTTML(sample.replace('</div>',''),180),null);
});

test('community metadata is fetched once, filenames stay within a fixed host and versions must match the play duration',async()=>{
 const calls=[];
 const words=createWordLyrics({fetchImpl:async url=>{
   calls.push(url);
   return new Response(url.endsWith('.jsonl')?[JSON.stringify({...record,rawLyricFile:'../../bad.ttml'}),JSON.stringify(record)].join('\n'):sample);
 }});
 const [a,b]=await Promise.all([words(t),words({...t,duration:189})]);
 assert.equal(a.source,'AMLL TTML Database');assert.equal(b,null);
 for(const mismatch of [{...t,credit:{base:'Return (Live)',names:['quartet']}},{...t,album:'Other Edition'},{...t,credit:{base:'Return',names:['other']},artist:'Other'}])assert.equal(await words(mismatch),null);
 assert.equal(calls.filter(url=>url.endsWith('.jsonl')).length,1);assert.equal(calls.length,3);
 assert.ok(calls.every(url=>url.startsWith('https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/')));
});

test('word-source failures fall through to LRCLIB and do not retry the index on every track',async()=>{
 let index=0,lrc=0;
 const lookup=createLyrics({spacing:0,fetchImpl:async url=>{
   if(String(url).includes('githubusercontent')){index++;return new Response('offline',{status:503});}
   lrc++;return Response.json({trackName:url.searchParams.get('track_name'),artistName:'Quartet',albumName:'Coast',duration:180,syncedLyrics:'[00:02]Plain line'});
 }});
 for(const title of ['Return','Another'])assert.deepEqual((await lookup({...t,title})).lines,[{time:2,text:'Plain line'}]);
 assert.equal(index,1);assert.equal(lrc,2);
});

test('a fresh public index survives restart, a stale copy works offline, and a corrupt cache is replaced',async ctx=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'music-lyric-index-'));ctx.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'amll-lyrics-index-v1.jsonl');
 let renewals=0,offline=false;
 const fresh=()=>createWordLyrics({cacheDir:dir,fetchImpl:async url=>{
   if(!url.endsWith('.jsonl'))return new Response(sample);
   renewals++;if(offline)throw Error('offline');return new Response(JSON.stringify(record));
 }});
 const first=fresh();await Promise.all([first.preload(),first.preload()]);assert.equal(renewals,1);
 const second=fresh();assert.equal((await second(t)).source,'AMLL TTML Database');assert.equal(renewals,1);
 const old=new Date(Date.now()-2*86400000);await fs.utimes(file,old,old);offline=true;
 assert.equal((await fresh()(t)).source,'AMLL TTML Database');assert.equal(renewals,2);
 offline=false;await fs.writeFile(file,'broken');await fresh().preload();assert.equal(renewals,3);
 assert.equal(JSON.parse(await fs.readFile(file,'utf8')).rawLyricFile,record.rawLyricFile);
});

