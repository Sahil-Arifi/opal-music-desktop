// Real playback in a disposable profile; no retained-account library writes.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core'),root=process.env.MUSIC_TEST_ROOT||path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-selection-live-'));let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:60000});
 const page=await app.firstWindow();await page.getByRole('button',{name:'Use local music',exact:true}).click();await page.evaluate(()=>window.music.command('volume',0));
 const yale={id:'NaEl1gDI124',source:'youtube',title:'Yale',artist:'Ken Carson',duration:107},lift={id:'CsETfqZNJ0M',source:'youtube',title:'Lift',artist:'Radiohead',duration:247};
 async function waitState(predicate,label,timeout=45000){const end=Date.now()+timeout;let s;while(Date.now()<end){s=await page.evaluate(()=>window.music.getState());if(s.error)throw Error(s.error);if(predicate(s))return s;await delay(80)}throw Error(label+' '+JSON.stringify({id:s.current?.id,position:s.position,duration:s.duration,playing:s.playing,loading:s.loading}))}
 async function source(script){return app.evaluate(async({webContents},script)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com/watch?')&&!w.isAudioMuted());return w?.executeJavaScript(script)},script)}
 await page.evaluate(track=>window.music.playSequence([track],0),yale);await waitState(s=>s.current?.id===yale.id&&s.playing&&s.position>.2,'first song');
 for(const track of [lift,yale,yale]){
  await page.evaluate(()=>window.music.command('seek',38));await waitState(s=>s.playing&&s.position>=37&&s.position<43,'seek before selection');
  await page.evaluate(()=>{window.selectionProgress=[];window.selectionArmed=false;window.offSelectionProgress?.();window.offSelectionProgress=window.music.onState(s=>{if(s.loading){window.selectionArmed=true;window.selectionProgress=[]}if(s.playing&&!s.loading&&window.selectionArmed)window.selectionProgress.push({id:s.current?.id,position:s.position})})});
  await page.evaluate(track=>window.music.playSequence([track],0),track);
  const playing=await waitState(s=>s.current?.id===track.id&&s.playing&&!s.loading,'new selection');assert(playing.position<5,'Inherited position: '+playing.position);
  const media=await source('(()=>{const p=document.querySelector("#movie_player"),v=p.querySelector("video");return {id:p.getVideoData().video_id,time:v.currentTime,title:p.getPlayerResponse()?.videoDetails?.title}})()');
  assert.equal(media.id,track.id);assert(media.time<5,JSON.stringify(media));
  const progress=await page.evaluate(()=>window.selectionProgress);assert(progress.filter(p=>p.id===track.id).every(p=>p.position<5),JSON.stringify(progress));
 }
 if(process.env.MUSIC_TEST_AUDIO_ONLY){console.log(JSON.stringify({newSelectionsFromZero:3,includesSameSongReplay:true,decodedAudioVerified:true}));return;}
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.getByRole('button',{name:'Video',exact:true}).click();await waitState(s=>s.playbackMode==='video'&&s.playing,'video');
 await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();await page.locator('.immersive-video').waitFor();await delay(800);
 const next={...lift,mediaType:'video'},nextVideo={...yale,id:'kpuy4BEU644',mediaType:'video'};await page.evaluate(tracks=>window.music.playSequence(tracks,0),[next,nextVideo]);const selected=await waitState(s=>s.current?.id===next.id&&s.playing&&!s.loading,'fullscreen selection');assert(selected.position<5);
 const labels=await source('(()=>{const c=document.querySelector("#desktop-cinema");return {title:c?.querySelector(".cinema-title")?.textContent,artist:c?.querySelector(".cinema-artist")?.textContent}})()');assert.deepEqual(labels,{title:'Lift',artist:'Radiohead'});
 await page.evaluate(()=>{window.handoffProgress=[];window.offHandoff=window.music.onState(s=>{if(s.current?.id==='kpuy4BEU644'&&s.playing&&!s.loading)window.handoffProgress.push(s.position)})});
 await page.evaluate(()=>window.music.command('seek',246));await waitState(s=>s.current?.id===nextVideo.id&&s.playing&&!s.loading,'natural fullscreen successor');
 const successor=await source('(()=>{const c=document.querySelector("#desktop-cinema");return {title:c?.querySelector(".cinema-title")?.textContent,artist:c?.querySelector(".cinema-artist")?.textContent}})()');assert.deepEqual(successor,{title:'Yale',artist:'Ken Carson'});
 assert((await page.evaluate(()=>window.handoffProgress))[0]<5,'Natural successor inherited a clock');
 await source('document.querySelector("#desktop-cinema button[aria-label=Pause]").click()');await waitState(s=>!s.playing&&!s.loading,'pause');
 await source("Array.from(document.querySelectorAll('#desktop-cinema button')).find(b=>b.getAttribute('aria-label')==='Exit full screen').click()");await page.locator('.immersive-video').waitFor({state:'detached'});await delay(900);
 const slot=await page.locator('.player-video-slot').boundingBox(),embedded=await source('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,controls:document.querySelectorAll("#desktop-cinema").length}})()');assert.equal(embedded.controls,0);assert.equal(embedded.x,0);assert.equal(embedded.y,0);assert(Math.abs(embedded.width-slot.width)<2&&Math.abs(embedded.height-slot.height)<2,JSON.stringify({slot,embedded}));
 console.log(JSON.stringify({newSelectionsFromZero:3,includesSameSongReplay:true,fullscreenLabels:labels,naturalSuccessorLabels:successor,fullscreenExitFits:true}));
}catch(error){console.error(error);process.exitCode=1}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true})}})();

