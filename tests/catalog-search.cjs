const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {MusicSession,readPage}=require('../src/main/music-session.cjs');
test('mixed results preserve provider artist and album cards and reuse the first song search',async()=>{
 const s=new MusicSession();s.player={};let url,loads=0;
 s.window=()=>({isDestroyed:()=>false,webContents:{getURL:()=>url},loadURL:async value=>{url=value;loads++;}});
 const artist={id:'UCexample',title:'A',kind:'artist',artwork:'portrait'},album={id:'MPREalbum',title:'B',kind:'album',artwork:'sleeve'};
 s.run=async()=>({artists:[artist],albums:[album],tracks:[],playlists:[]});
 const result=await s.searchCatalog('Example');
 assert.deepEqual(result,{artists:[artist],albums:[album],songs:[],playlists:[]});assert.deepEqual(await s.search('Example',{interactive:true}),[]);assert.equal(loads,1);
});
test('a track duration never becomes its artist when the service omits artist credits',()=>{
 const card={data:{playlistItemData:{videoId:'abcdefghijk'},title:{runs:[{text:'Song title'}]},subtitle:{runs:[{text:'Song'},{text:' • '},{text:'2:37'}]}},querySelector:()=>null,closest:()=>null};
 const document={querySelector:()=>null,querySelectorAll:()=>[card]};
 const result=vm.runInNewContext('('+readPage.toString()+')()',{document});
 assert.equal(result.tracks[0].artist,'');assert.equal(result.tracks[0].duration,157);
});

