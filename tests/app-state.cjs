const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const queueModes = require('../src/main/queue-modes.cjs');
const {recordVote} = require('../src/main/recommendations.cjs');
const file = require.resolve('../src/main/index.cjs');
const appRequire = createRequire(file);
const song = {source:'youtube',id:'7nxWP9BhI7w',title:'Roads',artist:'Portishead',duration:304};
const alternative = {source:'youtube',id:'0_M2JX-Olv8',title:'Feather',artist:'Nujabes',duration:175};
const noop = ()=>{};

// Start the actual main module and call its registered IPC handlers. Only Electron,
// the remote account and recommendations are doubles. The real Library runs under
// a fresh temporary profile, exercising its storage and normalization boundaries.
async function launch(t, options={}) {
  const ready=Promise.withResolvers(),handlers=new Map(),messages=[],ratings=[],picks=[];
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'music-state-'));
  t.after(()=>fs.rmSync(directory,{force:true,recursive:true}));
  if(options.savedData)fs.writeFileSync(path.join(directory,'collection.json'),JSON.stringify({data:options.savedData}));
  const origin='http://127.0.0.1:39001',frame={origin};
  const windowEvents=new Map(),appEvents=new Map(),nativeUpdates=[],menus=[];
  let now=250000,nativeHandler;
  const hooks={alternative,liked:[],remoteRatings:new Map(),connected:true,rate:async()=>{},pick:async()=>{},selected:[],
    sourceModes:{shuffle:false,repeat:'off'},modeRequests:[],collections:{},syncCalls:0,homeCalls:0,fullscreen:false,fullscreenRequests:[],hidden:false,...options};
  class BrowserWindow {
    webContents={on:noop,setWindowOpenHandler:noop,mainFrame:frame,send:(name,value)=>messages.push({name,value:structuredClone(value)})};
    setVibrancy(){} setBackgroundColor(){} getNativeWindowHandle(){} on(name,fn){windowEvents.set(name,fn);} isDestroyed(){return false;}
    getBounds(){return {x:50,y:50,width:1200,height:800};} setBounds(){} setMinimumSize(){}
    isFullScreen(){return hooks.fullscreen;} setFullScreen(value){hooks.fullscreenRequests.push(value);}
    setWindowButtonVisibility(){} setAlwaysOnTop(){} loadURL(){} show(){hooks.hidden=false;ready.resolve();} hide(){hooks.hidden=true;}
  }
  const streamed=[],serviceCommands=[];
  class MusicSession {
    constructor({onEvent,onAccount}={}) {hooks.onEvent=onEvent;hooks.onAccount=onAccount;if(hooks.resolveVideo)this.resolveVideo=hooks.resolveVideo;}
    async start(){await hooks.start?.(this);return this.status();}
    async play(track,generation,volume,startPosition){streamed.push({track,generation,volume,startPosition});}
    hasPrepared(id){return hooks.preparedId===id;}
    async command(type,value){serviceCommands.push({type,value});await hooks.remoteCommand?.(type,value);}
    async signIn(){hooks.signIns=(hooks.signIns||0)+1;return this.status();}
    search(){return Promise.resolve([]);}
    async playlist(id,options){return hooks.playlist(id,options);}
    async discovery(refresh){return hooks.discovery?.(refresh)||[];}
    async playlistDetails(id){return hooks.playlistDetails?.(id)||{id};}
    async playlistAction(action,payload){return hooks.playlistAction?.(action,payload)||{ok:true};}
    async playbackSettings(){return {...hooks.sourceModes};}
    async setPlaybackSettings(request){
      hooks.modeRequests.push({...request});
      const result=hooks.setPlaybackSettings?await hooks.setPlaybackSettings({...request}):{...hooks.sourceModes,...request};
      hooks.sourceModes={...result};
      return {...result};
    }
    async setPlaybackMode(mode){return hooks.setPlaybackMode?.(mode)||{mode,videoAvailable:true};}
    async queueCategory(id){return hooks.queueCategory?.(id);}
    setVideoBounds(bounds){hooks.bounds=bounds;return true;}
    close(){hooks.closed=true;}
    snapshot(){return {liked:hooks.liked,subscriptions:[],playlists:[],history:[],discover:[],...hooks.collections};}
    status(){return {configured:true,connected:hooks.connected,...hooks.profile};}
    sync(){hooks.syncCalls++;return hooks.sync?hooks.sync(this):this.snapshot();}
    async getRating(id){return hooks.remoteRatings.get(id)||'none';}
    async rate(id,rating){
      ratings.push([id,rating]);await hooks.rate();
      hooks.remoteRatings.set(id,rating);
      hooks.liked=hooks.liked.filter(t=>t.id!==id);
      if(rating==='like')hooks.liked.unshift({...song,id});
    }
    async signOut(){hooks.connected=false;hooks.liked=[];}
  }
  const electron={
    app:{setName:noop,commandLine:{appendSwitch:noop},getPath:()=>directory,requestSingleInstanceLock:()=>true,on:(name,fn)=>appEvents.set(name,fn),whenReady:()=>Promise.resolve(),quit:noop},
    BrowserWindow,ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on:noop},
    protocol:{registerSchemesAsPrivileged:noop,handle:noop},
    Menu:{buildFromTemplate:items=>items,setApplicationMenu:noop},Tray:class{setToolTip(){} setContextMenu(menu){menus.push(menu);}},
    nativeImage:{createFromPath:()=>({setTemplateImage:noop})},nativeTheme:{on:noop},
    screen:{getDisplayMatching:()=>({workArea:{x:0,y:0,width:1440,height:900}})},
    session:{defaultSession:{setPermissionRequestHandler:noop}},
    dialog:{showErrorBox:(_title,error)=>ready.reject(Error(error)),showOpenDialog:async()=>({filePaths:hooks.selected,canceled:false})}
  };
  const overrides = {
    './queue-modes.cjs':{...queueModes,shuffleTail:queue=>queueModes.shuffleTail(queue,hooks.random||Math.random)},
    electron,'./music-session.cjs':{MusicSession},'./server.cjs':{createServer:async()=>({origin,close:noop})},
    '../../native/prism.node':{attachGlass:()=>true,initRemote:fn=>{nativeHandler=fn;},updateNowPlaying:state=>nativeUpdates.push(state),disposeRemote:()=>{nativeHandler=null;}},
    './recommendations.cjs':{recordVote,createRecommendations:()=>({
      home:async()=>{hooks.homeCalls++;return hooks.home?hooks.home():{releases:[],discover:[]};},
      pick:async options=>{picks.push(options);await hooks.pick();return {track:hooks.alternative,feedback:options.feedback};}
    })}
  };
  const code=fs.readFileSync(file,'utf8');
  vm.runInNewContext(code,{
    require:id=>id in overrides?overrides[id]:appRequire(id),__dirname:path.dirname(file),
    process:{argv:[],env:{}},Math:hooks.random?Object.assign(Object.create(Math),{random:hooks.random}):Math,performance:{now:()=>now},URL,console,structuredClone,setTimeout,clearTimeout,setInterval,clearInterval
  },{filename:file});
  await ready.promise;
  const invoke=(channel,...args)=>handlers.get('music:'+channel)({senderFrame:frame},...args);
  return {hooks,directory,invoke,ratings,picks,messages,frame,menus,windowEvents,appEvents,nativeUpdates,streamed,serviceCommands,
    mediaKey:(...args)=>nativeHandler(...args),advance:ms=>{now+=ms;},
    invokeFrom:(foreign,name,...args)=>handlers.get('music:'+name)(foreign,...args)};
}
test('service playback reports drive Now Playing and actual listening history; seeking or a stale report cannot fabricate it',async t=>{
  const {invoke,messages,streamed,hooks,nativeUpdates,advance}=await launch(t);
  await invoke('command','playTrack',song);
  assert.equal(invoke('state').streamingAvailable,true);
  assert.equal(streamed.length,1);
  const gen=streamed[0].generation;
  assert.equal(streamed[0].track.id,song.id);
  assert.equal(invoke('home').recent.length,0);
  // Both players use the same UI, but the trusted local renderer must not be
  // able to advance a streaming song whose reports come from MusicSession.
  await invoke('report',song.id,{type:'state',state:'playing',generation:gen});
  await invoke('report',song.id,{type:'progress',position:180,duration:304,generation:gen});
  await invoke('report',song.id,{type:'state',state:'playing',generation:gen},'youtube');
  assert.equal(invoke('state').playing,false);
  const report=(event)=>hooks.onEvent({id:song.id,generation:gen,...event});
  report({type:'state',state:'playing'});
  report({type:'progress',position:0,duration:304});
  advance(400);
  report({type:'progress',position:110,duration:304});
  assert.equal(invoke('home').recent.length,0);
  for(let n=1;n<=13;n++){advance(1000);report({type:'progress',position:110+n,duration:304});}
  assert.equal(invoke('home').recent[0]?.id,song.id);
  assert.equal(nativeUpdates.at(-1)?.id,song.id);
  assert.equal(nativeUpdates.at(-1)?.playing,true);
  await invoke('command','playTrack',alternative);
  report({type:'ended'});
  report({type:'error',message:'obsolete error'});
  assert.equal(invoke('state').current.id,alternative.id);
  assert.ok(!invoke('state').error.includes('obsolete'));
  assert.ok(messages.every(m=>m.name!=='music:engine'||m.value.type!=='load'));
});
test('system play/pause uses the active session, and native targets and service close on quit',async t=>{
  const {invoke,hooks,streamed,serviceCommands,mediaKey,appEvents}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  hooks.onEvent({id:song.id,generation,type:'state',state:'playing'});
  mediaKey('pause');
  await Promise.resolve();
  assert.equal(serviceCommands.filter(c=>c.type==='pause').length,1);
  appEvents.get('before-quit')();
  assert.equal(hooks.closed,true);
});
test('fullscreen publishes settled native window state, including a system-initiated exit',async t=>{
  const {invoke,hooks,windowEvents,messages}=await launch(t);
  const lastState=()=>messages.filter(message=>message.name==='music:state').at(-1)?.value;
  await invoke('command','fullscreen','true');
  assert.deepEqual(hooks.fullscreenRequests,[]);
  await invoke('command','fullscreen',true);
  assert.deepEqual(hooks.fullscreenRequests,[true]);
  assert.equal(invoke('state').fullscreen,false);
  hooks.fullscreen=true;windowEvents.get('enter-full-screen')();
  assert.equal(lastState().fullscreen,true);
  await invoke('command','fullscreen',false);
  assert.deepEqual(hooks.fullscreenRequests,[true,false]);
  assert.equal(invoke('state').fullscreen,true);
  hooks.fullscreen=false;windowEvents.get('leave-full-screen')();
  assert.equal(lastState().fullscreen,false);
  hooks.fullscreen=true;windowEvents.get('enter-full-screen')();
  hooks.fullscreen=false;windowEvents.get('leave-full-screen')();
  assert.deepEqual(hooks.fullscreenRequests,[true,false]);
  assert.equal(lastState().fullscreen,false);
});
test('seeking a lyric while paused keeps playback paused and accepts the confirmed service position',async t=>{
  const {invoke,hooks,streamed,serviceCommands,nativeUpdates}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  const report=(type,value)=>hooks.onEvent({id:song.id,generation,type,...value});
  report('state',{state:'playing'});report('progress',{position:14,duration:song.duration});
  report('state',{state:'paused'});
  const before=serviceCommands.length;
  await invoke('command','seek',42.25);
  assert.deepEqual(serviceCommands.slice(before),[{type:'seek',value:42.25}]);
  report('progress',{position:42.25,duration:song.duration});
  assert.equal(invoke('state').position,42.25);
  assert.equal(invoke('state').playing,false);
  assert.equal(nativeUpdates.at(-1).position,42.25);
  assert.equal(invoke('stats','month').totals.plays,0);
});
test('closing the window keeps the active playback, listening clock, and system controls alive',async t=>{
  const {invoke,hooks,streamed,serviceCommands,windowEvents,advance,mediaKey}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  const report=(type,value)=>hooks.onEvent({id:song.id,generation,type,...value});
  report('state',{state:'playing'});report('progress',{position:0,duration:song.duration});
  let prevented=false;
  const before=serviceCommands.length;
  windowEvents.get('close')({preventDefault:()=>{prevented=true;}});
  assert.equal(prevented,true);assert.equal(hooks.hidden,true);assert.equal(hooks.closed,undefined);
  assert.deepEqual(serviceCommands.slice(before),[]);
  for(let second=1;second<=12;second++){advance(1000);report('progress',{position:second,duration:song.duration});}
  const {plays,seconds}=invoke('stats','month').totals;
  assert.deepEqual({plays,seconds},{plays:1,seconds:12});
  mediaKey('pause');await Promise.resolve();
  assert.equal(serviceCommands.at(-1).type,'pause');
});
test('radio likes leave the current track selected; dislikes choose a replacement; Undo restores the rating and selection',async t=>{
  const {invoke,ratings,picks}=await launch(t);
  await invoke('command','playTrack',song);
  await invoke('radio','like');
  assert.equal(invoke('state').current.id,song.id);assert.equal(picks.length,0);
  assert.equal(invoke('home').liked[0].id,song.id);
  await invoke('radio','dislike');
  assert.equal(invoke('state').current.id,alternative.id);
  assert.equal(picks[0].vote,'dislike');
  assert.equal(picks[0].feedback.votes[0].sign,-1);
  await invoke('radio','undo');
  assert.equal(invoke('state').current.id,song.id);
  assert.deepEqual(ratings,[[song.id,'like'],[song.id,'dislike'],[song.id,'like']]);
  assert.equal(invoke('home').liked[0].id,song.id);
});
test('logout clears account history and invalidates queued saves and pending radio suggestions',async t=>{
  const {invoke,directory,hooks,ratings}=await launch(t);
  const file=path.join(directory,'watch-history.json');
  fs.writeFileSync(file,JSON.stringify([{header:'YouTube Music',title:'Watched Roads',titleUrl:'https://music.youtube.com/watch?v='+song.id,time:'2024-01-01T00:00:00Z'}]));
  hooks.selected=[file];
  await invoke('importHistory');
  assert.equal(invoke('home').recent[0].id,song.id);
  await invoke('command','playTrack',song);
  const started=Promise.withResolvers(),done=Promise.withResolvers();
  hooks.pick=async()=>{started.resolve();await done.promise;};
  const picking=invoke('radio','start');
  await started.promise;
  const queued=invoke('command','saveTrack',song);
  const stale=Promise.allSettled([queued]);
  await invoke('signOut');
  done.resolve();await picking;
  assert.equal((await stale)[0].status,'rejected');assert.equal(ratings.length,0);
  assert.equal(invoke('state').current,null);
  assert.equal(invoke('state').library.length,0);
  assert.equal(invoke('home').historyAvailable,false);
  assert.equal(invoke('home').radioActive,false);
  await invoke('command','previous');
  assert.equal(invoke('state').current,null);
});
test('Undo restores a preexisting remote dislike that would never appear in the liked list',async t=>{
  const {invoke,hooks,ratings}=await launch(t);
  hooks.remoteRatings.set(song.id,'dislike');
  await invoke('command','playTrack',song);
  await invoke('radio','like');
  await invoke('radio','undo');
  assert.equal(hooks.remoteRatings.get(song.id),'dislike');
  assert.deepEqual(ratings,[[song.id,'like'],[song.id,'dislike']]);
});

