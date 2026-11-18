const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {frameVideo}=require('../src/main/site-player.cjs');

test('the native video viewport masks site chrome and releases both ad layouts',()=>{
 const writes=[],style={};
 const document={documentElement:{toggleAttribute:(k,v)=>writes.push(v)},querySelector:()=>null,getElementById:()=>null,createElement:()=>style,head:{appendChild(){}}};
 vm.runInNewContext('('+frameVideo.toString()+')(true)',{document});
 assert.deepEqual(writes,[true]);assert.match(style.textContent,/data-desktop-player-path/);assert.doesNotMatch(style.textContent,/body \*:has/);
 assert.ok(style.textContent.split('\n').every(line=>line.includes('.ad-showing,#movie_player.ad-interrupting')));
 assert.match(style.textContent,/object-fit:contain/);
 const compact=style.textContent.split('\n').find(rule=>rule.includes(':is(#music-player-wrapper,#movie_player)'));
 assert.ok(compact);for(const declaration of ['position:fixed','width:var(--desktop-video-width,100vw)','height:var(--desktop-video-height,100vh)'])assert.ok(compact.includes(declaration+'!important'));
 vm.runInNewContext('('+frameVideo.toString()+')(false)',{document});assert.deepEqual(writes,[true,false]);
});

test('seeks while paused publish the confirmed new playback position for synchronized lyrics',()=>{
 const listeners={},events=[];const media={currentTime:15,duration:135,readyState:4,paused:true,ended:false};
 const player={querySelector:q=>q.includes('video')?media:null,classList:{contains:()=>false}};
 const document={querySelector:q=>q==='#movie_player'?player:null,addEventListener:(name,fn)=>listeners[name]=fn};
 const url=new URL('https://music.youtube.com/watch?v=abcdefghijk');
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/session-preload.cjs'),'utf8'),{document,process:{isMainFrame:true},location:url,URL,
 require:()=>({ipcRenderer:{send:(_topic,payload)=>{if(payload.kind!=='observe')events.push(payload)}}}),navigator:{},setInterval(){},setTimeout(){}});
 listeners.pause();media.currentTime=65;listeners.seeked();
 assert.deepEqual(events.map(e=>[e.state,e.position]),[['paused',15],['paused',65]]);
});

test('video gestures reach controls underneath the native view in shell coordinates while ads retain input',()=>{
 const {MusicSession}=require('../src/main/music-session.cjs'),s=new MusicSession();
 let blocked=0,focus=0;const sent=[];
 s.mode='video';s.videoBounds={x:11,y:30,width:100,height:100};s.playerView={getBounds:()=>s.videoBounds};
 s.host={isDestroyed:()=>false,webContents:{focus:()=>{focus++;},sendInputEvent:e=>sent.push(e)}};
 const event={preventDefault(){blocked++;}},input={x:16,y:22,type:'mouseDown',button:'left'};
 s.forwardVideoPointer(event,input);assert.deepEqual(sent,[{...input,x:27,y:52}]);assert.equal(focus,1);
 s.adVisible=true;s.forwardVideoPointer(event,input);assert.equal(blocked,1);
 s.adVisible=false;s.manualOfficial=true;s.forwardVideoPointer(event,input);assert.equal(sent.length,1);
});

test('an offscreen animated video slot stays hidden until it has usable host bounds',()=>{
 const {MusicSession}=require('../src/main/music-session.cjs'),s=new MusicSession();let bounds,visible;
 s.playerView={setBounds:v=>bounds=v,setVisible:v=>visible=v};
 s.attachHost({isDestroyed:()=>false,getContentSize:()=>[900,620],contentView:{addChildView(){}},on(){}});
 s.mode='video';s.setVideoBounds({x:100,y:617,width:430,height:430});assert.equal(visible,false);
 s.setVideoBounds({x:100,y:90,width:430,height:430});assert.equal(visible,true);assert.deepEqual(bounds,{x:100,y:90,width:430,height:430});
});

