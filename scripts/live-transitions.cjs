// Real source playback, isolated from the user's account and installed app.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),{_electron}=require('playwright-core');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-transition-live-'));let app;
 try{
  app=await _electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,MUSIC_TEST_PROFILE:profile},timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',error=>console.log('renderer error',error.message));
  const local=page.getByRole('button',{name:'Use local music',exact:true});await Promise.race([local.waitFor({timeout:60000}),page.locator('.dock').waitFor({timeout:60000})]);if(await local.isVisible())await local.click();await page.evaluate(()=>window.music.command('volume',0));
  async function waitState(predicate,label,timeout=70000){const deadline=Date.now()+timeout;let state;while(Date.now()<deadline){state=await page.evaluate(()=>window.music.getState());if(state.error)throw Error(state.error);if(predicate(state))return state;await delay(50)}throw Error(label+' '+JSON.stringify({id:state?.current?.id,position:state?.position,playing:state?.playing}))}
  const artist=await page.evaluate(()=>window.music.catalog('artist',{title:'2hollis'}));
  const more=await page.evaluate(id=>window.music.artistTopSongs({id}),artist.id);
  assert(artist.tracks.length>=3);assert(more.length>artist.tracks.length,'Show more should retrieve the real artist top-song list');
  console.log(JSON.stringify({artist:artist.title,initialTopSongs:artist.tracks.length,expandedTopSongs:more.length,orderedQueueSize:artist.tracks.slice(0,3).length}));
  const tracks=[{id:'6l_8PMBgymE',source:'youtube',title:'Sky',artist:'Playboi Carti',duration:193},{id:'NaEl1gDI124',source:'youtube',title:'Yale',artist:'Ken Carson',duration:107},{id:'pFptt7Cargc',source:'youtube',title:'Let It Happen',artist:'Tame Impala',duration:467}];
  await page.evaluate(tracks=>window.music.playSequence(tracks,0),tracks);
  await waitState(s=>s.current?.id===tracks[0].id&&s.playing&&s.position>.3,'first track');
  const sourceTime=()=>app.evaluate(async({webContents})=>{
   const source=webContents.getAllWebContents().find(contents=>contents.getURL().startsWith('https://music.youtube.com/watch?'));
   return source?.executeJavaScript('(()=>{const player=document.querySelector("#movie_player"),video=player?.querySelector("video");return {id:player?.getVideoData?.()?.video_id,position:video?.currentTime,duration:video?.duration,ended:video?.ended,seeking:video?.seeking,paused:video?.paused,ready:video?.readyState}})()');
  });
  const seekStart=performance.now();
  await page.evaluate(()=>Promise.all([window.music.command('seek',40),window.music.command('seek',15),window.music.command('seek',60)]));
  let source,deadline=Date.now()+12000;while(Date.now()<deadline){source=await sourceTime();if(Math.abs(source?.position-60)<2&&!source.seeking)break;await delay(50)}
  assert(Math.abs(source?.position-60)<2&&!source.seeking,'real media should settle at the last seek: '+JSON.stringify(source));
  const seekMs=Math.round(performance.now()-seekStart);await delay(900);const confirmed=await page.evaluate(()=>window.music.getState());assert(confirmed.position>=60&&confirmed.position<64);
  const skipStart=performance.now();await page.evaluate(()=>window.music.command('next'));
  await waitState(s=>s.current?.id===tracks[1].id&&s.playing&&s.position>.15,'manual next');const skipMs=Math.round(performance.now()-skipStart);
  console.log('manual next',skipMs,JSON.stringify(await sourceTime()));await delay(2500);
  const before=await page.evaluate(()=>window.music.getState());await page.evaluate(position=>window.music.command('seek',position),before.duration-1.5);

  try{await waitState(s=>s.current?.id===tracks[2].id&&s.playing&&s.position>.1,'natural ordered handoff',25000)}catch(error){console.log('source failure',JSON.stringify(await sourceTime()));throw error;}
  console.log(JSON.stringify({rapidSeekConfirmedMs:seekMs,manualNextPlayingMs:skipMs,naturalOrderedHandoff:true,nextTitle:tracks[2].title}));
 }finally{await app?.close();fs.rmSync(profile,{recursive:true,force:true})}
})().catch(error=>{console.error(error);process.exitCode=1});

