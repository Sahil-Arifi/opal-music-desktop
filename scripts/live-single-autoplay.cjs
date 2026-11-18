const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core'),{recordingKey}=require('../src/main/recording.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms)),root=path.resolve(__dirname,'..');
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-single-'));let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:30000});const page=await app.firstWindow();
 await page.getByRole('button',{name:'Use local music',exact:true}).click();await page.evaluate(()=>window.music.command('volume',0));
 const release=await page.evaluate(()=>window.music.catalog('album',{title:'Already Rich',artist:'Yeat'}));assert.equal(release.releaseType,'single');assert.equal(release.tracks.length,1);
 await page.evaluate(tracks=>window.music.playSequence(tracks,0),release.tracks);
 const deadline=Date.now()+70000;let state;
 while(Date.now()<deadline){state=await page.evaluate(()=>window.music.getState());if(state.error)throw Error(state.error);if(state.playing&&state.position>.1&&state.serviceQueue.length)break;await delay(100)}
 assert(state.playing&&state.serviceQueue.length,'Single should populate autoplay: '+JSON.stringify({playing:state.playing,id:state.current?.id,queue:state.serviceQueue.length}));
 assert(state.serviceQueue.every(t=>recordingKey(t)!==recordingKey(state.current)));console.log(JSON.stringify({single:release.title,releaseType:release.releaseType,upNext:state.serviceQueue.length,noCurrentSongDuplicate:true}));
}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true})}})().catch(e=>{console.error(e);process.exitCode=1});

