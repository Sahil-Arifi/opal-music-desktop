const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {_electron}=require('playwright-core'),root=path.resolve(__dirname,'..'),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-preparation-'));let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:30000});
 const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.getByRole('button',{name:'Use local music',exact:true}).click();await page.evaluate(()=>window.music.command('volume',0));
 async function state(predicate,label,timeout=90000){const deadline=Date.now()+timeout;let value;while(Date.now()<deadline){value=await page.evaluate(()=>window.music.getState());if(value.error)throw Error(value.error);if(predicate(value))return value;await delay(80)}throw Error(label+' '+JSON.stringify(value))}
 const first=await page.evaluate(()=>window.music.search('https://music.youtube.com/watch?v=6l_8PMBgymE'));
 const next=await page.evaluate(()=>window.music.search('Tame Impala Let It Happen'));assert(first[0]&&next[0]);console.log('tracks',first[0].id,next[0].id,next[0].title);
 await page.evaluate(tracks=>window.music.playSequence(tracks,0),[first[0],next[0]]);
 await state(s=>s.current?.id===first[0].id&&s.playing&&s.position>=1,'first stream');
 const documents=()=>app.evaluate(async({webContents})=>Promise.all(webContents.getAllWebContents().filter(w=>w.getURL().startsWith('https://music.youtube.com/watch?')).map(async w=>({wc:w.id,muted:w.isAudioMuted(),...await w.executeJavaScript('(()=>{const p=document.querySelector("#movie_player"),v=p?.querySelector("video");return {id:p?.getVideoData?.()?.video_id,ad:p?.classList.contains("ad-showing"),paused:v?.paused,position:v?.currentTime,ready:v?.readyState}})()')}))));
 let docs,prepared,last=0;const deadline=Date.now()+35000;
 while(Date.now()<deadline){docs=await documents();if(Date.now()-last>3000){last=Date.now();console.log('preparing',JSON.stringify(docs));}prepared=docs.find(d=>d.id===next[0].id&&d.muted&&d.paused&&d.ready>=3);if(prepared)break;await delay(100)}
 assert(prepared,'Expected one muted, paused, buffered next recording: '+JSON.stringify(docs));assert(docs.length<=2);
 const at=performance.now();await page.locator('.dock').getByRole('button',{name:'Next track',exact:true}).click();
 if(process.env.MUSIC_TEST_PAUSE_HANDOFF){await page.keyboard.press('Space');await state(s=>s.current?.id===next[0].id&&!s.playing&&!s.loading,'pause during handoff');await delay(700);assert.equal((await page.evaluate(()=>window.music.getState())).playing,false);assert.equal((await documents()).find(d=>d.id===next[0].id)?.paused,true);await page.keyboard.press('Space');}
 await state(s=>s.current?.id===next[0].id&&s.playing&&s.position>.15,'prepared handoff');
 const ms=Math.round(performance.now()-at),after=await documents();assert.equal(after.find(d=>d.id===next[0].id)?.wc,prepared.wc);assert.equal(after.length,1);assert.equal(await page.locator('.expanded-player').count(),0);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({pauseDuringHandoff:!!process.env.MUSIC_TEST_PAUSE_HANDOFF,pausedPreparedPlayer:true,samePreparedDocument:true,skipToPlayingMs:ms,remainingPlayerDocuments:after.length,ad:prepared.ad,track:next[0].title}));
}catch(error){console.error(error);process.exitCode=1}finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true})}})();