test('track ratings update immediately and retain source confirmation and rollback',async t=>{
  const {invoke,hooks,ratings,directory}=await launch(t);
  const blocked=()=>invoke('state').disliked.includes(song.id);
  const saved=()=>invoke('state').library.some(item=>item.id===song.id);
  const rate=rating=>invoke('command','rateTrack',{track:song,rating});
  for(const [rating,wasSaved,wasBlocked] of [['like',false,false],['dislike',true,false],['none',false,true]]){
    const received=Promise.withResolvers(),ack=Promise.withResolvers();
    hooks.rate=()=>{received.resolve();return ack.promise;};
    const write=rate(rating);await received.promise;
    assert.equal(saved(),rating==='like');assert.equal(blocked(),rating==='dislike');
    ack.resolve();await write;
    assert.equal(saved(),rating==='like');assert.equal(blocked(),rating==='dislike');
    assert.equal(hooks.remoteRatings.get(song.id),rating);
    const persisted=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'))).data;
    assert.equal(persisted.feedback.votes.length,rating==='none'?0:1);
  }
  hooks.rate=()=>Promise.reject(Error('Account rejected rating'));
  await assert.rejects(rate('dislike'),/rejected rating/);
  assert.equal(saved(),false);assert.equal(blocked(),false);
  assert.deepEqual(ratings.map(([,value])=>value),['like','dislike','none','dislike']);
});

