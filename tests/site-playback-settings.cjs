const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {MusicSession}=require('../src/main/music-session.cjs');
const {queuePlaybackSettings}=require('../src/main/site-player.cjs');

const id='abcdefghijk';
function fixture({legacy=false}={}){
  const modes=['off','all','one'];
  const state={repeat:'off',shuffle:false,ad:false,disabled:false,actual:id,clicks:[]};
  const button=kind=>({
    getClientRects:()=>[{}],
    getAttribute(name){
      if(name==='aria-disabled')return String(state.disabled);
      if(name==='aria-pressed'&&!legacy)return String(kind==='shuffle'?state.shuffle:state.repeat!=='off');
      if(name==='aria-label'&&!legacy)return kind==='shuffle'?'Shuffle':'Repeat '+state.repeat;
      return null;
    },
    querySelector(){return null;},
    click(){state.clicks.push(kind);if(kind==='shuffle')state.shuffle=!state.shuffle;else state.repeat=modes[(modes.indexOf(state.repeat)+1)%modes.length];}
  });
  const shuffle=button('shuffle'),repeat=button('repeat');
  const bar={get shuffleEnabled(){return state.shuffle;},get repeatMode(){return state.repeat.toUpperCase();},querySelector:sel=>sel==='.shuffle'?shuffle:repeat};
  const player={getVideoData:()=>({video_id:state.actual}),classList:{contains:()=>state.ad}};
  const document={querySelectorAll:()=>legacy?[bar]:[],querySelector(sel){
    if(sel==='#movie_player')return player;
    if(sel.startsWith('ytmusic-player-bar'))return legacy?bar:null;
    if(sel==='ytmusic-player-queue')return null;
    return legacy?null:sel.includes('ShuffleButton')?shuffle:repeat;
  }};
  const run=(...args)=>JSON.parse(JSON.stringify(vm.runInNewContext('('+queuePlaybackSettings.toString()+')(...args)',{document,args})));
  return {state,run};
}

test('official buttons supply all repeat modes and the shuffle state for both player layouts',()=>{
  for(const legacy of [true,false]){
    const f=fixture({legacy});
    for(const mode of ['off','all','one','off']){
      assert.deepEqual(f.run(id),{shuffle:false,repeat:mode});
      if(mode!=='off'||f.state.clicks.length===0)f.run(id,'repeat');
    }
    f.run(id,'shuffle');assert.deepEqual(f.run(id),{shuffle:true,repeat:'off'});
    f.state.ad=true;assert.match(f.run(id,'repeat').error,/advertisement/);f.state.ad=false;
    f.state.disabled=true;assert.match(f.run(id,'shuffle').error,/disabled/);f.state.disabled=false;
    f.state.actual='another1234';assert.match(f.run(id,'repeat').error,/changed/);
  }
});

test('service changes cycle the first-party control, serialize writes and emit distinct states',async()=>{
  const f=fixture(),events=[];const s=new MusicSession({onEvent:event=>events.push(event)});s.active={id,generation:17};s.player={};s.updateQueue=async()=>{};
  s.run=async(_win,_fn,...args)=>f.run(...args);
  assert.deepEqual(await s.playbackSettings(),{shuffle:false,repeat:'off'});
  const active=s.setPlaybackSettings({shuffle:true,repeat:'one'}),reset=s.setPlaybackSettings({repeat:'off'});
  assert.deepEqual(await active,{shuffle:true,repeat:'one'});
  assert.deepEqual(await reset,{shuffle:true,repeat:'off'});
  assert.deepEqual(f.state.clicks,['shuffle','repeat','repeat','repeat']);
  await s.playbackSettings();assert.deepEqual(events.map(e=>[e.id,e.generation,e.shuffle,e.repeat]),[
    [id,17,false,'off'],[id,17,true,'off'],[id,17,true,'all'],[id,17,true,'one'],[id,17,true,'off']
  ]);
  await assert.rejects(s.setPlaybackSettings({repeat:'everything'}),/valid/);
});

