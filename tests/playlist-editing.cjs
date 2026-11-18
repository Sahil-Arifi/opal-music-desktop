const {test}=require('node:test'),assert=require('node:assert/strict');
const {readCoverFile}=require('../src/main/playlist-cover.cjs');
const {MusicSession}=require('../src/main/music-session.cjs');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');

test('cover upload validates image bytes and size independently of file names',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'music-cover-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const p=path.join(dir,'picked.png');await fs.writeFile(p,'not an image');
 await assert.rejects(readCoverFile(p),/Choose a JPEG/);await assert.rejects(readCoverFile('relative.png'),/Choose a playlist image/);
 await fs.writeFile(p,Buffer.from('89504e470d0a1a0a01020304','hex'));assert.equal((await readCoverFile(p)).type,'image/png');
});

test('unsave changes membership exactly once and checks the reloaded first-party playlist',async()=>{
 const s=new MusicSession();let saved=true,clicks=0,loads=0;s.profile.connected=true;
 s.data.playlists=[{id:'PLold',title:'Old'},{id:'PLother',title:'Other'}];
 s.window=()=>({loadURL:async()=>{loads++;},isDestroyed:()=>false,destroy(){},webContents:{setAudioMuted(){}}});
 s.run=async(_win,fn,kind)=>{
   if(fn.name==='readPlaylistDetails')return {id:'PLold',title:'Old'};
   if(kind==='libraryState')return {saved};if(kind==='libraryToggle'){clicks++;saved=false;return true;}
 };
 assert.equal((await s.playlistAction('unsave',{id:'PLold'})).saved,false);assert.equal(loads,2);assert.equal(clicks,1);
 assert.deepEqual(s.data.playlists.map(p=>p.id),['PLother']);
});

test('the destination picker identifies a playlist by ID through nested service commands',()=>{
 const vm=require('node:vm'),{playlistControl}=require('../src/main/site-playlist-actions.cjs');
 const visible={getClientRects:()=>[1],closest:()=>null};let chosen;
 const make=(id)=>{const button={...visible,getAttribute:()=>null,scrollIntoView(){},getBoundingClientRect:()=>({left:1,top:2,width:12,height:12}),contains:()=>{chosen=id;return true;}};
   return {...visible,data:{addToPlaylistServiceEndpoint:{commandExecutorCommand:{commands:[{playlistEditEndpoint:{playlistId:id}}]}}},querySelector:()=>button};};
 const document={querySelector:()=>null,querySelectorAll:q=>q.includes('ytmusic-playlist-add-to-option-renderer')?[make('PLsameName'),make('PLselected')]:[],elementFromPoint:()=>({})};
 const result=vm.runInNewContext('('+playlistControl.toString()+')("destination","PLselected")',{document});
 assert.ok(result.clickAt);assert.equal(chosen,'PLselected');
});

test('playlist row mutations target the Action menu even when Like appears first in DOM order',()=>{
 const vm=require('node:vm'),{playlistControl}=require('../src/main/site-playlist-actions.cjs');
 const button={getAttribute:()=>null,scrollIntoView(){},getBoundingClientRect:()=>({left:10,top:20,width:24,height:24}),contains:()=>true};
 const menu={querySelector:selector=>selector==='#button-shape button'?button:null};
 const row={getClientRects:()=>[1],closest:()=>null,scrollIntoView(){},getBoundingClientRect:()=>({x:0,y:0,width:50,height:30}),data:{playlistItemData:{videoId:'abcdefghijk',playlistSetVideoId:'one'}},querySelector:selector=>selector==='ytmusic-menu-renderer'?menu:null};
 const content={querySelectorAll:()=>[row]},document={querySelector:()=>content,querySelectorAll:()=>[],elementFromPoint:()=>button};
 const result=vm.runInNewContext('('+playlistControl.toString()+')("rowMenu",{id:"abcdefghijk",entry:"one"})',{document});
 assert.equal(result.clickAt.x,22);assert.equal(result.clickAt.y,32);
});

test('playlist verification accepts only official alternate IDs attached to the selected recording',()=>{
 const vm=require('node:vm'),{playlistControl}=require('../src/main/site-playlist-actions.cjs');
 const video='abcdefghijk',audio='lmnopqrstuv';
 const selected={data:{videoId:video},closest:()=>({data:{primaryRenderer:{playlistPanelVideoRenderer:{videoId:video}},counterpart:[{counterpartRenderer:{playlistPanelVideoRenderer:{videoId:audio}}}]}})};
 const document={querySelector:q=>q.includes('queue-item')?selected:null,querySelectorAll:()=>[]};
 const ids=vm.runInNewContext('('+playlistControl.toString()+')("recordingIds",id)',{document,id:video});assert.deepEqual([...ids],[video,audio]);
 assert.equal(vm.runInNewContext('('+playlistControl.toString()+')("recordingIds",id)',{document,id:'zzzzzzzzzzz'}),null);
});