test('a disliked recording is removed from present and future service queues and skipped on autoplay',async t=>{
  const {invoke,hooks,streamed,serviceCommands}=await launch(t);
  const clean={...song,id:'abcdefghij1',title:'Unrated song'};
  const video={...alternative,id:'abcdefghij2',title:alternative.title+' (Official Music Video)'};
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  const queue=()=>hooks.onEvent({type:'queue',id:song.id,generation,tracks:[video,alternative,clean]});
  queue();assert.equal(invoke('state').serviceQueue.length,2);
  await invoke('command','rateTrack',{track:alternative,rating:'dislike'});
  const queueIds=()=>Array.from(invoke('state').serviceQueue,item=>item.id);
  assert.deepEqual(queueIds(),[clean.id]);
  queue();assert.deepEqual(queueIds(),[clean.id]);
  const before=serviceCommands.length;
  hooks.onEvent({type:'track',id:video.id,generation,track:video});
  hooks.onEvent({type:'state',id:video.id,generation,state:'playing'});
  assert.deepEqual(serviceCommands.slice(before),[{type:'next',value:undefined}]);
  assert.equal(invoke('state').current.id,song.id);
  hooks.onEvent({type:'track',id:clean.id,generation,track:clean});
  assert.equal(invoke('state').current.id,clean.id);
  await invoke('command','rateTrack',{track:alternative,rating:'none'});
  hooks.onEvent({type:'track',id:video.id,generation,track:video});
  assert.equal(invoke('state').current.id,video.id);
});

test('Next skips blocked custom queue entries and respects a queued choice during a blocked service transition',async t=>{
  const {invoke,hooks,streamed}=await launch(t);
  const choice={...song,id:'abcdefghij3',title:'Explicit queue choice'};
  const later={...song,id:'abcdefghij4',title:'Next choice'};
  await invoke('command','playTrack',song);
  await invoke('command','rateTrack',{track:alternative,rating:'dislike'});
  for(const track of [alternative,choice,later])await invoke('command','queueTrack',track);
  await invoke('command','next');
  assert.equal(invoke('state').current.id,choice.id);
  assert.deepEqual(streamed.map(item=>item.track.id),[song.id,choice.id]);
  const generation=streamed.at(-1).generation;
  hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
  assert.equal(invoke('state').current.id,later.id);
  assert.deepEqual(streamed.map(item=>item.track.id),[song.id,choice.id,later.id]);
});

test('privileged application IPC rejects another frame at either the music service origin or the local UI origin',async t=>{
  const {invokeFrom,frame,invoke}=await launch(t);
  for(const spoof of [{origin:frame.origin},{origin:'https://music.youtube.com'}]){
    for(const name of ['command','state','signIn','signOut','report']){
      assert.throws(()=>invokeFrom({senderFrame:spoof},name,'playTrack',song),/invalid sender/i);
    }
  }
  assert.equal(invoke('state').current,null);
});

test('selecting another streaming track reuses its document without an asynchronous stop',async t=>{
  const {invoke,serviceCommands,streamed}=await launch(t);
  await invoke('command','playTrack',song);
  const before=serviceCommands.length;
  await invoke('command','playTrack',alternative);
  assert.equal(serviceCommands.slice(before).some(command=>command.type==='stop'),false);
  assert.equal(streamed.at(-1).track.id,alternative.id);
  assert.equal(invoke('state').error,'');
});