test('a settings write queued for a prior recording cannot operate on its replacement',async()=>{
  const f=fixture(),s=new MusicSession();s.active={id,generation:1};s.player={};
  s.run=async(_win,_fn,...args)=>f.run(...args);
  const write=s.setPlaybackSettings({repeat:'one'});s.active={id,generation:2};
  await assert.rejects(write,/recording changed/);assert.deepEqual(f.state.clicks,[]);
});

test('Repeat One identifies a same-recording source reload at the tail and excludes seeks, ads and different recordings',()=>{
  const fs=require('node:fs');
  function observe(variant){
    const handlers={},messages=[],source=new URL('https://music.youtube.com/watch?v='+id);
    const video={currentTime:176.9,duration:178,readyState:4,paused:false,ended:false};
    let ad=false,repeat='one';
    const player={querySelector:selector=>selector.includes('video')?video:null,classList:{contains:()=>ad}};
    const button={getAttribute:key=>key==='aria-pressed'?String(repeat!=='off'):'Repeat '+repeat};
    const document={querySelector:selector=>selector==='#movie_player'?player:selector.includes('RepeatButton')?button:null,
      addEventListener:(name,fn)=>handlers[name]=fn};
    const fire=type=>handlers[type]({type,target:video});
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/session-preload.cjs'),'utf8'),{document,process:{isMainFrame:true},location:source,URL,performance,navigator:{},
      require:()=>({ipcRenderer:{send:(_topic,payload)=>messages.push(payload)}}),setInterval(){},setTimeout(){}});
    if(variant==='mid-song')video.currentTime=20;
    if(variant==='repeat-all')repeat='all';
    fire('playing');
    video.currentTime=0;video.readyState=0;
    if(variant==='manual'){fire('seeking');fire('seeked');}
    else {if(variant==='ad')ad=true;fire('emptied');fire('emptied');}
    if(variant==='different')source.searchParams.set('v','another1234');
    if(variant==='ad')ad=false;
    video.readyState=2;fire('loadedmetadata');
    video.readyState=4;fire('playing');video.currentTime=.5;fire('playing');
    return messages.filter(e=>e.kind==='loop').map(e=>e.id);
  }
  assert.deepEqual(observe('source-repeat'),[id]);
  for(const variant of ['manual','ad','different','repeat-all','mid-song'])assert.deepEqual(observe(variant),[],variant);
});

test('responsive legacy controls use the visible connected buttons when duplicate player bars are hidden',()=>{
  let shuffle=false;
  const group=visible=>{
    const button={getClientRects:()=>visible?[{}]:[],getAttribute:()=>null,querySelector:()=>null,click(){
      assert.equal(visible,true);shuffle=!shuffle;
    }};
    return {get shuffleEnabled(){return visible&&shuffle;},repeatMode:'NONE',querySelector:()=>button};
  };
  const groups=[group(false),group(true),group(false)];
  const document={querySelectorAll:()=>groups,querySelector:selector=>selector==='#movie_player'?{classList:{contains:()=>false},getVideoData:()=>({video_id:id})}:null};
  const read=change=>JSON.parse(JSON.stringify(vm.runInNewContext('('+queuePlaybackSettings.toString()+')(id,change)',{document,id,change})));
  assert.deepEqual(read('shuffle'),{shuffle:false,repeat:'off'});assert.deepEqual(read(),{shuffle:true,repeat:'off'});
});

test('source settings survive controls mounting and being replaced without issuing a duplicate click',async()=>{
  const f=fixture(),s=new MusicSession();s.active={id,generation:3};s.player={};s.updateQueue=async()=>{};
  let reads=0,writeChecks=0;
  s.run=async(_win,_fn,current,change)=>{
    if(!change && ++reads===1)return {pending:true,error:'Mounting controls.'};
    if(change && ++writeChecks===1)return {pending:true,error:'Replacing shuffle button.'};
    return f.run(current,change);
  };
  assert.deepEqual(await s.setPlaybackSettings({shuffle:true}),{shuffle:true,repeat:'off'});
  assert.deepEqual(f.state.clicks,['shuffle']);
  f.state.ad=true;
  await assert.rejects(s.setPlaybackSettings({shuffle:false}),/advertisement/);
  assert.deepEqual(f.state.clicks,['shuffle']);
});