test('a recycled player response cannot attach the next recording clock to the old title',()=>{
 const handlers={},events=[],id='abcdefghijk',next='lmnopqrstuv',route=new URL('https://music.youtube.com/watch?v=abcdefghijk');let responseId=id,actual=id,expected=140;
 const media={currentTime:135,duration:140,readyState:4,paused:false,ended:false};
 const player={querySelector:q=>q.includes('video')?media:null,classList:{contains:()=>false},getVideoData:()=>({video_id:actual}),getPlayerResponse:()=>({videoDetails:{videoId:responseId,lengthSeconds:expected,title:responseId===id?'Old song':'New song',author:responseId===id?'Old artist':'New artist'}})};
 const document={querySelector:q=>q==='#movie_player'?player:null,addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/session-preload.cjs'),'utf8'),{document,process:{isMainFrame:true},location:route,URL,require:()=>({ipcRenderer:{send:(_topic,payload)=>{if(payload.kind!=='observe')events.push(payload)}}}),navigator:{},setInterval(){},setTimeout(){}});
 handlers.playing();assert.equal(events.length,1);assert.equal(events[0].mediaId,id);
 responseId=next;media.currentTime=.4;handlers.playing();assert.equal(events.length,1);
 responseId=id;media.duration=170;handlers.playing();assert.equal(events.length,1);
 route.searchParams.set('v',next);actual=next;handlers.playing();assert.equal(events.length,1);
 responseId=next;expected=170;media.currentTime=.4;handlers.playing();assert.equal(events.length,2);
 const last=events.at(-1);assert.equal(last.id,next);assert.equal(last.position,.4);assert.equal(last.duration,170);assert.equal(last.title,'New song');assert.equal(last.artist,'New artist');
});

test('fullscreen view geometry is owned by the host and restores embedded geometry on exit',()=>{
 const {MusicSession}=require('../src/main/music-session.cjs'),s=new MusicSession();let bounds,size=[1220,820];
 s.playerView={setBounds:v=>bounds=v,setVisible(){}};
 s.attachHost({isDestroyed:()=>false,getContentSize:()=>size,contentView:{addChildView(){}},on(){}});s.mode='video';
 s.setVideoBounds({x:100,y:80,width:420,height:420,presentation:'embedded'});
 s.setCinema(true);assert.deepEqual(bounds,{x:0,y:0,width:1220,height:820});
 s.setVideoBounds({x:0,y:0,width:1220,height:820,presentation:'cinema'});
 size=[800,590];s.resizePlayer();assert.deepEqual(bounds,{x:0,y:0,width:800,height:590});
 s.setVideoBounds({x:200,y:75,width:280,height:280,presentation:'embedded'});
 assert.equal(bounds.width,800);s.setCinema(false);assert.deepEqual(bounds,{x:200,y:75,width:280,height:280});
 let forwarded=0;s.cinema=true;s.host.webContents={sendInputEvent:()=>forwarded++,focus(){}};
 s.forwardVideoPointer({preventDefault:()=>forwarded++},{type:'mouseDown',x:10,y:30});assert.equal(forwarded,0);
});


test('main-world playback snapshots reject stale media and unrelated metadata',()=>{
 const {playbackSnapshot,restorePosition}=require('../src/main/site-player.cjs');
 const id='abcdefghijk',other='lmnopqrstuv',url=new URL('https://music.youtube.com/watch?v='+id);
 let actual=id,response=id,barTitle='Previous song',metaTitle='Previous song';const media={currentTime:91,duration:120,readyState:4,paused:false,ended:false,seeking:false};
 const player={classList:{contains:()=>false},getVideoData:()=>({video_id:actual,title:'Correct song'}),getPlayerResponse:()=>({videoDetails:{videoId:response,title:'Correct song',author:'Correct artist',lengthSeconds:120}}),querySelector:q=>q.includes('video')?media:null,seekTo:n=>{media.currentTime=n;media.seeking=true}};
 const bar={querySelector:q=>q.includes('Title')||q.includes('.title')?{textContent:barTitle}:{textContent:'Wrong artist'}};
 const document={querySelector:q=>q==='#movie_player'?player:bar},navigator={mediaSession:{metadata:{get title(){return metaTitle},artist:'Wrong artist',artwork:[{src:'wrong-art'}]}}};
 const run=fn=>vm.runInNewContext('('+fn.toString()+')()', {document,navigator,location:url,URL});
 assert.equal(run(playbackSnapshot).title,'Correct song');assert.equal(run(playbackSnapshot).artist,'Correct artist');assert.equal(run(playbackSnapshot).artwork,'');
 actual=other;assert.equal(run(playbackSnapshot),null);response=other;assert.equal(run(playbackSnapshot).id,other);actual=id;response=other;assert.equal(run(playbackSnapshot),null);response=id;media.duration=180;assert.equal(run(playbackSnapshot),null);
 media.duration=120;
 const reset=()=>vm.runInNewContext('('+restorePosition.toString()+')(id,0)',{document,id});
 assert.equal(reset(),false);assert.equal(media.currentTime,0);assert.equal(reset(),false);media.seeking=false;assert.equal(reset(),true);
});

test('confirmed song clocks survive source buffer duration expansion after seeking',()=>{
 const {playbackSnapshot}=require('../src/main/site-player.cjs');const id='abcdefghijk',url=new URL('https://music.youtube.com/watch?v='+id);
 const media={readyState:4,currentTime:208,duration:234,paused:false,ended:false};
 const player={classList:{contains:()=>false},getVideoData:()=>({video_id:id}),getPlayerResponse:()=>({videoDetails:{videoId:id,lengthSeconds:212,title:'Cheap Thrills'}}),querySelector:()=>media};
 const document={querySelector:s=>s==='#movie_player'?player:null},sandbox={document,navigator:{},location:url,URL,id};
 const run=(current,duration)=>vm.runInNewContext('('+playbackSnapshot.toString()+')('+JSON.stringify(current)+','+duration+')',sandbox);
 assert.equal(run(id,0),null);assert.equal(run('lmnopqrstuv',212),null);
 assert.equal(run(id,212).position,208);assert.equal(run(id,212).duration,212);
 media.currentTime=230;assert.equal(run(id,212).position,212);
});

test('fullscreen video resizes once and repeated layout reports do not resize the decoder again',()=>{
 const {MusicSession}=require('../src/main/music-session.cjs'),s=new MusicSession(),calls=[];
 s.playerView={setBounds:(rect,options)=>calls.push({rect,options}),setVisible(){}};
 s.attachHost({isDestroyed:()=>false,getContentSize:()=>[1440,870],contentView:{addChildView(){}},on(){}});s.mode='video';
 s.setVideoBounds({x:100,y:90,width:430,height:430});calls.length=0;
 s.setCinema(true);assert.equal(calls.length,1);assert.equal(calls[0].options,undefined);
 s.setVideoBounds({x:0,y:0,width:1440,height:870,presentation:'cinema'});assert.equal(calls.length,1);
 s.setCinema(false);assert.deepEqual(calls.at(-1).rect,{x:100,y:90,width:430,height:430});assert.equal(calls.at(-1).options,undefined);
 s.animationsEnabled=()=>false;s.setCinema(true);assert.equal(calls.at(-1).options,undefined);
});

test('movie fullscreen motion animates only opacity and transform and can be interrupted',async()=>{
 const {animateVideoPresentation}=require('../src/main/site-player.cjs');const calls=[];
 const node={style:{removeProperty(){}},animate:(frames,options)=>{calls.push({frames,options});return {finished:Promise.resolve(),cancel:()=>calls.push('cancel')};}};
 const document={querySelector:()=>node},run=value=>vm.runInNewContext('('+animateVideoPresentation.toString()+')('+value+')',{document,Symbol});
 assert.equal(run(true),true);assert.equal(run(false),true);assert.equal(calls[0].options.duration,420);assert(calls.includes('cancel'));
 assert.deepEqual(Object.keys(calls[0].frames[0]),['opacity','transform']);
});