test('a service-initiated transition gets a fresh listen threshold and is persisted once per song',async t=>{
  const {invoke,hooks,streamed,advance,directory}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  function listen(t){
    hooks.onEvent({id:t.id,generation,type:'state',state:'playing'});
    for(let seconds=0;seconds<=12;seconds++){
      advance(1000);
      hooks.onEvent({id:t.id,generation,type:'progress',position:seconds,duration:t.duration});
    }
  }
  listen(song);
  hooks.onEvent({id:alternative.id,generation,type:'track',track:alternative});
  assert.equal(invoke('state').position,0);
  assert.equal(invoke('state').duration,alternative.duration);
  listen(alternative);
  const history=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.history;
  assert.deepEqual(history.map(entry=>entry.track.id),[alternative.id,song.id]);
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('a verified account starts syncing even while a guest Home request is in flight',async t=>{
  const guest=Promise.withResolvers();
  const {invoke,hooks,messages}=await launch(t,{connected:false,home:()=>guest.promise});
  const pending=invoke('refreshHome');
  try {
    hooks.connected=true;
    hooks.profile={id:'fixture-account',name:'Fixture listener',avatar:'https://yt3.ggpht.com/fixture'};
    hooks.onAccount();
    await tick();
    assert.equal(hooks.syncCalls,1);
    assert.ok(messages.some(event=>event.name==='music:home'&&event.value.account.id==='fixture-account'));
  } finally {
    guest.resolve({discover:[],releases:[]});
    await pending;
  }
});

test('app IPC publishes incremental signed-in collections and refreshed identity while other shelves are still syncing',async t=>{
  const collection=Promise.withResolvers(),release=Promise.withResolvers();
  const {invoke,hooks,messages}=await launch(t,{connected:false,sync:()=>{collection.resolve();return release.promise;}});
  await tick();
  hooks.connected=true;
  hooks.profile={id:'fixture-account',name:'YouTube Music account',syncing:false};
  hooks.onAccount();
  await collection.promise;
  hooks.liked=[song];
  hooks.profile={...hooks.profile,name:'Fixture listener',avatar:'https://yt3.ggpht.com/fixture',syncing:true};
  hooks.onAccount();
  const seen=messages.filter(m=>m.name==='music:home').at(-1).value;
  assert.equal(seen.account.name,'Fixture listener');
  assert.equal(seen.account.avatar,'https://yt3.ggpht.com/fixture');
  assert.equal(seen.account.syncing,true);
  assert.equal(seen.liked[0].id,song.id);
  assert.deepEqual(messages.filter(m=>m.name==='music:state').at(-1).value.library.map(track=>track.id),[song.id]);
  hooks.collections={songs:[song,alternative],history:[{track:alternative}],playlists:[{id:'PLfixture',title:'Fixture playlist'}]};
  hooks.onAccount();
  assert.equal(invoke('home').playlists[0].id,'PLfixture');
  assert.equal(invoke('home').recent[0].id,alternative.id);
  assert.deepEqual(Array.from(invoke('state').library,track=>track.id).sort(),[song.id,alternative.id].sort());
  assert.deepEqual(Array.from(invoke('home').liked,track=>track.id),[song.id]);
  assert.equal(hooks.syncCalls,1);
  release.resolve();await tick();
});

test('a failed sync for a signed-out account cannot become a playback error or replace guest shelves',async t=>{
  const old=Promise.withResolvers();
  const {invoke,hooks}=await launch(t,{connected:false,sync:()=>old.promise});
  await tick();
  hooks.connected=true;hooks.profile={id:'previous'};
  hooks.onAccount();
  await tick();
  await invoke('signOut');
  old.reject(Error('stale library failure'));await tick();
  assert.equal(invoke('home').account.connected,false);
  assert.deepEqual(Array.from(invoke('home').discover),[]);
  assert.equal(invoke('state').error,'');
});

test('the service queue retains repeats, remains separate from manual additions and expires with the active track or account',async t=>{
  const {invoke,hooks,streamed}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  await invoke('command','queueTrack',song);
  const publish=(id,gen,tracks)=>hooks.onEvent({type:'queue',id,generation:gen,tracks});
  const ids=key=>Array.from(invoke('state')[key],track=>track.id);
  publish(song.id,generation,[alternative,alternative,song]);
  assert.deepEqual(ids('serviceQueue'),[alternative.id,alternative.id,song.id]);
  assert.deepEqual(ids('queue'),[song.id]);
  publish(alternative.id,generation,[]);
  publish(song.id,generation-1,[]);
  assert.deepEqual(ids('serviceQueue'),[alternative.id,alternative.id,song.id]);
  hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
  assert.deepEqual(ids('serviceQueue'),[]);
  publish(alternative.id,generation,[song]);
  await invoke('command','playTrack',song);
  assert.deepEqual(ids('serviceQueue'),[]);
  publish(song.id,streamed.at(-1).generation,[alternative]);
  await invoke('signOut');
  assert.deepEqual(ids('serviceQueue'),[]);
  assert.deepEqual(ids('queue'),[]);
});

test('playlist IPC restores the saved order, leaves date sorting to the service, and clears account-specific order on sign-out',async t=>{
  const id='PLfixture';
  const third={...song,id:'0123456789c',title:'Third'};
  const latest={...song,id:'0123456789d',title:'Latest'};
  const {invoke,hooks,directory}=await launch(t);
  let contents=[song,alternative,song,third];
  const calls=[];
  hooks.playlist=async(_, {sort})=>{calls.push(sort);return sort==='newest'?[...contents].reverse():contents;};
  assert.throws(()=>invoke('orderPlaylist',id,[song.id]),/open the playlist/i);
  await invoke('playlist',id);
  const order=[third.id,song.id,song.id,alternative.id];
  invoke('orderPlaylist',id,order);
  const stored=()=>JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.playlistOrders;
  assert.deepEqual(stored()[id],order);
  assert.throws(()=>invoke('orderPlaylist',id,[third.id,alternative.id,alternative.id,song.id]),/playlist changed/i);
  assert.deepEqual(stored()[id],order);
  contents=[latest,song,third,song];
  const ids=tracks=>Array.from(tracks,t=>t.id);
  assert.deepEqual(ids(await invoke('playlist',id,undefined,true)),[third.id,song.id,song.id,latest.id]);
  assert.deepEqual(ids(await invoke('playlist',id,'newest')),ids(contents).reverse());
  assert.deepEqual(ids(await invoke('playlist',id,'oldest')),ids(contents));
  assert.deepEqual(calls,['default','default','newest','oldest']);
  assert.deepEqual(stored()[id],order);
  await invoke('signOut');
  assert.deepEqual(stored(),{});
  assert.throws(()=>invoke('orderPlaylist',id,order),/open the playlist/i);
});

test('a playlist load that resolves after sign-out cannot register tracks for later IPC reordering',async t=>{
  const remote=Promise.withResolvers();
  const {invoke}=await launch(t,{playlist:()=>remote.promise});
  const fetched=assert.rejects(invoke('playlist','PLfixture'),/account changed/i);
  await invoke('signOut');remote.resolve([song]);await fetched;
  assert.throws(()=>invoke('playPlaylist','PLfixture',[song.id],0),/open the playlist/i);
});

test('a late playlist sort cannot replace the songs used for reordering and playback',async t=>{
  const id='PLsort', newest=Promise.withResolvers(), oldest=Promise.withResolvers();
  const {invoke,streamed}=await launch(t,{playlist:(_, {sort})=>sort==='newest'?newest.promise:oldest.promise});
  const stale=assert.rejects(invoke('playlist',id,'newest'),/playlist selection changed/i);
  const current=invoke('playlist',id,'oldest');
  oldest.resolve([song,alternative]);
  assert.deepEqual(Array.from(await current,track=>track.id),[song.id,alternative.id]);
  newest.resolve([]);
  await stale;

  const order=[alternative.id,song.id];
  await invoke('orderPlaylist',id,order);
  await invoke('playPlaylist',id,order,0);
  assert.equal(streamed.at(-1).track.id,alternative.id);
  assert.deepEqual(Array.from(invoke('state').queue,track=>track.id),[song.id]);
});

test('playlist playback, reordering and Previous retain the selected occurrence of a repeated recording',async t=>{
  const id='PLrepeat',first={...song,title:'First occurrence'},second={...song,title:'Second occurrence'};
  const {invoke}=await launch(t,{playlist:async()=>[first,second,alternative]});
  await invoke('playlist',id);
  const order=[song.id,song.id,alternative.id];
  invoke('playPlaylist',id,order,1);
  const names=()=>Array.from(invoke('state').queue,t=>t.title);
  assert.deepEqual(names(),[alternative.title]);
  // A UI refresh rebuilds the service response while this occurrence is playing.
  await invoke('playlist',id);
  invoke('orderPlaylist',id,order);
  assert.deepEqual(names(),[alternative.title]);
  invoke('playPlaylist',id,order,0);
  await invoke('command','next');
  assert.equal(invoke('state').current.title,second.title);
  await invoke('command','previous');
  assert.equal(invoke('state').current.title,first.title);
  assert.deepEqual(names(),[second.title,alternative.title]);
});

test('Play Next precedes the existing manual and official queue, whose removed song stays removed on Next',async t=>{
  const {invoke,hooks,streamed}=await launch(t);
  const nextSong={...song,id:'0123456789n',title:'First next'};
  await invoke('command','playTrack',song);
  const queueEvent={type:'queue',id:song.id,generation:streamed[0].generation,tracks:[alternative,song]};
  hooks.onEvent(queueEvent);
  await invoke('command','queueTrack',alternative);
  await invoke('command','playNext',nextSong);
  assert.deepEqual(Array.from(invoke('state').queue,x=>x.id),[nextSong.id,alternative.id]);
  await invoke('command','removeQueue',2);
  hooks.onEvent(queueEvent);
  assert.deepEqual(Array.from(invoke('state').serviceQueue),[]);
  assert.deepEqual(Array.from(invoke('state').queue,x=>x.id),[nextSong.id,alternative.id,song.id]);
  for(const expected of [nextSong.id,alternative.id,song.id]){
    await invoke('command','next');
    assert.equal(invoke('state').current.id,expected);
  }
});

test('queue reordering validates the full occurrence permutation and plays a mix of local and repeated service tracks',async t=>{
  const {invoke,hooks,streamed,directory}=await launch(t);
  const audio=path.join(directory,'fixture.mp3');fs.writeFileSync(audio,'audio fixture');hooks.selected=[audio];
  await invoke('import');
  const local=invoke('state').library.find(t=>t.source==='local');
  await invoke('command','playTrack',song);
  await invoke('command','queueTrack',local);
  hooks.onEvent({type:'queue',id:song.id,generation:streamed[0].generation,tracks:[alternative,{...alternative,title:'Repeated instance'}]});
  const keys=['local:'+local.id,'youtube:'+alternative.id,'youtube:'+alternative.id];
  assert.throws(()=>invoke('orderQueue',[1,1,0],keys),/queue changed/i);
  assert.throws(()=>invoke('orderQueue',[2,0,1],[...keys].reverse()),/queue changed/i);
  assert.equal(invoke('state').queue[0].source,'local');
  await invoke('orderQueue',[2,0,1],keys);
  assert.deepEqual(Array.from(invoke('state').queue,t=>t.title),['Repeated instance',local.title,alternative.title]);
  await invoke('command','next');
  assert.equal(streamed.at(-1).track.title,'Repeated instance');
  await invoke('command','next');
  assert.equal(invoke('state').current.id,local.id);
  await invoke('command','next');
  assert.equal(streamed.at(-1).track.title,alternative.title);
});

test('an audio-to-video counterpart preserves the custom queue and the current listening event',async t=>{
  const {invoke,hooks,streamed,advance}=await launch(t);
  const video={...song,id:'0123456789v',title:song.title+' (Official Video)'};
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  await invoke('command','queueTrack',alternative);
  invoke('orderQueue',[0],['youtube:'+alternative.id]);
  const listen=(id,from,to)=>{
    hooks.onEvent({type:'state',id,generation,state:'playing'});
    for(let second=from;second<=to;second++){advance(1000);hooks.onEvent({type:'progress',id,generation,position:second,duration:304});}
  };
  listen(song.id,0,11);
  await invoke('setPlaybackMode','video');
  hooks.onEvent({type:'track',id:video.id,generation,counterpart:true,track:video});
  assert.equal(invoke('state').current.id,video.id);
  assert.equal(invoke('state').current.title,song.title);
  assert.equal(invoke('state').current.artist,song.artist);
  assert.equal(invoke('state').queue[0].id,alternative.id);
  assert.equal(streamed.length,1);
  listen(video.id,11,15);
  const total=invoke('stats','month').totals;
  assert.equal(total.plays,1);assert.ok(total.seconds>=15 && total.seconds<=16);
  await invoke('command','next');assert.equal(invoke('state').current.id,alternative.id);
});

test('stats reports actually elapsed playback and excludes seek jumps, pauses, and stale reports',async t=>{
  const {invoke,hooks,streamed,advance,directory}=await launch(t);
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  const report=(type,info)=>hooks.onEvent({id:song.id,generation,type,...info});
  const progress=position=>report('progress',{position,duration:304});
  report('state',{state:'playing'});progress(0);
  for(let n=1;n<=12;n++){advance(1000);progress(n);}
  advance(200);progress(210);
  for(let n=1;n<=8;n++){advance(1000);progress(210+n);}
  report('state',{state:'paused'});advance(40000);progress(280);
  hooks.onEvent({type:'progress',id:song.id,generation:generation+1,position:304,duration:304});
  const all=invoke('stats','month');
  assert.equal(all.totals.plays,1);assert.equal(all.totals.seconds,20);
  const entry=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.history[0];
  assert.equal(entry.listenSeconds,20);assert.ok(entry.playId);
  for(const period of ['all','year','6months','forever']) assert.throws(()=>invoke('stats',period),/past week or past month/i);
});

test('recent searches persist against their confirmed account and cannot leak on an account switch',async t=>{
  const {hooks,invoke,directory}=await launch(t,{connected:true,profile:{id:'first-account'}});
  hooks.onAccount();
  invoke('rememberSearch',{kind:'query',query:'  Portishead  '});
  invoke('rememberSearch',{kind:'track',track:song});
  invoke('rememberSearch',{kind:'query',query:'PORTISHEAD'});
  const recents=invoke('recentSearches');
  assert.equal(recents.length,2);assert.equal(recents[0].query,'PORTISHEAD');assert.equal(recents[1].track.id,song.id);
  const stored=()=>JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data;
  assert.equal(stored().searchRecentOwner,'first-account');assert.equal(stored().searchRecent.length,2);
  invoke('removeSearch',recents[0]);assert.equal(invoke('recentSearches').length,1);assert.equal(stored().searchRecent[0].track.id,song.id);
  invoke('removeSearch',recents[1]);assert.equal(invoke('recentSearches').length,0);
  hooks.profile={id:'second-account'};hooks.onAccount();
  assert.equal(invoke('recentSearches').length,0);
  invoke('rememberSearch',{kind:'query',query:'New search'});
  assert.equal(stored().searchRecentOwner,'second-account');assert.equal(stored().searchRecent.length,1);
  await invoke('signOut');assert.equal(invoke('recentSearches').length,0);
});

test('the native video surface accepts only finite rectangles within host bounds and releases its surface on null',async t=>{
  const {hooks,invoke}=await launch(t);
  for(const x of [NaN,Infinity,'10'])assert.throws(()=>invoke('setVideoBounds',{x,y:0,width:10,height:10}),/invalid video bounds/i);
  for(const bounds of [{x:-20,y:-30,width:120000,height:9000},{x:1500,y:900,width:0,height:0},{x:1199.9,y:799.5,width:300,height:30}]){
    invoke('setVideoBounds',bounds);
    const r=hooks.bounds;
    assert.ok(r===null || (r.x>=0 && r.y>=0 && r.width>0 && r.height>0 && r.x+r.width<=1200 && r.y+r.height<=800));
  }
  invoke('setVideoBounds',null);assert.equal(hooks.bounds,null);
});

test('a pending video-mode change or queue-category choice cannot affect the next track',async t=>{
  const mode=Promise.withResolvers(),category=Promise.withResolvers();
  const {invoke,hooks,streamed}=await launch(t,{setPlaybackMode:()=>mode.promise,queueCategory:()=>category.promise});
  await invoke('command','playTrack',song);
  const generation=streamed[0].generation;
  hooks.onEvent({type:'queue',id:song.id,generation,tracks:[],categories:[{id:'similar',title:'Similar'}]});
  const changes=Promise.allSettled([invoke('setPlaybackMode','video'),invoke('queueCategory','similar')]);
  await invoke('command','playTrack',alternative);await invoke('command','queueTrack',song);
  mode.resolve({mode:'video',videoAvailable:true});category.resolve();await changes;
  assert.equal(invoke('state').playbackMode,'song');assert.equal(invoke('state').queue[0]?.id,song.id);
});

test('playback time uses a small progress event without retransmitting the library on every tick',async t=>{
 const {invoke,hooks,streamed,messages}=await launch(t);await invoke('command','playTrack',song);const generation=streamed.at(-1).generation;
 hooks.onEvent({type:'state',state:'playing',id:song.id,generation});hooks.onEvent({type:'progress',id:song.id,generation,position:1,duration:304});
 const count=messages.filter(m=>m.name==='music:state').length;
 hooks.onEvent({type:'progress',id:song.id,generation,position:2,duration:304});hooks.onEvent({type:'progress',id:song.id,generation,position:3,duration:304});
 assert.equal(messages.filter(m=>m.name==='music:state').length,count);assert.equal(messages.filter(m=>m.name==='music:progress').at(-1).value.position,3);assert.equal(invoke('state').position,3);
});

const settled = () => new Promise(resolve => setImmediate(resolve));
async function startPlaylist(invoke, tracks, index=0) {
  const id='PLqueueModes';
  await invoke('playlist',id);
  await invoke('playPlaylist',id,tracks.map(track=>track.id),index);
  await settled();
}

test('turning off shuffle restores the remaining original order after Next, removal, and addition',async t=>{
  const tracks=[song,{...alternative,title:'First occurrence'},{...song,id:'0123456789x',title:'Third'},
    {...alternative,title:'Second occurrence'},{...song,id:'0123456789y',title:'Fifth'},{...song,id:'0123456789z',title:'Sixth'}];
  const addition={...alternative,id:'0123456789a',title:'Added later'};
  const {invoke,hooks}=await launch(t,{playlist:async()=>tracks,random:()=>0});
  await startPlaylist(invoke,tracks);
  await invoke('command','shuffle',true);
  const titles=()=>Array.from(invoke('state').queue,item=>item.title);
  assert.deepEqual(titles(),['Third','Second occurrence','Fifth','Sixth','First occurrence']);
  assert.equal(invoke('state').current.id,song.id);
  assert.equal(hooks.modeRequests.at(-1).shuffle,false,'manual shuffle owns the playlist order');
  await invoke('command','next');await settled();
  await invoke('command','removeQueue',1);
  await invoke('command','queueTrack',addition);
  await invoke('command','shuffle',false);
  assert.deepEqual(titles(),['First occurrence','Second occurrence','Sixth','Added later']);
});

test('source repeat-one begins a fresh measured listen without consuming the next manual track',async t=>{
  const {invoke,hooks,streamed,advance,directory}=await launch(t);
  await invoke('command','playTrack',song);await settled();
  await invoke('command','queueTrack',alternative);
  await invoke('command','repeat','one');
  const generation=streamed[0].generation;
  const report=(type,extra={})=>hooks.onEvent({id:song.id,generation,type,...extra});
  const listen=()=>{report('state',{state:'playing'});for(let n=0;n<=12;n++){advance(1000);report('progress',{position:n,duration:song.duration});}};
  listen();report('ended');
  assert.equal(invoke('state').position,0);assert.equal(streamed.length,1);
  assert.deepEqual(Array.from(invoke('state').queue,item=>item.id),[alternative.id]);
  listen();
  await invoke('command','next');
  assert.equal(invoke('state').current.id,alternative.id);
  const entries=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.history;
  assert.equal(entries.length,2);assert.equal(new Set(entries.map(e=>e.playId)).size,2);
  assert.deepEqual(entries.map(e=>e.listenSeconds),[12,12]);
});

test('repeat-one reloads a local file, ignores its stale ended event and leaves manual Next available',async t=>{
  const {invoke,hooks,messages,directory}=await launch(t);
  const audio=path.join(directory,'repeat.mp3');fs.writeFileSync(audio,'fixture');hooks.selected=[audio];
  await invoke('import');const local=invoke('state').library.find(track=>track.source==='local');
  await invoke('command','playTrack',local);await invoke('command','queueTrack',alternative);
  await invoke('command','repeat','one');
  const loads=()=>messages.filter(m=>m.name==='music:engine'&&m.value.type==='load').map(m=>m.value);
  const first=loads()[0];await invoke('report',local.id,{type:'ended',generation:first.generation});
  assert.equal(loads().length,2);assert.equal(loads()[1].id,local.id);
  assert.ok(loads()[1].generation>first.generation);
  await invoke('report',local.id,{type:'ended',generation:first.generation});
  assert.equal(loads().length,2);assert.equal(invoke('state').queue[0].id,alternative.id);
  await invoke('command','next');assert.equal(invoke('state').current.id,alternative.id);
});

test('playlist repeat-all wraps from the final song, skips disliked tracks, and stops after disabling it',async t=>{
  const third={...song,id:'0123456789q',title:'Clean song'};
  const tracks=[song,alternative,third],{invoke,hooks,streamed}=await launch(t,{playlist:async()=>tracks});
  await startPlaylist(invoke,tracks,2);
  await invoke('command','rateTrack',{track:alternative,rating:'dislike'});
  await invoke('command','repeat','all');
  assert.deepEqual(hooks.modeRequests.at(-1),{shuffle:false,repeat:'off'});
  const end=async()=>{const {track,generation}=streamed.at(-1);hooks.onEvent({id:track.id,generation,type:'ended'});await settled();};
  for(const expected of [song,third,song,third]){await end();assert.equal(invoke('state').current.id,expected.id);}
  await invoke('command','repeat','off');const count=streamed.length;
  await end();assert.equal(streamed.length,count);assert.equal(invoke('state').playing,false);
});

test('repeat-one on a newly disliked track advances to a clean queued song at the natural boundary',async t=>{
  const tracks=[song,alternative],{invoke,hooks,streamed}=await launch(t,{playlist:async()=>tracks});
  await startPlaylist(invoke,tracks);
  await invoke('command','repeat','one');
  await invoke('command','rateTrack',{track:song,rating:'dislike'});
  hooks.onEvent({id:song.id,generation:streamed[0].generation,type:'ended'});
  await settled();
  assert.equal(invoke('state').current.id,alternative.id);
});

test('source settings appear immediately, roll back failed writes and ignore stale selection reports',async t=>{
  const {invoke,hooks,streamed}=await launch(t);
  await invoke('command','playTrack',song);await settled();
  const generation=streamed[0].generation;
  const report=(id,gen,shuffle,repeat)=>hooks.onEvent({type:'settings',id,generation:gen,shuffle,repeat});
  const gate=Promise.withResolvers();hooks.setPlaybackSettings=()=>gate.promise;
  const pending=invoke('command','shuffle',true);
  assert.equal(invoke('state').shuffle,true);
  report(song.id,generation,false,'all');assert.equal(invoke('state').repeat,'off');
  const fails=assert.rejects(pending,/source rejected shuffle/);
  gate.reject(Error('source rejected shuffle'));await fails;
  assert.equal(invoke('state').shuffle,false);
  hooks.setPlaybackSettings=async request=>request;
  await invoke('command','repeat','all');assert.equal(invoke('state').repeat,'all');
  report(song.id,generation-1,true,'one');assert.equal(invoke('state').repeat,'all');
  hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
  report(song.id,generation,true,'one');
  assert.equal(invoke('state').repeat,'all');assert.equal(invoke('state').shuffle,false);
  hooks.onEvent({type:'state',id:alternative.id,generation,state:'playing'});await settled();
  report(alternative.id,generation,true,'one');
  assert.equal(invoke('state').repeat,'one');assert.equal(invoke('state').shuffle,true);
});

test('an older rejected write cannot undo the same setting selected again after intervening writes',async t=>{
  const {invoke,hooks}=await launch(t);
  await invoke('command','playTrack',song);await settled();
  const first=Promise.withResolvers();
  hooks.setPlaybackSettings=()=>first.promise;
  const rejected=assert.rejects(invoke('command','repeat','all'),/older write/);
  hooks.setPlaybackSettings=async request=>request;
  await invoke('command','repeat','one');
  await invoke('command','repeat','all');
  first.reject(Error('older write rejected'));await rejected;
  assert.equal(invoke('state').repeat,'all');
});

test('repeat-all wraps even when every upcoming entry at the end of the playlist is disliked',async t=>{
  const blocked={...song,id:'0123456789d',title:'Blocked tail'};
  const tracks=[song,alternative,blocked];
  const {invoke,hooks,streamed}=await launch(t,{playlist:async()=>tracks});
  await startPlaylist(invoke,tracks,1);
  await invoke('command','rateTrack',{track:blocked,rating:'dislike'});
  await invoke('command','repeat','all');
  const generation=streamed.at(-1).generation;
  hooks.onEvent({id:alternative.id,generation,type:'ended'});
  await settled();
  assert.equal(invoke('state').current.id,song.id);
  assert.deepEqual(streamed.map(item=>item.track.id),[alternative.id,song.id]);
  for(const track of [song,alternative])await invoke('command','rateTrack',{track,rating:'dislike'});
  hooks.onEvent({id:song.id,generation:streamed.at(-1).generation,type:'ended'});
  await settled();
  assert.equal(invoke('state').queue.length,0);assert.equal(invoke('state').playing,false);
  assert.equal(invoke('state').loading,false);assert.equal(streamed.length,2);
});

test('local repeat-all wraps the eligible file library and local shuffle skips to a different eligible file',async t=>{
  const {invoke,hooks,directory,messages,streamed}=await launch(t,{random:()=>0.99});
  hooks.selected=['One','Two','Blocked','Three'].map(title=>{
    const file=path.join(directory,title+'.mp3');fs.writeFileSync(file,'audio');return file;
  });
  await invoke('import');
  const tracks=Object.fromEntries(Array.from(invoke('state').library,track=>[track.title,track]));
  // A file can remain in the library after being reimported following a dislike.
  await invoke('command','rateTrack',{track:tracks.Blocked,rating:'dislike'});await invoke('import');
  await invoke('command','saveTrack',song);
  const fileOrder=Array.from(invoke('state').library).filter(track=>track.source==='local'&&track.title!=='Blocked');
  assert.equal(fileOrder.length,3);
  await invoke('command','playTrack',fileOrder.at(-1));await invoke('command','repeat','all');
  const end=async()=>{
    const load=messages.filter(m=>m.name==='music:engine'&&m.value.type==='load').at(-1).value;
    await invoke('report',load.id,{type:'ended',generation:load.generation});
  };
  for(const track of fileOrder){await end();assert.equal(invoke('state').current.id,track.id);}
  await invoke('command','playTrack',fileOrder[0]);await invoke('command','shuffle',true);
  await invoke('command','next');assert.equal(invoke('state').current.id,fileOrder[2].id);
  assert.equal(streamed.length,0);assert.equal(hooks.modeRequests.length,0);
  const persisted=()=>JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data;
  assert.equal(persisted().shuffle,true);assert.equal(persisted().repeat,'all');
  await assert.rejects(invoke('command','repeat','loop'),/repeat off, all, or one/i);
  await assert.rejects(invoke('command','shuffle','on'),/shuffle on or off/i);
  await invoke('command','shuffle',false);await invoke('command','next');
  assert.equal(invoke('state').current.id,fileOrder[0].id);assert.equal(persisted().shuffle,false);
});

test('legacy queue removal also removes precisely that occurrence from subsequent playlist repeats',async t=>{
  const other={...alternative,id:song.id,title:'Later occurrence'};
  const tracks=[song,other,alternative];
  const {invoke,hooks,streamed}=await launch(t,{playlist:async()=>tracks});
  await startPlaylist(invoke,tracks);
  await invoke('command','repeat','all');await invoke('command','removeQueued',0);
  const end=async()=>{const {track,generation}=streamed.at(-1);hooks.onEvent({id:track.id,generation,type:'ended'});await settled();};
  for(const title of [alternative.title,song.title,alternative.title]){await end();assert.equal(invoke('state').current.title,title);}
  assert.deepEqual(streamed.map(row=>row.track.title),[song.title,alternative.title,song.title,alternative.title]);
});

test('a verified same-track source loop starts a separate measured play with uninterrupted playback',async t=>{
  const {invoke,hooks,streamed,serviceCommands,advance,directory}=await launch(t);
  await invoke('command','playTrack',song);await settled();
  const generation=streamed[0].generation;
  const report=(type,extra={})=>hooks.onEvent({id:song.id,generation,type,...extra});
  const progress=(first,last)=>{for(let n=first;n<=last;n++){advance(1000);report('progress',{position:n,duration:song.duration});}};
  const entries=()=>JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.history;
  report('state',{state:'playing'});progress(0,6);
  report('loop');assert.equal(invoke('state').position,6);
  await invoke('command','repeat','one');
  report('loop',{id:alternative.id});report('loop',{generation:generation-1});
  assert.equal(invoke('state').position,6);
  progress(7,12);assert.equal(entries().length,1);
  await invoke('command','queueTrack',alternative);
  const commandCount=serviceCommands.length;
  report('loop');
  assert.equal(invoke('state').position,0);assert.equal(invoke('state').playing,true);
  assert.equal(invoke('state').queue[0].id,alternative.id);
  assert.equal(streamed.length,1);assert.equal(serviceCommands.length,commandCount);
  progress(0,11);
  await invoke('command','next');
  const history=entries();
  assert.deepEqual(history.map(entry=>entry.listenSeconds),[11,12]);
  assert.equal(new Set(history.map(entry=>entry.playId)).size,2);
});

test('saved queue modes survive an opening ad and apply after actual content starts',async t=>{
  let calls=0;
  const {invoke,hooks,streamed}=await launch(t,{setPlaybackSettings:async request=>{
    if(++calls===1)throw Error('Queue settings can change after the advertisement.');
    return request;
  }});
  await invoke('command','shuffle',true);
  await invoke('command','repeat','one');
  await invoke('command','playTrack',song);await settled();
  assert.equal(calls,1);
  const generation=streamed[0].generation;
  hooks.onEvent({type:'settings',id:song.id,generation,shuffle:false,repeat:'off'});
  assert.equal(invoke('state').shuffle,true);assert.equal(invoke('state').repeat,'one');
  hooks.onEvent({type:'state',id:song.id,generation,state:'playing'});await settled();
  assert.equal(calls,2);
  assert.deepEqual(hooks.sourceModes,{shuffle:true,repeat:'one'});
});

test('an automatic track transition preserves a mode selected while the prior source command was pending',async t=>{
  const {invoke,hooks,streamed}=await launch(t);
  await invoke('command','playTrack',song);await settled();
  const gate=Promise.withResolvers(),generation=streamed[0].generation;
  hooks.setPlaybackSettings=()=>gate.promise;
  const pending=assert.rejects(invoke('command','shuffle',true),/recording changed/);
  hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
  gate.reject(Error('The playing recording changed.'));await pending;
  assert.equal(invoke('state').shuffle,true);
  hooks.setPlaybackSettings=async request=>request;
  hooks.onEvent({type:'state',id:alternative.id,generation,state:'playing'});await settled();
  assert.equal(hooks.sourceModes.shuffle,true);
});

test('first Play starts the last recording at zero while muted volume restores across restarts',async t=>{
  const savedData={current:song,resume:{source:'youtube',id:song.id,position:57.25},volume:0,lastAudibleVolume:.37};
  const {invoke,streamed,directory}=await launch(t,{savedData});
  assert.equal(streamed.length,0);
  assert.equal(invoke('state').playing,false);assert.equal(invoke('state').position,0);
  await invoke('command','play');await settled();
  assert.equal(streamed.length,1);assert.equal(streamed[0].track.id,song.id);
  assert.equal(streamed[0].startPosition,0);assert.equal(streamed[0].volume,0);
  await invoke('command','mute');assert.equal(invoke('state').volume,.37);
  await invoke('command','volume',.22);await invoke('command','mute');
  const data=JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data;
  assert.equal(data.volume,0);assert.equal(data.lastAudibleVolume,.22);
  const restarted=await launch(t,{savedData:data});
  await restarted.invoke('command','mute');assert.equal(restarted.invoke('state').volume,.22);
});

test('confirmed Likes and unlikes update an already opened LM before any fresh playlist read',async t=>{
  const {invoke,hooks,messages}=await launch(t,{liked:[alternative]});
  let reads=0;hooks.playlist=async()=>{reads++;return hooks.liked;};
  await invoke('playlist','LM');
  const updates=()=>messages.filter(m=>m.name==='music:playlistUpdate'&&m.value.id==='LM'&&m.value.complete);
  const old=updates().length,started=Promise.withResolvers(),gate=Promise.withResolvers();
  hooks.rate=()=>{started.resolve();return gate.promise;};
  const liking=invoke('command','rateTrack',{track:song,rating:'like'});
  await started.promise;assert.equal(updates().length,old+1);gate.resolve();await liking;
  assert.deepEqual(updates().at(-1).value.tracks.map(track=>track.id),[song.id,alternative.id]);
  await invoke('playPlaylist','LM',[song.id,alternative.id],0);assert.equal(invoke('state').current.id,song.id);
  await invoke('command','rateTrack',{track:song,rating:'none'});
  assert.deepEqual(updates().at(-1).value.tracks.map(track=>track.id),[alternative.id]);assert.equal(reads,0);
  await invoke('playPlaylist','LM',[alternative.id],0);assert.equal(invoke('state').current.id,alternative.id);
});

test('a confirmed playlist edit refreshes its rows in the background while a prior visible selection can still play and reorder',async t=>{
  const id='PLvisible',added={...song,id:'0123456789r',title:'Freshly added'};
  let contents=[song,alternative],reads=0;
  const {invoke,messages,streamed,directory}=await launch(t,{playlist:async()=>{reads++;return [...contents];},
    playlistAction:async()=>{contents=[added,song,alternative];return {ok:true};}});
  const visible=await invoke('playlist',id),ids=Array.from(visible,track=>track.id);
  await invoke('playlistAction','add',{id,track:added});
  for(let tick=0;reads<2&&tick<30;tick++)await new Promise(resolve=>setTimeout(resolve,5));
  await settled();
  assert.equal(reads,2);
  const update=messages.filter(m=>m.name==='music:playlistUpdate'&&m.value.id===id&&m.value.complete).at(-1);
  assert.deepEqual(update.value.tracks.map(track=>track.id),[added.id,song.id,alternative.id]);
  await invoke('playPlaylist',id,ids,1,visible);
  assert.equal(streamed.at(-1).track.id,alternative.id);
  assert.deepEqual(Array.from(invoke('state').queue,track=>track.id),[added.id]);
  await invoke('command','next');assert.equal(invoke('state').current.id,added.id);
  const reordered=Array.from(visible).reverse(),order=reordered.map(track=>track.id);
  await invoke('orderPlaylist',id,order,reordered);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.playlistOrders[id],
    [alternative.id,song.id,added.id]);
  assert.throws(()=>invoke('playPlaylist',id,ids,1,reordered),/snapshot/i);
  assert.throws(()=>invoke('orderPlaylist',id,ids,[...visible,{id:'invalid'}]),/snapshot|invalid/i);
  assert.throws(()=>invoke('playPlaylist',id,ids,ids.length,visible),/choose a song/i);
});

test('enabling shuffle on the last clicked song includes earlier unplayed songs and does not restore one already played',async t=>{
  const third={...song,id:'0123456789s',title:'Last track'},tracks=[song,alternative,third];
  const {invoke}=await launch(t,{playlist:async()=>tracks,random:()=>0});
  await startPlaylist(invoke,tracks,2);
  assert.equal(invoke('state').queue.length,0);
  await invoke('command','shuffle',true);
  assert.deepEqual(Array.from(invoke('state').queue,track=>track.id),[alternative.id,song.id]);
  await invoke('command','next');assert.equal(invoke('state').current.id,alternative.id);
  await invoke('command','shuffle',false);
  assert.deepEqual(Array.from(invoke('state').queue,track=>track.id),[song.id]);
});

test('confirmed playlist membership is visible immediately while its source refresh continues',async t=>{
  let reads=0,remotePayload;
  const refresh=Promise.withResolvers();
  const {invoke,hooks,messages}=await launch(t,{playlist:async()=>++reads===1?[song]:refresh.promise,playlistAction:async(_action,payload)=>{remotePayload=payload;return {ok:true};}});
  await invoke('playlist','PLlive');
  await invoke('playlistAction','add',{id:'PLlive',videoIds:[alternative.id],tracks:[alternative]});
  const added=messages.filter(m=>m.name==='music:playlistUpdate'&&m.value.id==='PLlive').at(-1).value.tracks;
  assert.deepEqual(Array.from(added,t=>t.id),[song.id,alternative.id]);
  assert.equal(remotePayload.tracks,undefined,'display metadata stays local');
  await invoke('playPlaylist','PLlive',[song.id,alternative.id],1,added);
  assert.equal(invoke('state').current.id,alternative.id);
  refresh.resolve([song,alternative]);await settled();
  await invoke('playlistAction','remove',{id:'PLlive',videoIds:[alternative.id],tracks:[alternative]});
  const removed=messages.filter(m=>m.name==='music:playlistUpdate'&&m.value.id==='PLlive').at(-1).value.tracks;
  assert.deepEqual(Array.from(removed,t=>t.id),[song.id]);
});

test('a confirmed Like supersedes an older pending LM read without asking for refresh',async t=>{
  const oldRead=Promise.withResolvers();
  const {invoke}=await launch(t,{playlist:async()=>oldRead.promise});
  const opening=invoke('playlist','LM');await settled();
  await invoke('command','rateTrack',{track:song,rating:'like'});
  oldRead.resolve([]);
  const rows=await opening;
  assert.deepEqual(Array.from(rows,t=>t.id),[song.id]);
});

test('the first mute on an older profile remembers its current volume',async t=>{
  const {invoke}=await launch(t,{savedData:{volume:.37}});
  await invoke('command','mute');assert.equal(invoke('state').volume,0);
  await invoke('command','mute');assert.equal(invoke('state').volume,.37);
});

test('rapid seeks publish the latest position immediately and ignore old source ticks',async t=>{
 const {invoke,hooks,streamed}=await launch(t);
 await invoke('command','playTrack',song);const generation=streamed.at(-1).generation;
 const progress=position=>hooks.onEvent({type:'progress',id:song.id,generation,position,duration:304});
 hooks.onEvent({type:'state',id:song.id,generation,state:'paused'});progress(8);
 await invoke('command','seek',160);await invoke('command','seek',42);
 assert.equal(invoke('state').position,42);progress(8);progress(160);
 assert.equal(invoke('state').position,42);progress(42.1);assert.equal(invoke('state').position,42.1);
 assert.equal(invoke('state').playing,false);
});
test('artist top-song sequences keep source order and adopt a prepared native successor without reloading it',async t=>{
 const third={...song,id:'0123456789c',title:'Third'};
 const {invoke,hooks,streamed}=await launch(t);
 await invoke('playSequence',[song,alternative,third],0);const generation=streamed.at(-1).generation;
 assert.deepEqual(Array.from(invoke('state').queue,t=>t.id),[alternative.id,third.id]);
 hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
 hooks.onEvent({type:'state',id:alternative.id,generation,state:'playing'});
 assert.equal(invoke('state').current.id,alternative.id);assert.equal(streamed.length,1);
 assert.deepEqual(Array.from(invoke('state').queue,t=>t.id),[third.id]);
 await invoke('command','next');assert.equal(streamed.at(-1).track.id,third.id);
});
test('an autoplayed video counterpart is skipped without a second listen or UI selection',async t=>{
 const {invoke,hooks,streamed,serviceCommands}=await launch(t);
 await invoke('command','playTrack',song);const generation=streamed.at(-1).generation;
 const video={...song,id:'0123456789v',title:song.title+' (Official Music Video)'};
 hooks.onEvent({type:'queue',id:song.id,generation,tracks:[video,alternative]});
 assert.deepEqual(Array.from(invoke('state').serviceQueue,t=>t.id),[alternative.id]);
 hooks.onEvent({type:'track',id:video.id,generation,track:video});
 assert.equal(invoke('state').current.id,song.id);
 assert.equal(serviceCommands.at(-1).type,'next');
 hooks.onEvent({type:'track',id:alternative.id,generation,track:alternative});
 assert.equal(invoke('state').current.id,alternative.id);
});


test('legacy saved queues migrate song/video variants without losing explicit repeats or queue action indices',async t=>{
 const alternateVideo={...alternative,id:'0123456789v',title:alternative.title+' (Official Video)'};
 const currentVideo={...song,id:'0123456789w',title:song.title+' (Official Video)'};
 const third={...song,id:'0123456789x',title:'Third song'};
 const {invoke,streamed,hooks,directory}=await launch(t,{savedData:{current:song,queue:[currentVideo,alternative,alternateVideo,alternative]}});
 assert.deepEqual(Array.from(invoke('state').queue,item=>item.id),[alternative.id,alternative.id]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory,'collection.json'),'utf8')).data.queue.map(t=>t.id),[alternative.id,alternative.id]);
 await invoke('command','playTrack',song);const generation=streamed.at(-1).generation;
 hooks.onEvent({type:'queue',id:song.id,generation,tracks:[alternateVideo,third]});
 assert.deepEqual(Array.from(invoke('state').serviceQueue,item=>item.id),[third.id]);
 await invoke('command','playQueue',2);assert.equal(invoke('state').current.id,third.id);
});

