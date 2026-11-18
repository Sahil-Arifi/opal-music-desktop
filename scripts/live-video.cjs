// Public-source playback checks in a disposable profile; no account mutations.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core'),root=process.env.MUSIC_TEST_ROOT||path.resolve(__dirname,'..'),delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-video-live-'));let app,page;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:60000});
 page=await app.firstWindow();await page.getByRole('button',{name:'Use local music',exact:true}).click();await page.evaluate(()=>window.music.command('volume',0));
 async function source(script){return app.evaluate(async({webContents},script)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com/watch?')&&!w.isAudioMuted());return w?.executeJavaScript(script)},script)}
 async function waitMedia(fraction){const end=Date.now()+45000;let media;while(Date.now()<end){media=await source('(()=>{const v=document.querySelector("#movie_player video");return v?{ready:v.readyState,seeking:v.seeking,paused:v.paused,position:v.currentTime,duration:v.duration}:null})()');if(media?.ready>=3&&!media.seeking&&!media.paused&&media.position>=media.duration*fraction)return media;await delay(100)}throw Error('Native seek did not resume '+JSON.stringify(media))}
 async function waitState(predicate,label,timeout=45000){const end=Date.now()+timeout;let s;while(Date.now()<end){s=await page.evaluate(()=>window.music.getState());if(s.error){console.error('Source error',await source('(()=>{const p=document.querySelector("#movie_player"),v=p?.querySelector("video");return {id:p?.getVideoData?.()?.video_id,url:location.href,details:p?.getPlayerResponse?.()?.videoDetails,ready:v?.readyState,time:v?.currentTime,paused:v?.paused,seeking:v?.seeking,duration:v?.duration}})()'));throw Error(s.error);}if(predicate(s))return s;await delay(80)}console.log('source diagnostic',await source('(()=>{const p=document.querySelector("#movie_player"),v=p?.querySelector("video");return {url:location.href,id:p?.getVideoData?.()?.video_id,response:p?.getPlayerResponse?.()?.playabilityStatus,ready:v?.readyState,time:v?.currentTime,paused:v?.paused,ended:v?.ended,duration:v?.duration,ad:p?.classList.contains("ad-showing")}})()'));throw Error(label+' '+JSON.stringify({id:s.current?.id,position:s.position,playing:s.playing,loading:s.loading}))}
 if(!process.env.MUSIC_TEST_VIDEO_ONLY){await page.evaluate(()=>window.music.playSequence([{id:'DXO288FnB-A',source:'youtube',title:'Dracula (feat. JENNIE)',artist:'Tame Impala',duration:210}],0));
 const dracula=await waitState(s=>s.current?.id==='DXO288FnB-A'&&s.playing&&s.position>1,'Dracula should play');console.log('Dracula playing',dracula.current.id,dracula.position);}
 await page.evaluate(()=>window.music.search('https://music.youtube.com/watch?v=NaEl1gDI124'));
 await page.evaluate(()=>window.music.playSequence([{id:'NaEl1gDI124',source:'youtube',title:'Yale',artist:'Ken Carson',duration:107}],0));
 await waitState(s=>s.current?.id==='NaEl1gDI124'&&s.playing&&s.position>.2,'Yale song');console.log('Yale song confirmed');
 await page.getByRole('button',{name:'Open now playing',exact:true}).click();await page.getByRole('button',{name:'Video',exact:true}).click();
 await waitState(s=>s.playbackMode==='video'&&s.playing,'Yale video');console.log('Yale video confirmed');
 const edge=await page.evaluate(async()=>{const s=await window.music.getState();return s.duration-4});
 await page.evaluate(target=>window.music.command('seek',target),edge);const edgeDeadline=Date.now()+30000;let edgeMedia;
 do{edgeMedia=await source('(()=>{const v=document.querySelector("#movie_player video"),p=document.querySelector("#movie_player");return {id:p?.getVideoData?.()?.video_id,time:v?.currentTime,ready:v?.readyState,paused:v?.paused,ended:v?.ended}})()');if(edgeMedia?.ready>=3&&!edgeMedia.paused&&!edgeMedia.ended&&edgeMedia.time>=edge-.5)break;await delay(80)}while(Date.now()<edgeDeadline);
 assert(edgeMedia&&!edgeMedia.ended&&!edgeMedia.paused&&edgeMedia.time>=edge-.5,'Near-end seek failed '+JSON.stringify(edgeMedia));console.log('Seek four seconds before the end confirmed',edgeMedia.id);
 await page.evaluate(()=>window.music.command('seek',25));await waitState(s=>s.playing&&s.position>=24&&s.position<30,'video seek keeps playing');await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();
 await page.locator('.immersive-video').waitFor();await delay(1200);
 const dimensions=await source('(()=>{const p=document.querySelector("#movie_player"),v=p.querySelector("video"),r=v.getBoundingClientRect(),c=document.querySelector("#desktop-cinema");return {id:p.getVideoData().video_id,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],title:c?.querySelector(".cinema-title")?.textContent,artist:c?.querySelector(".cinema-artist")?.textContent,resting:c?.classList.contains("resting")}})()');
 assert(dimensions.width>=dimensions.viewport[0]-2&&dimensions.height>=dimensions.viewport[1]-2);assert.equal(dimensions.title,'Yale');assert.equal(dimensions.artist,'Ken Carson');
 const hit=await source('(()=>{const r=document.querySelector(".cinema-seek").getBoundingClientRect();return {x:Math.round(r.x+r.width*.6),y:Math.round(r.y+r.height/2)}})()');
 await app.evaluate(({webContents},hit)=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com/watch?')&&!w.isAudioMuted());w.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...hit});w.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...hit});},hit);
 await waitState(s=>s.playing&&s.position>s.duration*.5,'native movie seek keeps playing');await waitMedia(.5);console.log('Native movie seek confirmed');
 await app.evaluate(({webContents})=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://music.youtube.com/watch?')&&!w.isAudioMuted());w.sendInputEvent({type:'mouseMove',x:200,y:100});});
 await delay(2700);assert.equal(await source('document.querySelector("#desktop-cinema").classList.contains("resting")'),true);
 await source('document.querySelector("#movie_player").dispatchEvent(new MouseEvent("mousemove",{bubbles:true,clientX:300,clientY:300}))');assert.equal(await source('document.querySelector("#desktop-cinema").classList.contains("resting")'),false);
 await source('document.querySelector("#desktop-cinema button[aria-label=Pause]").click()');await waitState(s=>!s.playing&&!s.loading,'movie pause');
 await source("Array.from(document.querySelectorAll('#desktop-cinema button')).find(b=>b.getAttribute('aria-label')==='Exit full screen').click()");await page.locator('.immersive-video').waitFor({state:'detached'});
 await delay(900);const slot=await page.locator('.player-video-slot').boundingBox(),embedded=await source('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight]}})()');assert(Math.abs(embedded.width-slot.width)<2&&Math.abs(embedded.height-slot.height)<2,JSON.stringify({slot,embedded}));assert.equal(embedded.x,0);assert.equal(embedded.y,0);console.log('First fullscreen exit restored embedded bounds');
 await page.evaluate(()=>window.music.command('seek',12));await waitState(s=>!s.playing&&Math.abs(s.position-12)<1.5,'paused video seek remains paused');
 for(const [width,height] of [[800,590],[1440,900],[1220,820]]){console.log('Resizing fullscreen',width,height);
  await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();await page.locator('.immersive-video').waitFor();
  const actual=await app.evaluate(({BrowserWindow},size)=>{const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('http://127.0.0.1:'));w.setContentSize(...size);return w.getContentSize()},[width,height]);
  const deadline=Date.now()+6000;let viewport;do{viewport=await source('[innerWidth,innerHeight]');if(viewport?.[0]===actual[0]&&viewport?.[1]===actual[1])break;await delay(80)}while(Date.now()<deadline);
  const full=await source('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewport:[innerWidth,innerHeight],controls:document.querySelectorAll("#desktop-cinema").length}})()');
  assert.equal(full.controls,1);assert.deepEqual(full.viewport,actual);assert.equal(full.width,actual[0]);assert.equal(full.height,actual[1]);assert.equal(full.x,0);assert.equal(full.y,0);
  await source("Array.from(document.querySelectorAll('#desktop-cinema button')).find(b=>b.getAttribute('aria-label')==='Exit full screen').click()");await page.locator('.immersive-video').waitFor({state:'detached'});await delay(800);
  const slot=await page.locator('.player-video-slot').boundingBox(),normal=await source('(()=>{const r=document.querySelector("video").getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,controls:document.querySelectorAll("#desktop-cinema").length}})()');
  assert.equal(normal.controls,0);assert.equal(normal.x,0);assert.equal(normal.y,0);assert(Math.abs(normal.width-slot.width)<2&&Math.abs(normal.height-slot.height)<2,JSON.stringify({slot,normal}));
 }
 await page.evaluate(()=>window.music.setPlaybackMode('song'));await waitState(s=>s.playbackMode==='song'&&s.current?.id==='NaEl1gDI124','return to song recording');
 const songIdentity=await source('document.querySelector("#movie_player")?.getPlayerResponse?.()?.videoDetails');assert.equal(songIdentity?.musicVideoType,'MUSIC_VIDEO_TYPE_ATV');console.log('Returned to decoded audio recording',songIdentity.videoId);
 console.log(JSON.stringify({draculaPlayable:!process.env.MUSIC_TEST_VIDEO_ONLY,yaleVideo:true,dimensions,movieControlsIdleAndReveal:true,playingAndPausedSeeks:true,resizeAndExitCycles:3}));
}catch(error){
 console.error(error);
 if(page){console.error('Shell',await page.evaluate(async()=>({state:await window.music.getState(),stage:document.querySelector('.expanded-player')?.className})).then(r=>({stage:r.stage,id:r.state.current?.id,mode:r.state.playbackMode,playing:r.state.playing,error:r.state.error})).catch(()=>null));await page.screenshot({path:'/tmp/music-video-failure.png'}).catch(()=>{});}
 process.exitCode=1}
finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true})}})();

