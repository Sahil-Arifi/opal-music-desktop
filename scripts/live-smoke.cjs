const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{_electron}=require(root+'/node_modules/playwright-core');
async function waitForState(page,label,predicate,timeout=15000){
 const end=Date.now()+timeout;let state;
 do{
  state=await page.evaluate(()=>window.music.getState());
  if(predicate(state))return state;
  await new Promise(resolve=>setTimeout(resolve,100));
 }while(Date.now()<end);
 throw Error('Timed out waiting for '+label+' '+JSON.stringify({playing:state?.playing,position:state?.position,duration:state?.duration,error:state?.error}));
}
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-playback-live-'));
 const launch=()=>_electron.launch({executablePath:require(root+'/node_modules/electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:30000});
 let app;
 try{
  app=await launch();
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.getByRole('button',{name:'Use local music',exact:true}).click();
  await page.evaluate(()=>window.music.command('volume',0));
  const tracks=await page.evaluate(()=>window.music.search('https://music.youtube.com/watch?v=6l_8PMBgymE'));assert(tracks.length);
  await page.evaluate(t=>window.music.command('playTrack',t),tracks[0]);
  await waitForState(page,'the first song to advance',s=>s.playing&&s.position>.5&&s.duration>180&&s.duration<205,100000);
  assert.equal(await page.locator('.expanded-player').count(),0,'playing should stay in dock');
  await page.evaluate(()=>window.music.command('shuffle',true));
  assert.equal((await page.evaluate(()=>window.music.getState())).shuffle,true);
  for(const repeat of ['all','one','off']){
    await page.evaluate(repeat=>window.music.command('repeat',repeat),repeat);
    assert.equal((await page.evaluate(()=>window.music.getState())).repeat,repeat);
  }
  await page.evaluate(()=>window.music.command('shuffle',false));
  assert.equal((await page.evaluate(()=>window.music.getState())).shuffle,false);
  await page.locator('.dock').click({position:{x:2,y:30}});await page.locator('.expanded-player').waitFor();
  assert(await page.locator('.rail').isVisible());
  await page.getByRole('button',{name:'Show lyrics',exact:true}).click();await page.locator('.lyric-line').first().waitFor({timeout:35000});
  const cues=await page.locator('.lyric-line').count();assert(cues>10);
  await page.evaluate(()=>window.music.command('pause'));
  await waitForState(page,'pause',s=>!s.playing);
  const target=page.locator('.lyric-line').nth(14),label=await target.getAttribute('aria-label'),seek=label.match(/Seek to (\d+):(\d+)/),at=+seek[1]*60+(+seek[2]);
  await target.click();await waitForState(page,'the selected lyric timestamp',s=>Math.abs(s.position-at)<1.5);
  assert.equal((await page.evaluate(()=>window.music.getState())).playing,false,'lyric seeking should preserve pause');
  assert(await page.locator('.lyrics-scroll').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();await page.locator('.immersive-stage').waitFor();
  assert.equal((await page.evaluate(()=>window.music.getState())).fullscreen,false,'immersive must keep the native window size');
  await page.keyboard.press('Space');await waitForState(page,'Space to resume playback',s=>s.playing);assert(await page.locator('.immersive-stage').isVisible());
  const sleeve=await page.locator('.player-sleeve').boundingBox();await page.mouse.move(sleeve.x+sleeve.width/2,sleeve.y+sleeve.height/2);
  await page.locator('.controls-resting').waitFor({timeout:6000});
  await page.mouse.move(500,110);await page.waitForFunction(()=>!document.querySelector('.expanded-player')?.classList.contains('controls-resting'));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.immersive-stage'));assert(await page.locator('.rail').isVisible());
  const next=await page.evaluate(()=>window.music.search('Tame Impala Let It Happen'));assert(next.length);
  await page.evaluate(t=>window.music.command('queueTrack',t),next[0]);
  await page.getByRole('button',{name:'Next track',exact:true}).click();
  await waitForState(page,'Next to select the queued track',s=>s.current?.id===next[0].id);
  await waitForState(page,'the queued song to advance',s=>s.current?.id===next[0].id&&s.playing&&s.position>.5&&s.duration>60,100000);
  await page.getByRole('button',{name:'Collapse player',exact:true}).click();await page.locator('.expanded-player').waitFor({state:'detached'});
  assert.equal(errors.length,0,errors.join('\n'));
  const windows=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length);assert.equal(windows,1);
  const lastId=next[0].id,targetPosition=42.5;
  await page.evaluate(()=>window.music.command('pause'));
  await waitForState(page,'the last track to pause',s=>s.current?.id===lastId&&!s.playing&&!s.loading);
  await page.evaluate(value=>window.music.command('seek',value),targetPosition);
  const paused=await waitForState(page,'the last track to confirm its paused position',s=>s.current?.id===lastId&&!s.playing&&Math.abs(s.position-targetPosition)<1.25);
  await app.close();app=null;
  app=await launch();
  const reopened=await app.firstWindow();reopened.on('pageerror',e=>errors.push(e.message));
  await reopened.getByRole('button',{name:'Use local music',exact:true}).click();
  const restored=await waitForState(reopened,'the saved track and duration at the beginning',s=>s.current?.id===lastId&&!s.playing&&s.duration>60&&s.position===0);
  assert.equal(restored.volume,0);assert(Math.abs(restored.duration-paused.duration)<2);
  await reopened.locator('.dock').getByRole('button',{name:'Play',exact:true}).click();
  const resumed=await waitForState(reopened,'the first Play to start from the beginning',s=>{
    if(s.current?.id!==lastId)throw Error('First Play switched to a different track.');
    if(s.playing&&s.position>10)throw Error('First Play restored an old playhead.');
    return s.playing&&s.position>=.3&&s.position<10;
  },100000);
  const advancing=await waitForState(reopened,'a second advancing progress report on the restored track',s=>s.current?.id===lastId&&s.playing&&s.position>resumed.position+.25&&s.position<12);
  assert.equal(advancing.volume,0);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({firstPlayAfterRelaunch:true,savedPosition:paused.position,resumedPosition:advancing.position,restoredDuration:restored.duration,firstTrack:tracks[0].title,nextTrack:next[0].title,cues,shuffleAndRepeat:true,pausedLyricSeek:at,inAppImmersive:true,oneVisibleWindow:windows,rendererErrors:errors.length}));
 }finally{try{await app?.close();}finally{fs.rmSync(profile,{recursive:true,force:true});}}
})().catch(e=>{console.error(e);process.exitCode=1});