test('playlist membership projects immediately and a failed write rolls back without waiting for a reload',async t=>{
 const id='PLfixture',gate=Promise.withResolvers(),started=Promise.withResolvers();
 const {invoke,hooks,messages}=await launch(t,{collections:{playlists:[{id,title:'List',count:1}]},playlist:async()=>[song]});
 await invoke('playlist',id);
 hooks.playlistAction=async()=>{started.resolve();return gate.promise;};
 const pending=invoke('playlistAction','add',{id,videoIds:[alternative.id],tracks:[alternative]});await started.promise;
 assert.deepEqual(Array.from(await invoke('playlist',id),t=>t.id),[song.id,alternative.id]);
 assert.equal(invoke('home').playlists[0].count,2);
 const failed=assert.rejects(pending,/rejected membership/);gate.reject(Error('rejected membership'));await failed;
 assert.deepEqual(Array.from(await invoke('playlist',id),t=>t.id),[song.id]);
 assert.equal(invoke('home').playlists[0].count,1);
 assert.equal(messages.filter(m=>m.name==='music:playlistUpdate').at(-1).value.tracks.length,1);
});
test('multiple pending playlist edits compose and preserve later intent while an earlier edit confirms',async t=>{
 const id='PLfixture',gates=[Promise.withResolvers(),Promise.withResolvers()];let calls=0;
 const {invoke,hooks}=await launch(t,{playlist:async()=>[song],playlistAction:async()=>gates[calls++].promise});
 await invoke('playlist',id);
 const add=invoke('playlistAction','add',{id,videoIds:[alternative.id],tracks:[alternative]});
 const remove=invoke('playlistAction','remove',{id,videoIds:[song.id],tracks:[song]});
 await settled();assert.deepEqual(Array.from(await invoke('playlist',id),t=>t.id),[alternative.id]);
 gates[0].resolve({ok:true});await add;
 assert.deepEqual(Array.from(await invoke('playlist',id),t=>t.id),[alternative.id]);
 const rejected=assert.rejects(remove,/cannot remove/);gates[1].reject(Error('cannot remove'));await rejected;
 assert.deepEqual(Array.from(await invoke('playlist',id),t=>t.id),[song.id,alternative.id]);
});


