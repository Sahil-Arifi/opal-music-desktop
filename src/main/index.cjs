const {app,BrowserWindow,ipcMain,Menu,Tray,dialog,nativeImage,nativeTheme,systemPreferences,protocol,screen,session,shell}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {MetadataCache,readBootLibrary}=require('./metadata-cache.cjs');
const {buildHomeHistory}=require('./home-history.cjs');
const {Library,formats,same}=require('./library.cjs');
const {serveImport}=require('./import-stream.cjs');
const {createServer}=require('./server.cjs');
const {MusicSession}=require('./music-session.cjs');
const {AudioMotion}=require('./audio-motion.cjs');
const {ListenClock}=require('./listen-clock.cjs');
const {getLyrics,warmLyricCatalog}=require('./lyrics.cjs');
const {applyOrder,validateOrder,resolveVisibleOrder}=require('./playlist-order.cjs');
const {shuffleTail,restoreUpcoming}=require('./queue-modes.cjs');
const {recordingKey,mergeRecordingVariants}=require('./recording.cjs');
const {SeekIntent}=require('./seek-intent.cjs');
const {computeStats}=require('./listening-stats.cjs');
const {importTakeout}=require('./takeout.cjs');
const {createRecommendations,recordVote}=require('./recommendations.cjs');

app.setName('Opal Music Desktop');
const preview=process.argv.includes('--design-preview');
if(process.env.MUSIC_TEST_PROFILE)app.setPath('userData',process.env.MUSIC_TEST_PROFILE);
else if(preview)app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'music-design-')));
protocol.registerSchemesAsPrivileged([{scheme:'music-media',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
let native;
try{
  native=require('../../native/prism.node');
  if(native.initRemote)app.commandLine.appendSwitch('disable-features','HardwareMediaKeyHandling,MediaSessionService');
}catch(error){console.warn('Native material unavailable:',error.message);}
let bootLibrary,metadataCache;
let win,tray,server,store,account,recommendations,quitting=false,generation=0,recordedGeneration=-1;
let state={playing:false,position:0,duration:0,error:'',loading:false};
let serviceQueue=[];
let queueCategories=[],playbackMode='song',videoAvailable=false,discoverySections=[];
const pendingRatings=new Map(),playlistMutations=new Map();
let preparedFor='',videoOnly=false,videoNextSerial=0,videoNextPending=null;
let statsPeriod='month',historyTask=null,historySyncedAt=0,historyWarning='';
const playlistMetadata=new Map();
const verifiedPlaylistMetadata=new Set();
const confirmedPlaylists=new Map();
const artistPortraits=new Map(),artistAttempted=new Set();let artistHydration=null;
const listeningSession=Date.now().toString(36);let listenSerial=0,playEntry='',lastListenWrite=0;
let orderedPlayback=false,activePlaylistId=null;
let playbackCycle=[],unshuffledQueue=[],cyclePlayed=new Set(),settingsSerial=0,settingsPending=false,modeWriteSerial=0,sourceSettingsGeneration=-1;
const playlistCatalog=new Map();
const playlistLoads=new Map(),playlistReadAt=new Map(),playlistRefreshing=new Set();
let suggestions={releases:[],discover:[],releaseLabel:'New from artists you follow'};
let wasConnected=false,accountIdentity=null;
let navigationHistory=[],refreshing,libraryRefresh,lastRadio=null,ratingTail=Promise.resolve(),sessionEpoch=0,radioTask;
const send=(name,value)=>{if(win&&!win.isDestroyed())win.webContents.send('music:'+name,value);};
const audioMotion=new AudioMotion(native,bands=>send('energy',bands),{visible:()=>!!win&&!win.isDestroyed()&&win.isVisible()&&!win.isMinimized()});
function engine(type,value){
  const request=generation,id=store.data.current?.id,epoch=sessionEpoch;
  if(type==='stop'){
    send('engine',{type,value,generation,id});
    Promise.resolve(account?.command('stop')).catch(()=>{});
    return;
  }
  if(store.data.current?.source==='youtube'){
    Promise.resolve(account.command(type,value)).catch(error=>{
      if(request===generation&&id===store.data.current?.id&&epoch===sessionEpoch){
        state.error=error.message;state.loading=false;state.playing=false;listenClock.setPlaying(false);broadcast();
      }
    });
  }else send('engine',{type,value,generation,id});
}
const listenClock=new ListenClock();
const seekIntent=new SeekIntent();
const musicLikes=()=>{
  let rows=account.snapshot().liked.filter(track=>!track.categoryId||String(track.categoryId)==='10');
  for(const {track,rating} of pendingRatings.values()){rows=rows.filter(row=>recordingKey(row)!==recordingKey(track));if(rating==='like')rows.unshift(track);}
  return rows.map(track=>({...track,playlistId:'LM'}));
};
function snapshot(){
  const {current,volume,library,pinned}=store.data;
  const queue=mergeRecordingVariants(store.data.queue,current,true),visibleQueue=combinedQueue();
  const saved=[...new Map([...library,...(account?.snapshot().songs||[]),...(account?musicLikes():[])].map(track=>[track.source+':'+track.id,track])).values()].filter(track=>{const pending=pendingRatings.get(recordingKey(track));return !pending||pending.rating==='like';});
  return {...state,shuffle:store.data.shuffle,repeat:store.data.repeat,currentRating:pendingRatings.get(recordingKey(current))?.rating??currentRating,disliked:[...(store.data.feedback?.votes||[]).filter(v=>v.sign===-1&&!pendingRatings.has(recordingKey(v.track))).map(v=>v.track.id),...[...pendingRatings.values()].filter(value=>value.rating==='dislike').map(value=>value.track.id)],fullscreen:!!win?.isFullScreen?.(),current,volume,queue,serviceQueue:orderedPlayback?[]:visibleQueue.slice(queue.length),queueCategories,playbackMode,videoAvailable,library:saved,pinned,effects:store.data.effects||'full',streamingAvailable:!preview};
}
function home(){
  const status=account.status(),restoring=!!bootLibrary&&!status.connected&&!status.identityChecked;
  const saved=restoring?bootLibrary.collections:account.snapshot();
  const seen=new Set();
  const recent=store.data.history.filter(entry=>{
    const key=recordingKey(entry.track);
    if(seen.has(key))return false;seen.add(key);return true;
  }).map(entry=>entry.track);
  for(const track of [...(saved.history||[]).map(entry=>entry.track).filter(Boolean),...(saved.recent||[])]){
    const key=recordingKey(track);if(!seen.has(key)){seen.add(key);recent.push(track);}
  }
  const playlists=[...new Map([...confirmedPlaylists.values(),...(saved.playlists||[])].map(p=>[p.id,p])).values()].map(p=>({...p,...playlistMetadata.get(p.id)}));
  const listening=buildHomeHistory({history:store.data.history,remoteHistory:saved.history||[],recent:saved.recent||[],playlists,artists:[...(saved.subscriptions||[]),...artistPortraits.values()]});
  return {account:restoring?{...status,...bootLibrary.profile,id:bootLibrary.id,restoring:true}:status,...listening,liked:saved.liked.filter(track=>!track.categoryId||String(track.categoryId)==='10').map(track=>({...track,playlistId:'LM'})),playlists,
    ...suggestions,
    releases:saved.releases?.length?saved.releases:suggestions.releases,
    discover:saved.discover?.length?saved.discover:suggestions.discover,radioActive:store.data.radioActive,historyAvailable:recent.length>0};
}
let currentRating,ratingReadGeneration=-1,ratingReadSerial=0;
let stateRevision=0,lastStateKey='';
let remoteState=null;
function broadcast(){
  const trackNow=store.data.current;
  const key=JSON.stringify([stateRevision,trackNow?.id,trackNow?.title,trackNow?.artwork,trackNow?.artist,state.playing,state.loading,state.error,state.duration,store.data.shuffle,store.data.repeat,currentRating,playbackMode,videoAvailable,orderedPlayback,!!win?.isFullScreen?.()]);
  if(key!==lastStateKey){lastStateKey=key;send('state',snapshot());}
  send('progress',{id:trackNow?.id||null,position:state.position,duration:state.duration});
  const track=store.data.current;
  if(!native?.updateNowPlaying)return;
  if(!track||state.error||!generation){
    if(remoteState)native.updateNowPlaying(null);
    remoteState=null;return;
  }
  const now=performance.now();
  if(remoteState&&remoteState.id===track.id&&remoteState.playing===state.playing&&remoteState.duration===state.duration){
    const expected=remoteState.position+(remoteState.playing?(now-remoteState.at)/1000:0);
    if(Math.abs(expected-state.position)<1)return;
  }
  remoteState={id:track.id,playing:state.playing,position:state.position,duration:state.duration,at:now};
  native.updateNowPlaying({...remoteState,title:track.title,artist:track.artist,album:track.album||''});
}
function reconcileQueueVariants(){
  const original=store.data.queue,next=mergeRecordingVariants(original,store.data.current,true);
  if(next.length===original.length)return false;
  const kept=new Set(next),removed=new Set(original.filter(track=>!kept.has(track)));
  store.data.queue=next;playbackCycle=playbackCycle.filter(track=>!removed.has(track));unshuffledQueue=unshuffledQueue.filter(track=>!removed.has(track));
  return true;
}
function commit(){reconcileQueueVariants();stateRevision++;store.write();broadcast();refreshMenu();}
function emitHome(){const value=home();send('home',value);hydrateArtistPortraits(value.recentArtists);}
function hydrateArtistPortraits(artists=[]){
  if(artistHydration||state.playing||artistAttempted.size>=1||!account?.catalog||!account.status().connected)return;
  const queue=artists.slice(0,6).filter(a=>!a.artwork&&!artistAttempted.has(a.id||a.title)).slice(0,1);
  if(!queue.length)return;
  const epoch=sessionEpoch;
  artistHydration=Promise.all([0].map(async()=>{
    while(queue.length&&epoch===sessionEpoch){const ref=queue.shift(),key=ref.id||ref.title;artistAttempted.add(key);
      try{const page=await account.catalog('artist',ref);if(epoch!==sessionEpoch)return;if(page?.artwork){const portrait={id:page.id,title:page.title,artwork:page.artwork};artistPortraits.set(key,portrait);metadataCache?.set('portrait:'+key,portrait,7*86400000);send('home',home());}}catch{}
    }
  })).finally(()=>{artistHydration=null;});
}

function persistListen(){
  if(!store)return;
  let dirty=false;
  if(generation&&store.data.current&&Number.isFinite(state.position)){
    const current=store.data.current,position=0;
    store.data.resume={id:current.id,source:current.source,position,duration:state.duration||current.duration||0};dirty=true;
  }
  const entry=playEntry&&store.data.history.find(item=>item.playId===playEntry);
  if(entry&&listenClock.seconds>(entry.listenSeconds||0)){entry.listenSeconds=listenClock.seconds;lastListenWrite=listenClock.seconds;dirty=true;}
  if(dirty)store.write();
}
function publishLikedPlaylist(){
  const tracks=musicLikes();playlistLoads.delete('LM');playlistCatalog.set('LM',tracks);
  metadataCache?.set('playlist:LM',tracks,3600000);
  send('playlistUpdate',{id:'LM',sort:'default',tracks:applyOrder(tracks,store.data.playlistOrders?.LM),complete:true});
}
function isDisliked(track){const pending=pendingRatings.get(recordingKey(track));if(pending)return pending.rating==='dislike';return (store.data.feedback?.votes||[]).some(v=>v.sign===-1&&recordingKey(v.track)===recordingKey(track));}
function combinedQueue(){return mergeRecordingVariants([...store.data.queue,...(orderedPlayback?[]:serviceQueue)],store.data.current,true);}
function overrideQueue(tracks,preserveOrder=false){
  if(preserveOrder&&orderedPlayback){
    const kept=new Map(),removed=new Map();
    for(const track of tracks)kept.set(track,(kept.get(track)||0)+1);
    for(const track of store.data.queue){const count=kept.get(track)||0;if(count)kept.set(track,count-1);else removed.set(track,(removed.get(track)||0)+1);}
    playbackCycle=playbackCycle.filter(track=>{const count=removed.get(track)||0;if(!count)return true;removed.set(track,count-1);return false;});
    unshuffledQueue=restoreUpcoming(unshuffledQueue,tracks);
  }else{playbackCycle=[store.data.current,...tracks].filter(Boolean);unshuffledQueue=[...tracks];}
  store.data.queue=tracks;serviceQueue=[];orderedPlayback=true;activePlaylistId=null;
  void syncSourceSettings().catch(()=>{});
}
function sourceSettings(){return {shuffle:orderedPlayback?false:store.data.shuffle,repeat:orderedPlayback&&store.data.repeat!=='one'?'off':store.data.repeat};}
async function syncSourceSettings(){
  if(store.data.current?.source!=='youtube'||!account.setPlaybackSettings){settingsPending=false;return;}
  const selected=generation,epoch=sessionEpoch,serial=++settingsSerial;
  settingsPending=true;
  try{
    const actual=await account.setPlaybackSettings(sourceSettings());
    if(selected!==generation||epoch!==sessionEpoch||serial!==settingsSerial)return;
    sourceSettingsGeneration=selected;
    if(!orderedPlayback){store.data.shuffle=actual.shuffle;store.data.repeat=actual.repeat;commit();}
  }finally{if(serial===settingsSerial)settingsPending=false;}
}
async function setQueueMode(name,value){
  if(name==='shuffle'&&typeof value!=='boolean')throw Error('Choose shuffle on or off.');
  if(name==='repeat'&&!['off','all','one'].includes(value))throw Error('Choose repeat off, all, or one.');
  const write=++modeWriteSerial,previous=store.data[name],queue=store.data.queue,original=unshuffledQueue;
  const selected=generation,selectedId=store.data.current?.id,epoch=sessionEpoch;
  store.data[name]=value;
  if(name==='shuffle'&&(orderedPlayback||store.data.current?.source==='local')){
    if(value&&!previous){unshuffledQueue=[...queue];const pool=orderedPlayback&&playbackCycle.length?playbackCycle.filter(t=>!cyclePlayed.has(t)&&!isDisliked(t)):queue;store.data.queue=shuffleTail(pool);}
    if(!value&&previous){store.data.queue=restoreUpcoming(orderedPlayback&&playbackCycle.length?playbackCycle:unshuffledQueue,queue.filter(t=>!cyclePlayed.has(t)));unshuffledQueue=[];}
  }
  commit();
  try{await syncSourceSettings();}
  catch(error){
    if(write===modeWriteSerial&&selected===generation&&selectedId===store.data.current?.id&&epoch===sessionEpoch){store.data[name]=previous;store.data.queue=restoreUpcoming(queue,store.data.queue);unshuffledQueue=original;commit();}
    throw error;
  }
}

async function refreshHome(sync=true,automatic=false){
  const epoch=sessionEpoch;
  // Account loading must start even while guest recommendation work is pending.
  if(sync&&account.status().connected){
    if(!libraryRefresh||libraryRefresh.epoch!==epoch){
      const request={epoch};libraryRefresh=request;
      request.promise=Promise.resolve().then(()=>account.sync(automatic?{allowCached:true}:undefined)).finally(()=>{if(libraryRefresh===request)libraryRefresh=null;});
    }
    await libraryRefresh.promise;
  }
  if(epoch!==sessionEpoch)return home();
  emitHome();
  if(automatic)return home();
  if(refreshing?.epoch===epoch)return refreshing.promise;
  const request={epoch};refreshing=request;
  request.promise=(async()=>{
    try{
      const data=account.snapshot();
      const result=await recommendations.home({liked:musicLikes(),subscriptions:data.subscriptions,history:store.data.history});
      if(epoch===sessionEpoch){suggestions=result;emitHome();}
    }finally{if(refreshing===request)refreshing=null;}
    return home();
  })();
  return request.promise;
}
function playTrack(track,remember=true,preserveOrder=false,startPosition=0){
  currentRating=undefined;ratingReadGeneration=-1;ratingReadSerial++;
  if(!track)return;
  persistListen();
  if(!preserveOrder){if(orderedPlayback)store.data.queue=[];orderedPlayback=false;activePlaylistId=null;playbackCycle=[];unshuffledQueue=[];cyclePlayed=new Set();}
  cyclePlayed.add(track);
  if(remember&&store.data.current&&(preserveOrder||!same(track,store.data.current)))navigationHistory.push(store.data.current);
  navigationHistory=navigationHistory.slice(-100);
  // Keep the same source document alive; its navigation replaces the stream.
  // A late asynchronous stop could otherwise pause the newly selected song.
  if(store.data.current?.source!=='youtube'||track.source!=='youtube')engine('stop');
  preparedFor='';seekIntent.clear();generation++;sourceSettingsGeneration=-1;listenClock.reset();
  playEntry=listeningSession+':'+(++listenSerial);lastListenWrite=0;
  serviceQueue=[];
  playbackMode=videoOnly?'video':'song';videoAvailable=videoOnly;
  store.data.current=track;
  state={playing:false,position:Math.max(0,startPosition),duration:track.duration||0,loading:true,error:''};
  commit();
  if(track.source==='local')engine('load',{track,volume:store.data.volume,startPosition});
  else {
    const request=generation;
    settingsPending=true;
    Promise.resolve(account.play(track,request,store.data.volume,startPosition)).then(()=>{if(generation===request)return syncSourceSettings().catch(()=>{});}).catch(error=>{
      if(generation===request){settingsPending=false;state.error=error.message;state.loading=false;state.playing=false;broadcast();refreshMenu();}
    });
  }
}
async function next(ended=false){
  if(ended&&videoNextPending?.generation===generation)return;
  const videoRequest=++videoNextSerial,selectedGeneration=generation;
  if(ended&&store.data.repeat==='one'&&!isDisliked(store.data.current)){
    if(store.data.current?.source==='local')playTrack(store.data.current,false,true);
    else {
      // The source loops repeat-one without a navigation or buffering gap.
      persistListen();listenClock.reset();recordedGeneration=-1;playEntry=listeningSession+':'+(++listenSerial);lastListenWrite=0;
      state.position=0;state.playing=false;state.loading=true;broadcast();
    }
    return;
  }
  if(videoOnly&&!orderedPlayback&&!store.data.queue.length){await account.command('next');return;}
  store.data.queue=store.data.queue.filter(t=>!isDisliked(t));
  if(!store.data.queue.length&&orderedPlayback&&store.data.repeat==='all'){
    const available=playbackCycle.filter(t=>!isDisliked(t));
    const cycle=store.data.shuffle?shuffleTail(available):available;
    if(cycle.length>1&&cycle[0]===store.data.current){const other=cycle.findIndex(t=>t!==store.data.current);if(other>0)[cycle[0],cycle[other]]=[cycle[other],cycle[0]];}
    store.data.queue=cycle;cyclePlayed=new Set();
  }
  if(!orderedPlayback&&!store.data.queue.length&&store.data.current?.source==='youtube'&&serviceQueue[0]&&account.hasPrepared?.(serviceQueue[0].id)){playTrack(serviceQueue[0]);return;}
  if(ended&&store.data.current?.source==='youtube'&&store.data.queue[0]&&account.waitForNaturalAdvance){
    const selected=generation,candidate=store.data.queue[0];
    if(await account.waitForNaturalAdvance(candidate.id)){return;}
    if(selected!==generation||store.data.queue[0]!==candidate)return;
  }
  while(store.data.queue.length){
    let candidate=store.data.queue.shift();if(isDisliked(candidate))continue;
    if(videoOnly&&account.resolveVideo){
      const pending={generation,serial:videoRequest};videoNextPending=pending;
      let video;
      try{video=await account.resolveVideo(candidate,true);}
      catch(error){if(generation===selectedGeneration&&videoRequest===videoNextSerial)store.data.queue.unshift(candidate);throw error;}
      finally{if(videoNextPending===pending)videoNextPending=null;}
      if(generation!==selectedGeneration||videoRequest!==videoNextSerial)return;
      if(!video)continue;
      candidate={...candidate,...video};
    }
    playTrack(candidate,true,orderedPlayback);return;
  }
  if(orderedPlayback){engine('pause');state.playing=false;state.loading=false;listenClock.setPlaying(false);broadcast();refreshMenu();return;}
  if(store.data.radioActive){await radio('skip');return;}
  if(ended&&store.data.current?.source==='youtube'&&isDisliked(store.data.current)){engine('next');return;}
  if(ended&&store.data.current?.source==='youtube'&&store.data.repeat==='all'){return;}
  if(ended&&store.data.current?.source==='local'&&store.data.repeat==='all'){
    const list=store.data.library.filter(t=>t.source==='local'&&!isDisliked(t));
    const at=list.findIndex(t=>same(t,store.data.current)),choices=list.filter(t=>!same(t,store.data.current));
    const candidate=store.data.shuffle&&choices.length?choices[Math.floor(Math.random()*choices.length)]:list[(at+1)%list.length];
    if(candidate){playTrack(candidate);return;}
  }
  if(ended&&store.data.current?.source==='youtube'&&account.hasDuplicateNext?.()){engine('next');return;}
  if(ended){state.playing=false;state.loading=false;listenClock.setPlaying(false);broadcast();refreshMenu();return;}
  if(store.data.current?.source==='youtube'){engine('next');return;}
  const list=store.data.library.filter(t=>t.source==='local'&&!isDisliked(t)),current=store.data.current;
  const others=list.filter(t=>!same(t,current));
  if(list.length)playTrack(store.data.shuffle&&others.length?others[Math.floor(Math.random()*others.length)]:list[(list.findIndex(t=>same(t,current))+1)%list.length]);
}
function rateInOrder(id,rating){
  const epoch=sessionEpoch;
  const operation=ratingTail.then(async()=>{if(epoch!==sessionEpoch)throw new Error('The account changed. Try again.');ratingReadSerial++;await account.rate(id,rating);if(epoch===sessionEpoch&&store.data.current?.id===id){currentRating=rating;broadcast();}if(epoch===sessionEpoch)publishLikedPlaylist();});
  ratingTail=operation.catch(()=>{});
  return operation;
}
async function command(name,value){
  if(['rateTrack','saveTrack','removeSaved'].includes(name)&&!account.status().connected&&bootLibrary){const owner=bootLibrary.id;await account.start();if(account.status().id!==owner)throw Error('The connected account changed. Try again.');}
  const epoch=sessionEpoch;
  const data=store.data;
  switch(name){
    case 'videoOnly':videoOnly=value===true;account.setCinema?.(videoOnly);preparedFor='';return;
    case 'playTrack':playTrack(store.normalize(value));return;
    case 'shuffle':case 'repeat':await setQueueMode(name,value);return;
    case 'toggle':
      if(!data.current)return;
      if(!generation||state.error)return playTrack(data.current,false,orderedPlayback,!generation?0:state.position);
      engine(state.playing||state.loading?'pause':'play');return;
    case 'play':if(!state.playing)await command('toggle');return;
    case 'pause':if(state.playing||state.loading)engine('pause');return;
    case 'next':await next();return;
    case 'previous':
      if(orderedPlayback){
        if(state.position>3||!navigationHistory.length){engine('seek',0);return;}
        data.queue.unshift(data.current);playTrack(navigationHistory.pop(),false,true);return;
      }
      if(data.current?.source==='youtube'&&state.position<=3){engine('previous');return;}
      if(state.position>3||!navigationHistory.length){engine('seek',0);return;}
      playTrack(navigationHistory.pop(),false);return;
    case 'fullscreen':if(typeof value==='boolean'){win.setFullScreen(value);broadcast();}return;
    case 'seek':{
      if(!Number.isFinite(value)||state.duration<=0)return;
      const target=Math.max(0,Math.min(state.duration,value)),selected=generation,serial=seekIntent.begin(target,performance.now());
      state.position=target;listenClock.setPlaying(state.playing);broadcast();
      if(data.current?.source==='youtube'){
        try{await account.command('seek',target);}
        catch(error){if(selected===generation&&seekIntent.cancel(serial)){state.error=error.message;broadcast();}throw error;}
      }else engine('seek',target);
      return;
    }
    case 'mute':if(data.volume>0)data.lastAudibleVolume=data.volume;return command('volume',data.volume>0?0:(data.lastAudibleVolume||.7));
    case 'volume':if(!Number.isFinite(value))return;data.volume=Math.max(0,Math.min(1,value));if(data.volume>0)data.lastAudibleVolume=data.volume;engine('volume',data.volume);break;
    case 'effects':if(!['system','full'].includes(value))return;data.effects=value;applyMaterial();break;
    case 'pin':data.pinned=Boolean(value);win.setAlwaysOnTop(data.mode==='mini'&&data.pinned,'floating');break;
    case 'queueTrack':{const track=store.normalize(value);if(track){data.queue.push(track);if(orderedPlayback)playbackCycle.push(track);}break;}
    case 'playNext':{const track=store.normalize(value);if(track){data.queue.unshift(track);if(orderedPlayback)playbackCycle.push(track);}break;}
    case 'playQueue':{
      const tracks=combinedQueue();if(!Number.isInteger(value)||!tracks[value])return;
      overrideQueue(tracks.slice(value+1));playTrack(tracks[value],true,true);return;
    }
    case 'removeQueue':{
      const tracks=combinedQueue();if(!Number.isInteger(value)||!tracks[value])return;
      tracks.splice(value,1);overrideQueue(tracks,true);break;
    }
    case 'removeQueued':if(Number.isInteger(value)&&value>=0&&value<data.queue.length)return command('removeQueue',value);return;
    case 'rateTrack':{
      const track=store.normalize(value?.track),rating=value?.rating;
      if(!track||!['like','dislike','none'].includes(rating))throw Error('Choose a song rating.');
      const pending={track,rating},key=recordingKey(track);pendingRatings.set(key,pending);stateRevision++;broadcast();publishLikedPlaylist();emitHome();
      try{if(track.source==='youtube')await rateInOrder(track.id,rating);}
      catch(error){if(pendingRatings.get(key)===pending){pendingRatings.delete(key);stateRevision++;broadcast();publishLikedPlaylist();emitHome();}throw error;}
      if(pendingRatings.get(key)===pending)pendingRatings.delete(key);
      if(epoch!==sessionEpoch)return;
      data.feedback={votes:(data.feedback?.votes||[]).filter(v=>recordingKey(v.track)!==key)};
      if(rating!=='none')data.feedback=recordVote(data.feedback,rating,track);
      if(rating==='like')store.save(track);else data.library=data.library.filter(t=>!same(t,track));
      serviceQueue=serviceQueue.filter(t=>!isDisliked(t));
      commit();emitHome();return;
    }
    case 'saveTrack':return command('rateTrack',{track:value,rating:'like'});
    case 'removeSaved':return command('rateTrack',{track:value,rating:'none'});
    default:return;
  }
  commit();emitHome();
}
function report(id,event,source='local'){
  const track=store.data.current;
  if(!track||track.source!==source||id!==track.id||!event||event.generation!==generation)return;
  const wasPlaying=state.playing;
  if(event.type==='loop'){
    if(store.data.repeat!=='one')return;
    if(isDisliked(track)){void next(true);return;}
    persistListen();listenClock.reset();listenClock.setPlaying(state.playing);recordedGeneration=-1;
    playEntry=listeningSession+':'+(++listenSerial);lastListenWrite=0;state.position=0;
  }else if(event.type==='progress'){
    if(!seekIntent.accept(event.position,performance.now(),state.playing))return;
    if(Number.isFinite(event.position))state.position=Math.max(0,event.position);
    if(Number.isFinite(event.duration)&&event.duration>0){state.duration=event.duration;track.duration=event.duration;}
    if(state.playing&&state.position>=1&&source==='youtube'&&account.prepareNext){const candidate=combinedQueue().find(track=>!isDisliked(track)),key=generation+':'+candidate?.id;if(!candidate){preparedFor='';account.cancelPrepared?.();}else if(key!==preparedFor){preparedFor=key;void Promise.resolve(videoOnly&&account.resolveVideo?account.resolveVideo(candidate).then(video=>{if(video&&generation+':'+candidate.id===preparedFor)return account.prepareNext(video);}):account.prepareNext(candidate)).catch(()=>{});}}
    const listened=listenClock.progress(state.position,performance.now());
    const threshold=state.duration>0?Math.min(10,state.duration*.5):10;
    if(listened>=threshold&&state.playing&&recordedGeneration!==generation){
      recordedGeneration=generation;store.record(track,{playId:playEntry,listenSeconds:listened});lastListenWrite=listened;emitHome();
    }
    if(recordedGeneration===generation&&listened-lastListenWrite>=15)persistListen();
  }else if(event.type==='ended'){void next(true);return;}
  else if(event.type==='error'){state.error=String(event.message||'Playback unavailable.').slice(0,500);state.loading=false;state.playing=false;listenClock.setPlaying(false);}
  else if(event.type==='state'){
    state.loading=event.state==='buffering';state.playing=event.state==='playing';
    if(wasPlaying!==state.playing){if(wasPlaying)persistListen();listenClock.setPlaying(state.playing);}
    if(state.playing&&source==='youtube'&&!settingsPending&&sourceSettingsGeneration!==generation)void syncSourceSettings().catch(()=>{});
    if(state.playing){state.error='';if(source==='youtube'&&ratingReadGeneration!==generation&&account.getRating){ratingReadGeneration=generation;const serial=++ratingReadSerial,selected=generation;void Promise.resolve(account.getRating(track.id)).then(value=>{if(selected===generation&&serial===ratingReadSerial&&['none','like','dislike'].includes(value)){currentRating=value;broadcast();}}).catch(()=>{});}}
  }
  audioMotion.setPlaying(state.playing&&track.source==='youtube');
  broadcast();
  if(wasPlaying!==state.playing||event.type==='error')refreshMenu();
}
function radio(vote='start'){
  if(radioTask)return radioTask;
  radioTask=runRadio(vote).finally(()=>{radioTask=null;});
  return radioTask;
}
async function runRadio(vote){
  if(!['start','like','dislike','undo','skip'].includes(vote))throw new Error('Unknown radio action.');
  const current=store.data.current;
  const epoch=sessionEpoch,selection=generation;
  if(vote==='undo'){
    if(!lastRadio)return;
    const previous=lastRadio;
    if(previous.track?.source==='youtube')await rateInOrder(previous.track.id,previous.previousRating||'none');
    if(epoch!==sessionEpoch||selection!==generation)return;
    store.data.feedback=previous.feedback;
    store.data.radioActive=previous.active;
    if(previous.track&&!same(previous.track,current))playTrack(previous.track);
    lastRadio=null;commit();emitHome();return;
  }
  const before=JSON.parse(JSON.stringify(store.data.feedback));
  let previousRating='none';
  if((vote==='like'||vote==='dislike')&&current?.source==='youtube'){
    previousRating=await account.getRating(current.id);
    if(epoch!==sessionEpoch||selection!==generation)return;
  }
  if((vote==='like'||vote==='dislike')&&!current)throw new Error('Choose a track first.');
  if((vote==='like'||vote==='dislike')&&current.source==='youtube')await rateInOrder(current.id,vote);
  if(epoch!==sessionEpoch||selection!==generation)return;
  const data=account.snapshot();
  if(vote==='like'||vote==='dislike'){
    lastRadio={track:current,feedback:before,active:store.data.radioActive,previousRating};
    store.data.feedback=recordVote(before,vote,current);store.data.radioActive=true;
    if(vote==='like'){commit();emitHome();return;}
    engine('pause');state.playing=false;broadcast();
  }
  const result=await recommendations.pick({vote,current,played:store.data.history,liked:musicLikes(),discover:suggestions.discover,feedback:store.data.feedback});
  if(epoch!==sessionEpoch||selection!==generation)return;
  store.data.feedback=result.feedback;
  store.data.radioActive=true;
  if(result.track&&(vote!=='like'||!current))playTrack(store.normalize(result.track));
  else if(!result.track&&vote!=='like'){commit();emitHome();throw new Error('More listening history or liked music is needed to find a new direction.');}
  commit();emitHome();
}
function fit(bounds,minWidth,minHeight){
  const area=screen.getDisplayMatching(bounds).workArea;
  const width=Math.min(area.width,Math.max(minWidth,bounds.width)),height=Math.min(area.height,Math.max(minHeight,bounds.height));
  return {width,height,x:Math.min(Math.max(bounds.x,area.x),area.x+area.width-width),y:Math.min(Math.max(bounds.y,area.y),area.y+area.height-height)};
}
function switchMode(mode){
  if(!['full','mini'].includes(mode))return;
  const data=store.data,previous=win.getBounds(),mini=mode==='mini';
  if(mode!==data.mode)data.bounds[data.mode]=previous;
  const area=screen.getDisplayMatching(previous).workArea,size=mini?{width:360,height:440}:{width:1220,height:820};
  const target=data.bounds[mode]||{...size,x:area.x+Math.round((area.width-size.width)/2),y:area.y+Math.round((area.height-size.height)/2)};
  data.mode=mode;win.setMinimumSize(mini?320:800,mini?420:590);
  win.setBounds(fit(target,mini?320:800,mini?420:590));
  win.setWindowButtonVisibility(!mini);win.setAlwaysOnTop(mini&&data.pinned,'floating');
  send('mode',mode);store.write();refreshMenu();
}
function show(mode){if(!win)return;if(mode)switchMode(mode);win.show();win.focus();}
function refreshMenu(){
  if(!tray)return;
  const track=store.data.current;
  tray.setToolTip(track?track.title+' — '+track.artist:'Opal Music Desktop');
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:track?.title||'Opal Music Desktop',enabled:false},{type:'separator'},
    {label:state.playing?'Pause':'Play',enabled:Boolean(track),click:()=>void command('toggle')},
    {label:'Previous',enabled:Boolean(track),click:()=>void command('previous')},
    {label:'Next',enabled:Boolean(track),click:()=>void command('next')},{type:'separator'},
    {label:'Mini Player',click:()=>show('mini')},{label:'Home',click:()=>show('full')},
    {label:'Hide Window',click:()=>win.hide()},{type:'separator'},{role:'quit',label:'Quit Opal Music Desktop'},
  ]));
}
function trusted(event){return win&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.origin===server.origin;}
function handle(name,fn){ipcMain.handle('music:'+name,(event,...args)=>{if(!trusted(event))throw new Error('Invalid sender');return fn(...args);});}
async function selectFiles(title,extensions,multiple=false){
  const result=await dialog.showOpenDialog(win,{title,properties:['openFile',...(multiple?['multiSelections']:[])],filters:[{name:title,extensions}]});
  return result.canceled?[]:result.filePaths;
}
async function signIn(){
  await account.signIn();emitHome();return account.status();
}
function clearAccountViews(){
  persistListen();
  bootLibrary=null;metadataCache?.clear('local');
  sessionEpoch++;pendingRatings.clear();playlistMutations.clear();
  engine('stop');seekIntent.clear();generation++;listenClock.reset();
  navigationHistory=[];refreshing=null;libraryRefresh=null;playbackCycle=[];unshuffledQueue=[];cyclePlayed=new Set();settingsSerial++;settingsPending=false;
  serviceQueue=[];
  queueCategories=[];playbackMode='song';videoAvailable=false;discoverySections=[];historyTask=null;historySyncedAt=0;playlistMetadata.clear();verifiedPlaylistMetadata.clear();confirmedPlaylists.clear();store.data.searchRecent=[];store.data.accountId=null;
  artistPortraits.clear();artistAttempted.clear();
  orderedPlayback=false;activePlaylistId=null;playlistCatalog.clear();playlistLoads.clear();playlistReadAt.clear();playlistRefreshing.clear();store.data.playlistOrders={};
  recommendations=createRecommendations({account,store});
  suggestions={releases:[],discover:[],releaseLabel:'New from artists you follow'};
  store.data.current=null;store.data.queue=[];store.data.radioActive=false;store.data.feedback={};
  store.data.library=store.data.library.filter(track=>track.source==='local');
  store.data.history=store.data.history.filter(entry=>entry.track.source==='local');
  state={playing:false,position:0,duration:0,error:'',loading:false};
  lastRadio=null;commit();emitHome();
}
async function signOut(){
  wasConnected=false;accountIdentity=null;clearAccountViews();
  await account.signOut();emitHome();
}
let applyMaterial=()=>{};
async function setup(){
  if(process.platform==='darwin'&&app.dock){
    const icon=nativeImage.createFromPath(path.resolve(__dirname,'../../assets/Music-dock.png'));
    if(!icon.isEmpty())app.dock.setIcon(icon);
  }
  store=new Library(app.getPath('userData'));
  if(reconcileQueueVariants())store.write();
  state.duration=store.data.current?.duration||0;state.position=0;
  bootLibrary=readBootLibrary(app.getPath('userData'),store.data.accountId);
  if(bootLibrary){const cached=bootLibrary.collections;store.reconcileMetadata([...(cached.songs||[]),...(cached.liked||[]),...(cached.recent||[]),...(cached.history||[]).map(entry=>entry.track)]);}
  metadataCache=new MetadataCache(app.getPath('userData'),store.data.accountId||'local');
  if(bootLibrary?.collections.syncedAt){const previous=metadataCache.rows.get('playlist:LM'),fresh=Date.parse(bootLibrary.collections.syncedAt);if(!previous||fresh>(previous.updatedAt||previous.expires-3600000)){const liked=bootLibrary.collections.liked.filter(t=>!t.categoryId||String(t.categoryId)==='10');if(liked.length)metadataCache.set('playlist:LM',liked,3600000);}}
  for(const [key,row] of metadataCache.rows)if(key.startsWith('portrait:')&&row.value?.artwork)artistPortraits.set(key.slice(9),row.value);
  account=new MusicSession({
    queueOwnedByApp:()=>orderedPlayback,
    animationsEnabled:()=>store.data.effects==='full'||!systemPreferences?.getAnimationSettings?.()?.prefersReducedMotion,
    onEvent:event=>{
      if(!account||!store)return;
      const id=event.id;
      if(event.type==='desktop-command'){if(event.name==='exitCinema'){send('exitCinema',true);videoOnly=false;account.setCinema?.(false);}else {const selected=generation;void command(event.name,event.value).catch(error=>{if(selected===generation){state.error=error.message;broadcast();}});}return;}
      if(event.type==='settings'){
        if(event.generation===generation&&id===store.data.current?.id&&store.data.current?.source==='youtube'&&!orderedPlayback&&!settingsPending&&sourceSettingsGeneration===generation&&typeof event.shuffle==='boolean'&&['off','all','one'].includes(event.repeat)){
          store.data.shuffle=event.shuffle;store.data.repeat=event.repeat;commit();
        }
        return;
      }
      if(event.type==='mode'){
        if(event.generation===generation){playbackMode=event.mode==='video'?'video':'song';videoAvailable=Boolean(event.videoAvailable);broadcast();}
        return;
      }
      if(event.type==='queue'){
        if(store.data.current?.source==='youtube'&&id===store.data.current.id&&event.generation===generation&&Array.isArray(event.tracks)){
          preparedFor='';stateRevision++;serviceQueue=mergeRecordingVariants(event.tracks.slice(0,1000).map(track=>store.normalize(track)).filter(track=>track&&!isDisliked(track)),store.data.current);
          if(Array.isArray(event.categories))queueCategories=event.categories.map(item=>({id:String(item.id).slice(0,200),title:String(item.title).slice(0,100),selected:!!item.selected}));
          broadcast();
        }
        return;
      }
      if(event.type==='track'&&event.track){
        const selected=store.normalize(event.track);
        if(selected&&store.data.current?.source==='youtube'){
          const fromOld=event.generation!==generation;
          if(fromOld)return;
          if(!same(selected,store.data.current)){
            if(!event.counterpart&&selected.id!==store.data.current.id&&recordingKey(selected)===recordingKey(store.data.current)){
              engine('next');return;
            }
            if((orderedPlayback||store.data.queue.length)&&!event.counterpart){
              const expected=store.data.queue[0];
              if(!expected||!same(selected,expected)){void next(true);return;}
              store.data.queue.shift();cyclePlayed.add(expected);navigationHistory.push(store.data.current);
              event.track={...selected,...expected};
            }
            if(isDisliked(selected)&&!event.counterpart){
              const selection=generation;
              Promise.resolve(account.command('next')).catch(error=>{
                if(selection!==generation)return;
                void Promise.resolve(account.command('pause')).catch(()=>{});
                state.playing=false;state.loading=false;state.error=error.message;listenClock.setPlaying(false);broadcast();
              });return;
            }
            serviceQueue=[];
            if(event.counterpart){const current=store.data.current;event.track={...selected,title:current.title,artist:current.artist,artwork:current.artwork,album:current.album,albumId:current.albumId,channelId:current.channelId,artists:current.artists,playContext:current.playContext};}
            persistListen();store.data.current=store.normalize(event.track);seekIntent.clear();sourceSettingsGeneration=-1;
            if(!event.counterpart){listenClock.reset();recordedGeneration=-1;playEntry=listeningSession+':'+(++listenSerial);lastListenWrite=0;}
            state={playing:false,position:0,duration:selected.duration||0,error:'',loading:true};commit();
          }else if(store.reconcileMetadata?.([selected])){stateRevision++;broadcast();emitHome();}
        }
        return;
      }
      report(id,event,'youtube');
    },
    onAccount:()=>{
      if(!account||!store)return;
      const collections=account.snapshot();store.reconcileMetadata?.([...(collections.songs||[]),...(collections.liked||[]),...(collections.recent||[]),...(collections.history||[]).map(entry=>entry.track)]);
      stateRevision++;const status=account.status(),connected=status.connected;
      const identity=status.id||null;
      if(status.identityChecked&&!connected)bootLibrary=null;
      if(connected&&identity){bootLibrary=null;if(metadataCache?.owner!==identity)metadataCache?.clear(identity);}
      if(connected&&identity&&store.data.accountId&&identity!==store.data.accountId){clearAccountViews();wasConnected=false;accountIdentity=null;}
      if(connected&&identity&&store.data.accountId!==identity){store.data.accountId=identity;store.write();}
      if(connected&&identity&&accountIdentity&&identity!==accountIdentity){
        clearAccountViews();wasConnected=false;
      }
      if(connected&&identity)accountIdentity=identity;
      if(connected&&!wasConnected){
        sessionEpoch++;pendingRatings.clear();playlistMutations.clear();refreshing=null;libraryRefresh=null;
        wasConnected=true;
        void refreshHome(true,true).catch(()=>{});
      }
      if(!connected){if(wasConnected)clearAccountViews();wasConnected=false;accountIdentity=null;}
      emitHome();broadcast();
    }
  });
  recommendations=createRecommendations({account,store});
  server=await createServer({artworkDir:path.join(app.getPath('userData'),'Artwork Cache')});
  protocol.handle('music-media',async req=>{
    const url=new URL(req.url);
    const file=url.hostname==='track'&&store.files[url.pathname.slice(1)]?.path;
    if(!file||(req.headers.get('Origin')&&req.headers.get('Origin')!==server.origin))return new Response(null,{status:403});
    try{return await serveImport(file,req,server.origin);}catch{return new Response('File unavailable',{status:404});}
  });
  win=new BrowserWindow({title:'Opal Music Desktop',width:1220,height:820,minWidth:800,minHeight:590,show:false,transparent:true,
    backgroundColor:'#00000000',titleBarStyle:'hiddenInset',trafficLightPosition:{x:20,y:20},
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}});
  account.attachHost?.(win);
  applyMaterial=()=>{
    if(nativeTheme.prefersReducedTransparency&&store.data.effects!=='full'&&!preview){win.setVibrancy(null);win.setBackgroundColor('#f2eef1');return;}
    win.setBackgroundColor('#00000000');
    if(!native?.attachGlass(win.getNativeWindowHandle(),24))win.setVibrancy('under-window');
  }
  applyMaterial();nativeTheme.on('updated',applyMaterial);
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  win.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==server.origin)event.preventDefault();});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.on('close',event=>{if(!quitting){event.preventDefault();win.hide();}});
  handle('state',snapshot);handle('home',home);handle('command',command);handle('report',(id,event)=>report(id,event,'local'));
  handle('getMode',()=>store.data.mode);handle('mode',switchMode);
  handle('openAccount',()=>account.show());handle('cancelSignIn',()=>account.cancelSignIn?.());handle('signIn',signIn);handle('signOut',signOut);
  handle('passkeyStart',()=>account.startPasskeySignIn());
  handle('passkeyComplete',async()=>{await account.completePasskeySignIn();emitHome();return account.status();});
  handle('passkeyCancel',()=>account.cancelPasskeySignIn());handle('refreshHome',()=>refreshHome());
  async function readPlaylist(id,sort,force=false){
    if(sort!==undefined&&!['default','newest','oldest'].includes(sort))throw Error('Choose a supported playlist order.');
    let epoch=sessionEpoch;
    // The verified account snapshot and confirmed rating mutations already own
    // Liked Music. Opening it must not scrape hundreds of rows a second time.
    if(id==='LM'&&sort===undefined&&!force&&account.status().connected&&account.snapshot().liked.length){
      const tracks=musicLikes().map(track=>store.normalize(track)).filter(Boolean);
      playlistCatalog.set(id,tracks);playlistReadAt.set(id,Date.now());
      return applyOrder(tracks,store.data.playlistOrders?.[id]);
    }
    if(sort===undefined&&!force&&playlistCatalog.has(id)){
      if(Date.now()-(playlistReadAt.get(id)||0)>30000&&!playlistRefreshing.has(id)&&!playlistMutations.has(id)){playlistRefreshing.add(id);setTimeout(()=>{void readPlaylist(id,undefined,true).catch(()=>{}).finally(()=>playlistRefreshing.delete(id));},0);}
      return applyOrder(playlistCatalog.get(id),store.data.playlistOrders?.[id]);
    }
    if(playlistMutations.has(id))return applyOrder(playlistCatalog.get(id)||[],store.data.playlistOrders?.[id]);
    const cached=sort===undefined&&!force&&!playlistCatalog.has(id)?metadataCache.get('playlist:'+id):null;
    const request={};playlistLoads.set(id,request);
    const normalizeTracks=received=>{
      const buckets=new Map();for(const track of playlistCatalog.get(id)||[]){const items=buckets.get(track.id)||[];items.push(track);buckets.set(track.id,items);}
      return received.map(track=>{
        const value=store.normalize({...track,playlistId:id});if(!value)return null;
        const existing=buckets.get(value.id)?.shift();return existing?Object.assign(existing,value):value;
      }).filter(Boolean);
    };
    const ordered=tracks=>sort===undefined?applyOrder(tracks,store.data.playlistOrders?.[id]):tracks;
    if(Array.isArray(cached)){const tracks=normalizeTracks(cached);playlistCatalog.set(id,tracks);playlistMetadata.set(id,{...playlistMetadata.get(id),id,count:tracks.length});setTimeout(()=>{void readPlaylist(id,sort,true).catch(()=>{});},0);return ordered(tracks);}
    if(!account.status().connected&&bootLibrary){const owner=bootLibrary.id;await account.start();if(account.status().id!==owner)throw Error('The connected account changed.');epoch=sessionEpoch;}
    const received=await account.playlist(id,{sort:sort||'default',onPage:page=>{
      if(epoch!==sessionEpoch||playlistLoads.get(id)!==request)return;
      const tracks=normalizeTracks(Array.isArray(page)?page:page.tracks||[]);if(!tracks.length)return;
      playlistCatalog.set(id,tracks);send('playlistUpdate',{id,sort:sort||'default',tracks:ordered(tracks),complete:false});
    }});
    if(epoch!==sessionEpoch)throw Error('The account changed. Open this playlist again.');
    if(playlistLoads.get(id)!==request){const current=playlistCatalog.get(id);if(current&&!playlistLoads.has(id))return sort===undefined?applyOrder(current,store.data.playlistOrders?.[id]):current;throw Error('Playlist selection changed.');}
    const tracks=normalizeTracks(received);
    playlistReadAt.set(id,Date.now());playlistCatalog.set(id,tracks);
    const original=home().playlists.find(p=>p.id===id);
    playlistMetadata.set(id,{...playlistMetadata.get(id),id,count:tracks.length,artwork:original?.artwork||playlistMetadata.get(id)?.artwork,mosaic:[...new Set(tracks.map(t=>t.artwork).filter(Boolean))].slice(0,4)});emitHome();
    if(sort===undefined)metadataCache.set('playlist:'+id,tracks,3600000);
    const result=ordered(tracks);send('playlistUpdate',{id,sort:sort||'default',tracks:result,complete:true});return result;
  }
  handle('playlist',readPlaylist);
  async function readPlaylistInBackground(id){try{await readPlaylist(id,undefined,true);}catch{}}
  handle('orderPlaylist',(id,ids,view)=>{
    if(view!==undefined&&!Array.isArray(view))throw Error('Invalid playlist snapshot.');
    const tracks=playlistCatalog.get(id),snapshot=Array.isArray(view)?view.map(t=>store.normalize({...t,playlistId:id})):undefined;
    const ordered=resolveVisibleOrder(tracks,ids,snapshot);
    store.data.playlistOrders||={};store.data.playlistOrders[id]=ordered.map(t=>t.id);
    if(activePlaylistId===id){
      const exact=ordered.indexOf(store.data.current);
      const position=exact>=0?exact:ordered.findIndex(t=>same(t,store.data.current));
      if(position>=0){playbackCycle=ordered;unshuffledQueue=store.data.shuffle?ordered.filter(t=>!cyclePlayed.has(t)):ordered.slice(position+1);store.data.queue=store.data.shuffle?shuffleTail(unshuffledQueue):[...unshuffledQueue];}
    }
    commit();
  });
  handle('playSequence',(input,index=0)=>{
    if(!Array.isArray(input)||!input.length||input.length>1000||!Number.isInteger(index)||index<0||index>=input.length)throw Error('Choose a song in this list.');
    const tracks=input.map(track=>store.normalize(track));if(tracks.some(track=>!track))throw Error('Invalid song list.');
    playbackCycle=tracks;cyclePlayed=new Set();unshuffledQueue=tracks.slice(index+1);store.data.queue=[...unshuffledQueue];
    store.data.radioActive=false;navigationHistory=tracks.slice(0,index).slice(-100);orderedPlayback=tracks.length>1||tracks[0].source!=='youtube';activePlaylistId=null;
    playTrack(tracks[index],false,true);broadcast();
  });
  handle('playPlaylist',(id,ids,index,view)=>{
    if(view!==undefined&&!Array.isArray(view))throw Error('Invalid playlist snapshot.');
    const tracks=playlistCatalog.get(id),snapshot=Array.isArray(view)?view.map(t=>store.normalize({...t,playlistId:id})):undefined;
    const ordered=resolveVisibleOrder(tracks,ids,snapshot);
    if(!Number.isInteger(index)||index<0||index>=ids.length)throw Error('Choose a song in this playlist.');
    const meta=home().playlists.find(p=>p.id===id);
    const context=meta&&id!=='LM'?{kind:'playlist',id,title:meta.title,artist:meta.artist,artwork:meta.artwork}:undefined;
    const withContext=ordered.map(t=>context?Object.assign(t,{playContext:context}):t);
    playbackCycle=withContext;cyclePlayed=new Set();unshuffledQueue=store.data.shuffle?withContext.filter((_,i)=>i!==index):withContext.slice(index+1);
    store.data.queue=store.data.shuffle?shuffleTail(unshuffledQueue):[...unshuffledQueue];store.data.radioActive=false;navigationHistory=store.data.shuffle?[]:withContext.slice(0,index).slice(-100);
    orderedPlayback=true;activePlaylistId=id;playTrack(withContext[index],false,true);broadcast();
  });handle('radio',radio);
  handle('lyrics',async track=>{const value=store.normalize(track);if(!value)return {lines:[],synced:false};const key='lyrics:'+JSON.stringify([value.id,value.title,value.artist,value.album,Math.round(value.duration)]),cached=metadataCache.get(key);if(cached)return cached;const epoch=sessionEpoch,result=await getLyrics(value);if(epoch===sessionEpoch&&result.source)metadataCache.set(key,result,86400000);return result;});
  handle('stats',(period,force=false)=>{
    if(!['week','month'].includes(period))throw Error('Choose the past week or past month.');
    persistListen();statsPeriod=period;
    const report=()=>{const result=computeStats({history:store.data.history,remoteHistory:account.snapshot().history||[]},statsPeriod);result.coverage.accountEntries=(account.snapshot().history||[]).length;result.coverage.loading=!!historyTask;if(historyWarning)result.coverage.scope+=' '+historyWarning;return result;};
    if(account.status().connected&&account.syncHistory&&!historyTask&&(force||Date.now()-historySyncedAt>3600000)){
      const epoch=sessionEpoch;
      let succeeded=false;
      const task=Promise.resolve().then(()=>account.syncHistory(()=>{if(epoch===sessionEpoch)send('stats',report());})).then(()=>{if(epoch===sessionEpoch){succeeded=true;historyWarning='';}}).catch(()=>{if(epoch===sessionEpoch)historyWarning='Some history could not finish loading. Refresh to try again.';}).finally(()=>{
        if(historyTask===task){historyTask=null;historySyncedAt=succeeded?Date.now():0;if(epoch===sessionEpoch)send('stats',report());}
      });historyTask=task;
    }
    return report();
  });
  handle('discovery',async(refresh=false,sectionId)=>{
    if(!refresh&&discoverySections.length)return discoverySections;
    const cached=!refresh&&metadataCache.get('discovery:home');
    if(Array.isArray(cached)&&cached.length){discoverySections=cached;return cached;}
    const epoch=sessionEpoch;
    const sections=await account.discovery(Boolean(refresh),sectionId);
    if(epoch!==sessionEpoch)return [];
    discoverySections=Array.isArray(sections)?sections:[];
    if(discoverySections.length)metadataCache.set('discovery:home',discoverySections,1800000);
    return discoverySections;
  });
  handle('playlistDetails',async id=>{
    if(typeof id!=='string'||!/^[-\w]{2,128}$/.test(id))throw Error('Invalid playlist.');
    if(verifiedPlaylistMetadata.has(id))return playlistMetadata.get(id);
    const epoch=sessionEpoch,result=await account.playlistDetails(id);
    if(epoch!==sessionEpoch)throw Error('The account changed.');
    const tracks=playlistCatalog.get(id);
    const details={...playlistMetadata.get(id),...result,...(tracks?{count:tracks.length}:{}),id};
    playlistMetadata.set(id,details);verifiedPlaylistMetadata.add(id);emitHome();return details;
  });
  handle('playlistAction',async(action,payload)=>{
    if(!['create','edit','share','add','remove','save','unsave'].includes(action))throw Error('Unsupported playlist action.');
    const id=payload?.id,previous=id?(playlistCatalog.get(id)||metadataCache.get('playlist:'+id)):null;
    const {tracks:visibleTracks,...request}=payload||{};
    const epoch=sessionEpoch;
    let mutation,projection;
    const apply=(rows,op)=>{if(op.status==='failed')return rows;const next=[...rows];for(const videoId of op.ids){if(op.action==='add'){const track=op.tracks.find(t=>t.id===videoId);if(track)next.push(track);}else{const at=next.findIndex(t=>t.id===videoId);if(at>=0)next.splice(at,1);}}return next;};
    const publish=()=>{const rows=projection.ops.reduce(apply,projection.base);playlistCatalog.set(id,rows);playlistMetadata.set(id,{...playlistMetadata.get(id),id,count:rows.length});send('playlistUpdate',{id,sort:'default',tracks:applyOrder(rows,store.data.playlistOrders?.[id]),complete:true});emitHome();};
    if(!projection&&id&&Array.isArray(previous)&&['add','remove'].includes(action)){
      projection=playlistMutations.get(id)||{base:previous,ops:[]};
      mutation={action,status:'pending',ids:payload.videoIds||[],tracks:(Array.isArray(visibleTracks)?visibleTracks:[]).map(track=>store.normalize({...track,playlistId:id})).filter(Boolean)};
      projection.ops.push(mutation);playlistMutations.set(id,projection);playlistLoads.delete(id);publish();
    }
    const settle=status=>{
      if(!projection||epoch!==sessionEpoch)return;mutation.status=status;
      while(projection.ops.length&&projection.ops[0].status!=='pending'){projection.base=apply(projection.base,projection.ops.shift());}
      publish();if(!projection.ops.length){playlistMutations.delete(id);metadataCache.set('playlist:'+id,projection.base,3600000);}
    };
    let result;
    try{result=await account.playlistAction(action,request);}catch(error){settle('failed');throw error;}
    settle('confirmed');
    if(epoch===sessionEpoch){
      if(id&&!projection){playlistLoads.delete(id);metadataCache.delete('playlist:'+id);playlistMetadata.delete(id);verifiedPlaylistMetadata.delete(id);playlistCatalog.delete(id);}
      if(!projection&&id&&Array.isArray(previous)&&['add','remove'].includes(action)){
        const rows=[...previous],incoming=(Array.isArray(visibleTracks)?visibleTracks:[]).map(t=>store.normalize({...t,playlistId:id})).filter(Boolean);
        for(const videoId of payload.videoIds||[]){
          if(action==='add'){const track=incoming.find(t=>t.id===videoId);if(track)rows.push(track);}
          else{const at=rows.findIndex(t=>t.id===videoId);if(at>=0)rows.splice(at,1);}
        }
        playlistCatalog.set(id,rows);metadataCache.set('playlist:'+id,rows,3600000);
        send('playlistUpdate',{id,sort:'default',tracks:applyOrder(rows,store.data.playlistOrders?.[id]),complete:true});
      }
      if(result?.playlist?.id){playlistMetadata.set(result.playlist.id,result.playlist);verifiedPlaylistMetadata.add(result.playlist.id);if(action==='create')confirmedPlaylists.set(result.playlist.id,result.playlist);emitHome();}
      if(action!=='share')void refreshHome(false,true).catch(()=>{});
      if(payload?.id&&!playlistMutations.has(payload.id)&&['add','remove'].includes(action))setTimeout(()=>{void readPlaylistInBackground(payload.id);},0);
    }
    return result;
  });
  handle('choosePlaylistCover',async id=>{
    if(typeof id!=='string'||!/^[-\w]{2,128}$/.test(id))throw Error('Choose a playlist.');
    const epoch=sessionEpoch;
    const files=await selectFiles('Playlist cover',['jpg','jpeg','png','webp']);
    if(!files.length)return null;
    if(epoch!==sessionEpoch)throw Error('The account changed.');
    const result=await account.playlistAction('cover',{id,filePath:files[0]});
    if(epoch!==sessionEpoch)throw Error('The account changed.');
    playlistMetadata.set(id,result.playlist);verifiedPlaylistMetadata.add(id);emitHome();return result.playlist;
  });
  handle('recentSearches',()=>{
    const owner=account.status().id||'local';return store.data.searchRecentOwner===owner?(store.data.searchRecent||[]):[];
  });
  handle('removeSearch',item=>{
    const owner=account.status().id||'local';if(store.data.searchRecentOwner!==owner)return;
    const key=value=>value?.kind==='track'?'track:'+value.track?.source+value.track?.id:value?.kind==='playlist'?'playlist:'+value.playlist?.id:value?.kind==='catalog'?'catalog:'+value.card?.kind+value.card?.id:'query:'+String(value?.query||'').toLowerCase();
    store.data.searchRecent=(store.data.searchRecent||[]).filter(value=>key(value)!==key(item));store.write();
  });
  handle('rememberSearch',item=>{
    if(!item||typeof item!=='object')return;
    let value,key;
    if(item.kind==='track'){const track=store.normalize(item.track);if(track){value={kind:'track',track};key='track:'+track.source+track.id;}}
    if(item.kind==='catalog'&&['artist','album','song'].includes(item.card?.kind)&&typeof item.card?.id==='string'&&/^[-\w]{2,128}$/.test(item.card.id)&&typeof item.card.title==='string'){value={kind:'catalog',card:{kind:item.card.kind,id:item.card.id,title:item.card.title.slice(0,500),artist:typeof item.card.artist==='string'?item.card.artist.slice(0,500):undefined,artwork:typeof item.card.artwork==='string'?item.card.artwork.slice(0,1500):undefined}};key='catalog:'+value.card.kind+value.card.id;}
    if(item.kind==='query'&&typeof item.query==='string'&&item.query.trim()){value={kind:'query',query:item.query.trim().slice(0,300)};key='query:'+value.query.toLowerCase();}
    if(item.kind==='playlist'){
      const playlist=home().playlists.find(p=>p.id===item.playlist?.id);
      if(playlist){value={kind:'playlist',playlist};key='playlist:'+playlist.id;}
    }
    if(!value)return;
    const owner=account.status().id||'local';
    const recent=store.data.searchRecentOwner===owner?(store.data.searchRecent||[]):[];
    const identity=entry=>entry.kind==='track'?'track:'+entry.track.source+entry.track.id:entry.kind==='playlist'?'playlist:'+entry.playlist.id:entry.kind==='catalog'?'catalog:'+entry.card.kind+entry.card.id:'query:'+entry.query.toLowerCase();
    store.data.searchRecent=[value,...recent.filter(entry=>identity(entry)!==key)].slice(0,16);store.data.searchRecentOwner=owner;store.write();
  });
  handle('orderQueue',(indices,keys)=>{
    const tracks=combinedQueue(),actual=tracks.map(t=>t.source+':'+t.id);
    if(!Array.isArray(indices)||!Array.isArray(keys)||indices.length!==tracks.length||keys.length!==tracks.length||tracks.length>20000||keys.some((key,i)=>key!==actual[i])||new Set(indices).size!==indices.length||indices.some(i=>!Number.isInteger(i)||i<0||i>=tracks.length))throw Error('The queue changed. Try moving the song again.');
    overrideQueue(indices.map(index=>tracks[index]));commit();
  });
  handle('queueCategory',async id=>{
    if(typeof id!=='string'||id.length>200)throw Error('Choose a queue category.');
    const epoch=sessionEpoch,selection=generation,before=JSON.stringify(store.data.queue);
    await account.queueCategory(id);
    if(epoch!==sessionEpoch||selection!==generation)return;
    if(before===JSON.stringify(store.data.queue))store.data.queue=[];
    orderedPlayback=false;activePlaylistId=null;store.data.radioActive=false;commit();
  });
  handle('setPlaybackMode',async mode=>{
    if(!['song','video'].includes(mode))throw Error('Choose Song or Video.');
    const epoch=sessionEpoch,selection=generation;
    const result=await account.setPlaybackMode(mode);
    if(epoch!==sessionEpoch||selection!==generation)return {mode:playbackMode,videoAvailable};
    playbackMode=result.mode;videoAvailable=!!result.videoAvailable;broadcast();return result;
  });
  handle('setVideoBounds',bounds=>{
    if(bounds===null)return account.setVideoBounds(null);
    if(!bounds||!['x','y','width','height'].every(key=>Number.isFinite(bounds[key])))throw Error('Invalid video bounds.');
    const area=win.getContentBounds?.()||win.getBounds();
    const x=Math.max(0,Math.min(area.width-1,Math.round(bounds.x))),y=Math.max(0,Math.min(area.height-1,Math.round(bounds.y)));
    return account.setVideoBounds({presentation:bounds.presentation==='cinema'?'cinema':'embedded',x,y,width:Math.max(1,Math.min(area.width-x,Math.round(bounds.width))),height:Math.max(1,Math.min(area.height-y,Math.round(bounds.height)))});
  });
  handle('radioFromTrack',track=>{
    const value=store.normalize(track);if(!value)throw Error('Choose a song.');
    store.data.queue=[];playTrack(value);store.data.radioActive=true;commit();emitHome();
  });
  win.on('enter-full-screen',broadcast);win.on('leave-full-screen',broadcast);
  handle('catalog',async(kind,ref)=>{
    const key='catalog:v2:'+kind+':'+JSON.stringify(ref),cached=metadataCache.get(key);if(cached)return cached;
    const epoch=sessionEpoch,result=await account.catalog(kind,ref);if(epoch===sessionEpoch){metadataCache.set(key,result,kind==='artist'?3600000:86400000);if(kind==='artist'&&result?.artwork){const portrait={id:result.id,title:result.title,artwork:result.artwork};artistPortraits.set(result.id,portrait);metadataCache.set('portrait:'+result.id,portrait,7*86400000);}}return result;
  });
  handle('artistTopSongs',async ref=>{const key='topSongs:'+JSON.stringify(ref),cached=metadataCache.get(key);if(cached)return cached;const epoch=sessionEpoch,tracks=await account.artistTopSongs(ref);if(epoch===sessionEpoch)metadataCache.set(key,tracks,3600000);return tracks;});
  handle('artistFollow',async(id,enabled)=>{const result=await account.artistFollow(id,enabled);for(const [key,row] of metadataCache.rows)if(key.startsWith('catalog:v2:artist:')&&row.value?.id===id)metadataCache.delete(key);return result;});
  handle('followedArtists',()=>account.followedArtists());
  handle('enableAudio',()=>audioMotion.enable());
  handle('searchCatalog',async query=>{
    if(typeof query!=='string'||!query.trim())return {songs:[],artists:[],albums:[],playlists:[]};
    const text=query.trim().slice(0,300),key='search:v2:'+text.toLocaleLowerCase(),cached=metadataCache.get(key);if(cached)return cached;
    const epoch=sessionEpoch,result=await account.searchCatalog(text);if(epoch===sessionEpoch)metadataCache.set(key,result,1800000);return result;
  });
  handle('search',async query=>{
    if(typeof query!=='string'||!query.trim())return [];
    const local=store.data.library.filter(track=>[track.title,track.artist].join(' ').toLowerCase().includes(query.toLowerCase()));
    try{return [...local,...await account.search(query.slice(0,300),{interactive:true})];}catch(error){if(local.length)return local;throw error;}
  });
  handle('import',async()=>{
    const paths=await selectFiles('Audio files',Object.keys(formats).map(ext=>ext.slice(1)),true);
    store.addFiles(paths);commit();emitHome();
  });
  handle('importHistory',async()=>{
    const paths=await selectFiles('Google Takeout watch history',['json','html'],true);
    let imported=0,skipped=0;
    for(const file of paths){
      if(fs.statSync(file).size>100*1024*1024)throw new Error('Select a history file smaller than 100 MB.');
      const result=importTakeout(fs.readFileSync(file,'utf8'),path.basename(file));
      const music=result.history.filter(entry=>entry.product==='youtube-music');
      const before=store.data.history.length;store.importHistory(music);
      imported+=store.data.history.length-before;skipped+=result.skipped||0;
    }
    emitHome();
    return {imported,skipped,message:imported+' music plays imported'+(skipped?' · '+skipped+' unclassified video plays skipped':'')};
  });
  handle('openTrack',track=>{
    const normalized=store.normalize(track);
    if(normalized?.source==='youtube')return account.show();
  });
  ipcMain.on('music:bands',(event,bands)=>{
    if(trusted(event)&&store.data.current?.source==='local'&&bands&&[bands.bass,bands.mid,bands.treble].every(Number.isFinite))
      send('energy',Object.fromEntries(Object.entries(bands).map(([key,value])=>[key,Math.max(0,Math.min(1,value))])));
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{label:'Music',submenu:[
    {label:'Search',accelerator:'Cmd+K',click:()=>{show('full');send('searchFocus');}},
    {label:'Toggle Mini Player',accelerator:'Cmd+Shift+M',click:()=>show(store.data.mode==='full'?'mini':'full')},
    {label:'Play / Pause',accelerator:'Cmd+Return',click:()=>void command('toggle')},
    {label:'Next Track',accelerator:'Cmd+Right',click:()=>void command('next')},
    {label:'Previous Track',accelerator:'Cmd+Left',click:()=>void command('previous')},
  ]},{role:'windowMenu'}]));
  const image=nativeImage.createFromPath(path.resolve(__dirname,'../../assets/menuTemplate.png'));image.setTemplateImage(true);
  tray=new Tray(image);
  // Every launch opens Home. The floating window is an explicit listening action.
  switchMode('full');
  await win.loadURL(server.origin+'/'+(preview?'?prototype=1':''));
  native?.initRemote?.((action,value)=>{void command(action,value).catch(error=>{state.error=error.message;broadcast();});});
  win.show();
  if(!preview){void warmLyricCatalog(app.getPath('userData')).catch(()=>{});await account.start();}
  if(account.status().connected)void refreshHome(true,true).catch(()=>{});
}
if(!app.requestSingleInstanceLock())app.quit();
else{
  app.on('second-instance',()=>show());app.on('activate',()=>show());
  app.whenReady().then(setup).catch(error=>{console.error(error);dialog.showErrorBox('Opal Music Desktop could not open',error.message);app.quit();});
  let cleanupFinished=false,cleanupPending=false;
  app.on('before-quit',event=>{
    if(cleanupFinished)return;
    if(cleanupPending){event.preventDefault();return;}
    quitting=true;metadataCache?.close();audioMotion.close();native?.disposeRemote?.();
    persistListen();
    if(store&&win&&!win.isDestroyed()){store.data.bounds[store.data.mode]=win.getBounds();store.write();}
    const cleanup=account?.close?.();server?.close();
    if(cleanup&&typeof cleanup.then==='function'){
      event.preventDefault();cleanupPending=true;
      Promise.resolve(cleanup).catch(()=>{}).finally(()=>{cleanupFinished=true;app.quit();});
    }
  });
}

