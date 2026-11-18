const test=require('node:test'),assert=require('node:assert/strict');
const {MusicSession}=require('../src/main/music-session.cjs');

test('artist name lookup follows a real catalog result, prioritizes its exact name and caches the result',async()=>{
 const session=new MusicSession();session.player={};let closed=0;const visited=[];
 const id='UCabcdefghijklmnopqrstuv',p={kind:'artist',id,title:'Luna',audience:'12K monthly audience',tracks:[],albums:[],singles:[]};
 session.window=()=>({loadURL:async url=>visited.push(url),isDestroyed:()=>false,destroy(){closed++;},webContents:{setAudioMuted(){}}});
 session.run=async(_win,fn,kind)=>{assert.equal(fn.name,'readCatalog');return kind==='search'?[{kind:'artist',id:'UCabcdefghijklmnopqrstuw',title:'Lunar'},{kind:'artist',id,title:'Luna'}]:p;};
 assert.equal((await session.catalog('artist','Luna')).id,id);assert.equal((await session.catalog('artist','Luna')).audience,p.audience);
 assert.deepEqual(visited,['https://music.youtube.com/search?q=Luna','https://music.youtube.com/browse/'+id]);assert.equal(closed,1);
});

test('catalog releases its document and rejects results belonging to a previous account',async()=>{
 const s=new MusicSession();s.player={};let closed=false;
 s.window=()=>({loadURL:async()=>{},isDestroyed:()=>false,destroy(){closed=true;},webContents:{setAudioMuted(){}}});
 s.run=async()=>{s.epoch++;return {title:'Old song'};};
 await assert.rejects(s.catalog('song','abcdefghijk'),/account changed/);assert.equal(closed,true);
});

test('artist following reads the existing subscription rather than toggling it a second time',async()=>{
 const s=new MusicSession();s.profile.connected=true;const id='UCabcdefghijklmnopqrstuv';let clicks=0;
 s.window=()=>({loadURL:async()=>{},isDestroyed:()=>false,destroy(){},webContents:{sendInputEvent(){clicks++;}}});
 s.run=async(_win,fn)=>fn.name==='readArtistSubscription'?{followed:true}:{title:'Luna',artwork:'https://example.test/art'};
 assert.deepEqual(await s.artistFollow(id,true),{followed:true});assert.equal(clicks,0);assert.equal(s.followedArtists()[0].id,id);
 await assert.rejects(s.artistFollow('arbitrary',true),/valid artist/);
});

test('unfollow acknowledges the service confirmation dialog before checking the saved subscription',async()=>{
 const s=new MusicSession();s.profile.connected=true;const id='UCabcdefghijklmnopqrstuv';let followed=true,taps=0,loads=0;
 s.window=()=>({loadURL:async()=>{loads++;},isDestroyed:()=>false,destroy(){},webContents:{sendInputEvent(e){if(e.type==='mouseUp'){taps++;if(taps===2)followed=false;}}}});
 s.run=async(_w,fn,_id,desired)=>{if(fn.name!=='readArtistSubscription')return null;if(desired==='confirm-unsubscribe')return {clickAt:{x:50,y:60}};return {followed,...(typeof desired==='boolean'&&desired!==followed?{clickAt:{x:20,y:30}}:{})};};
 assert.equal((await s.artistFollow(id,false)).followed,false);assert.equal(taps,2);assert.equal(loads,2);
});

test('release type comes from explicit metadata tokens on cards and headers',()=>{
 const {readCatalog}=require('../src/main/catalog-reader.cjs'),vm=require('node:vm');
 const nav=(type,id)=>({browseEndpoint:{browseId:id,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_'+type}}}});
 const text=s=>({runs:[{text:s}]});const artist=nav('ARTIST','UCfixture');
 const card=(id,title,subtitle)=>({data:{title:text(title),subtitle,navigationEndpoint:nav('ALBUM',id)},closest:()=>({data:{title:text('Singles & EPs')},querySelector:()=>null}),querySelector:()=>null});
 const cards=[
  card('A','Already Rich',{runs:[{text:'Single'},{text:' • '},{text:'Yeat',navigationEndpoint:artist}]}),
  card('B','One EP?',{simpleText:'2022 • EP'}),
  card('C','Whatever',{runs:[{text:'Album'},{text:' · 2020'}]}),
  card('D','Single',{runs:[{text:'Single Mothers',navigationEndpoint:artist},{text:' • 2022'}]}),
  card('E','EP',{runs:[{text:'EP',navigationEndpoint:artist}]}),
 ];
 const head={data:{title:text('Already Rich'),subtitle:{runs:[{text:'Single'},{text:' • 2023'}]}},querySelector:()=>null};
 const root={querySelectorAll:()=>cards,querySelector:()=>head};const document={querySelector:()=>root};
 const read=kind=>vm.runInNewContext('('+readCatalog.toString()+')(kind,"MPREfixture")',{document,kind});
 assert.deepEqual(Array.from(read('search'),item=>item.releaseType),['single','ep','album',undefined,undefined]);
 assert.equal(read('album').releaseType,'single');
 head.data.subtitle={simpleText:'EP • 2024'};assert.equal(read('album').releaseType,'ep');
 head.data.subtitle=text('Album');assert.equal(read('album').releaseType,'album');
 head.data.subtitle=text('Single Mothers');assert.equal(read('album').releaseType,undefined);
});