test('playlist projections retain click order when confirmations arrive out of order',async t=>{
 const id='PLreverse',gates=[Promise.withResolvers(),Promise.withResolvers()];let calls=0;
 const {invoke}=await launch(t,{playlist:async()=>[],playlistAction:async()=>gates[calls++].promise});
 await invoke('playlist',id);
 const add=invoke('playlistAction','add',{id,videoIds:[song.id],tracks:[song]});
 const remove=invoke('playlistAction','remove',{id,videoIds:[song.id],tracks:[song]});
 gates[1].resolve({ok:true});await remove;assert.equal((await invoke('playlist',id)).length,0);
 gates[0].resolve({ok:true});await add;assert.equal((await invoke('playlist',id)).length,0);
});

test('one-track YouTube releases display and play the service autoplay queue',async t=>{
 const {invoke,hooks}=await launch(t);await invoke('playSequence',[song],0);
 hooks.onEvent({type:'queue',id:song.id,generation:1,tracks:[alternative]});
 assert.equal(invoke('state').serviceQueue.length,1);
 hooks.onEvent({type:'track',id:alternative.id,generation:1,track:alternative});
 assert.equal(invoke('state').current.id,alternative.id);assert.equal(invoke('state').position,0);
});


test('a natural successor resets its clock and cannot receive the outgoing progress',async t=>{
 const {invoke,hooks}=await launch(t);await invoke('playSequence',[song],0);
 hooks.onEvent({type:'progress',id:song.id,generation:1,position:300,duration:song.duration});
 hooks.onEvent({type:'track',id:alternative.id,generation:1,track:alternative});
 hooks.onEvent({type:'progress',id:song.id,generation:1,position:303,duration:song.duration});
 let state=invoke('state');assert.equal(state.current.id,alternative.id);assert.equal(state.position,0);assert.equal(state.duration,alternative.duration);
 hooks.onEvent({type:'progress',id:alternative.id,generation:1,position:.4,duration:alternative.duration});
 assert.equal(invoke('state').position,.4);
});


test('autoplay promotes its already-buffered clean successor instead of clicking through a duplicate native next',async t=>{
 const {invoke,hooks,streamed,serviceCommands}=await launch(t,{preparedId:alternative.id});
 await invoke('command','playTrack',song);hooks.onEvent({type:'queue',id:song.id,generation:1,tracks:[alternative]});
 await invoke('command','next');await settled();assert.equal(streamed.at(-1).track.id,alternative.id);assert(!serviceCommands.some(c=>c.type==='next'));
});

test('movie queue skips unavailable videos without selecting their audio and preserves the verified next title',async t=>{
 const third={...alternative,id:'abcdefghijk',title:'Third song'},video={...third,id:'lmnopqrstuv',mediaType:'video'};
 const {invoke,streamed}=await launch(t,{resolveVideo:async track=>track.id===alternative.id?null:video});
 await invoke('playSequence',[song,alternative,third],0);await invoke('command','videoOnly',true);await invoke('command','next');
 assert.equal(invoke('state').current.id,video.id);assert.equal(invoke('state').current.title,third.title);assert.equal(streamed.at(-1).track.mediaType,'video');
});

