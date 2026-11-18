const test = require('node:test');
const assert = require('node:assert/strict');
const {MusicSession,allowedURL,guardNavigation,readPage} = require('../src/main/music-session.cjs');
const vm = require('node:vm');

test('only first-party HTTPS account and playback hosts can navigate a session window',()=>{
  assert.ok(allowedURL('https://accounts.google.com/v3/signin/identifier'));
  assert.ok(allowedURL('https://music.youtube.com/watch?v=0_M2JX-Olv8'));
  for(const url of ['http://music.youtube.com/','https://accounts.google.com.other.test','file:///etc/passwd','https://youtube.com@evil.test','https://music.youtube.com:9876/'])assert.equal(allowedURL(url),false);
});
test('Google password challenges can complete the YouTube session-cookie redirect chain',()=>{
  const blocked=[];
  function navigate(url,isMainFrame=true){
    let prevented=false;
    guardNavigation({url,isMainFrame,preventDefault(){prevented=true;}},host=>blocked.push(host));
    return !prevented;
  }
  for(const url of [
    'https://accounts.google.com/v3/signin/challenge/pwd',
    'https://accounts.google.co.uk/CheckCookie',
    'https://accounts.google.com.au/CheckCookie',
    'https://accounts.youtube.com/accounts/SetSID',
    'https://accounts.blogger.com/accounts/SetSID',
    'https://www.youtube.com/signin?action_handle_signin=true',
    'https://music.youtube.com/'
  ])assert.ok(navigate(url),url);
  assert.ok(navigate('https://www.gstatic.com/challenge',false));
  for(const host of ['accounts.google.com.example.org','accounts.google.invalid','accounts.youtube.com.example.org']){
    assert.equal(navigate('https://'+host+'/SetSID?token=redacted'),false);
    assert.equal(blocked.at(-1),host);
  }
});

test('reopening sign-in focuses its Google window while the underlying player remains available',()=>{
  const calls=[];
  const s=new MusicSession();
  s.player={webContents:{getURL:()=>'https://music.youtube.com/',focus:()=>{}}};
  s.playerView={setVisible:visible=>calls.push(visible?'player':'hidden')};
  s.auth={isDestroyed:()=>false,show:()=>calls.push('account'),focus:()=>calls.push('focus')};
  s.show();
  assert.deepEqual(calls,['account','focus']);
  s.auth=null;s.show();assert.equal(calls.at(-1),'player');
});
test('an old stop command cannot cancel the next track navigation',async()=>{
  const events=[],oldPause=Promise.withResolvers();
  const s=new MusicSession();
  s.active={id:'0_M2JX-Olv8',generation:2};
  s.player={webContents:{stop:()=>events.push('stop-loading')},loadURL:async url=>{events.push('open '+url);}};
  s.run=async (_win,_command,action)=>{if(action==='stop')await oldPause.promise;return true;};
  const stopping=s.command('stop');
  const next=s.play({id:'7nxWP9BhI7w',playlistId:'LM'},3,.5);
  await next;oldPause.resolve();await stopping;
  assert.deepEqual(events,['stop-loading','open https://music.youtube.com/watch?v=7nxWP9BhI7w&list=LM&t=0s']);
  assert.equal(s.active.id,'7nxWP9BhI7w');
});
test('an in-page watch with playlist context waits for its player and cancels a superseded request',async()=>{
  const s=new MusicSession(),first=Promise.withResolvers(),actions=[],loads=[];
  const origin='https://music.youtube.com/',a='0_M2JX-Olv8',b='7nxWP9BhI7w';
  s.player={webContents:{getURL:()=>origin+'watch?v=abcdefghijk'},loadURL:async url=>loads.push(url)};
  s.run=async(_win,fn,id,list)=>{
    if(fn.name==='navigateWatch'){actions.push([id,list]);return id===a?first.promise:true;}
    if(fn.name==='watchCommitted')return id===b && list==='LM';
    return true;
  };
  const stale=s.play({id:a},2,.4);await s.play({id:b,playlistId:'LM'},3,.5);
  first.resolve(true);await stale;
  assert.deepEqual(actions,[[b,'LM']]);assert.equal(s.active.id,b);
  assert.deepEqual(loads,[]);assert.equal(s.awaitingLoad,false);
});
test('a watch URL alone cannot confirm newly selected media; an ad may occupy the same route',()=>{
  const {watchCommitted}=require('../src/main/site-player.cjs');
  const id='0_M2JX-Olv8';let source='7nxWP9BhI7w',ad=false;
  const document={querySelector:()=>({classList:{contains:()=>ad},getVideoData:()=>({video_id:source})})};
  const run=(list)=>vm.runInNewContext('('+watchCommitted.toString()+')(id,list)',{id,list,document,location:{href:'https://music.youtube.com/watch?v='+id+'&list=LM'},URL});
  assert.equal(run('LM'),false);source=id;assert.equal(run('LM'),true);assert.equal(run('PLelse'),false);
  source='other';ad=true;assert.equal(run('LM'),true);
});
test('rendered collection cards preserve ordered repeats in playlists and deduplicate discovery',()=>{
  const id='0_M2JX-Olv8';
  const card={data:{playlistItemData:{videoId:id},flexColumns:[
    {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Feather'}]}}},
    {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:'Nujabes',navigationEndpoint:{browseEndpoint:{browseId:'UCexample'}}},{text:'2:56'}]}}}
  ]},querySelector:()=>null,closest:()=>null};
  const doc={querySelector:()=>null,querySelectorAll:()=>[card,card]};
  const run=repeat=>vm.runInNewContext('('+readPage.toString()+')('+repeat+')',{document:doc});
  assert.equal(run(true).tracks.length,2);
  const out=run(false);
  assert.equal(out.tracks.length,1);assert.equal(out.tracks[0].artist,'Nujabes');assert.equal(out.tracks[0].duration,176);
});

function browserFixture({identity={connected:false,name:''},onComplete=async()=>({ok:true}),onCancel=async()=>{},onClose=async()=>{}}={}){
  const events=[];
  const session=new MusicSession();
  session.partition={clearStorageData:async()=>events.push('cleared')};
  session.browserFlow={
    status:()=>({active:true,canComplete:true,message:'Ready in Chrome'}),
    complete:onComplete,cancel:onCancel,close:onClose,start:async()=>{}
  };
  session.player={loadURL:async()=>events.push('player reloaded')};
  session.window=()=>({loadURL:async url=>events.push(url),isDestroyed:()=>false,destroy:()=>events.push('verify closed')});
  session.readIdentity=async()=>identity;
  session.sync=async()=>{events.push('sync');};
  return {session,events};
}

test('completion requires YouTube Music to identify the transferred session as signed in',async()=>{
  const {session,events}=browserFixture();
  await assert.rejects(session.completePasskeySignIn(),/did not accept/);
  assert.equal(session.status().connected,false);
  assert.deepEqual(events,['https://music.youtube.com/','verify closed','cleared']);
});

test('a confirmed browser sign-in opens one verification document and syncs the new account',async()=>{
  const {session,events}=browserFixture({identity:{connected:true,name:'Test',id:'test-id'}});
  const [a,b]=await Promise.all([session.completePasskeySignIn(),session.completePasskeySignIn()]);
  assert.equal(a.connected,true);assert.equal(b.name,'Test');assert.equal(b.browserSignIn.active,false);
  assert.deepEqual(events,['https://music.youtube.com/','verify closed','player reloaded','sync']);
  assert.equal(session.status().id,'test-id');
  await assert.rejects(session.startPasskeySignIn(),/Sign out/);
});

test('cancelling an in-flight transfer waits for writes before removing the candidate',async()=>{
  const transfer=Promise.withResolvers();
  const {session,events}=browserFixture({onComplete:()=>transfer.promise,onCancel:async()=>{await transfer.promise;events.push('transfer settled');}});
  const finish=session.completePasskeySignIn();
  const aborted=assert.rejects(finish,/cancelled/);
  const cancellation=session.cancelPasskeySignIn();
  assert.deepEqual(events,[]);
  transfer.resolve({ok:true});await aborted;await cancellation;
  assert.deepEqual(events,['transfer settled','cleared']);
  assert.equal(session.status().connected,false);
});

test('cancellation after site verification and before temporary profile cleanup cannot publish an account',async()=>{
  const closing=Promise.withResolvers(),closed=Promise.withResolvers();
  const {session,events}=browserFixture({identity:{connected:true,name:'Test'},onClose:async()=>{closing.resolve();await closed.promise;}});
  const aborted=assert.rejects(session.completePasskeySignIn(),/cancelled/);
  await closing.promise;
  assert.equal(session.status().connected,false);
  const cancellation=session.cancelPasskeySignIn();
  closed.resolve();await cancellation;await aborted;
  assert.equal(events.at(-1),'cleared');assert.equal(session.status().connected,false);
});

test('absent or partly written Chrome session never connects and its candidate cookies are cleared',async()=>{
  const {session,events}=browserFixture({onComplete:async()=>{throw Error('Could not transfer the YouTube session.');}});
  await assert.rejects(session.completePasskeySignIn(),/Could not transfer/);
  assert.deepEqual(events,['cleared']);
  assert.equal(session.status().connected,false);
});

test('changing identities in the official player discards previous data as soon as detected',async()=>{
  const snapshots=[];
  const session=new MusicSession({onAccount:()=>snapshots.push({id:session.status().id,liked:session.snapshot().liked.map(x=>x.id)})});
  session.profile={connected:true,name:'Old',id:'one'};
  session.data.liked=[{id:'old'}];
  session.readIdentity=async()=>({connected:true,name:'New',id:'two'});
  session.readPageAt=async url=>({identity:await session.readIdentity(),tracks:url.includes('list=LM')?[{id:'new'}]:[],playlists:[],artists:[],releases:[]});
  await session.sync();
  const changes=snapshots.filter(s=>s.id==='two');
  assert.deepEqual(changes[0].liked,[]);
  assert.deepEqual(changes.at(-1).liked,['new']);assert.equal(session.epoch,1);
});
test('automatic sync publishes each first page, preserves successful collections when one fails and reports its stage',async()=>{
  const session=new MusicSession();
  const published=[];
  session.onAccount=()=>published.push({stage:session.status().syncStage,lists:session.snapshot().playlists.length,liked:session.snapshot().liked.length});
  session.readPageAt=async(url,field,all,repeats,onPage)=>{
    const page={identity:{connected:true,name:'Test'},tracks:[],playlists:[],artists:[],releases:[]};
    if(url.includes('/library/playlists'))page.playlists=[{id:'demo'}];
    if(url.includes('list=LM')){page.tracks=[{id:'liked'}];page.pendingContinuation=true;}
    if(url.endsWith('/history'))throw Error('Collection unavailable.');
    if(url.endsWith('/library/songs'))page.tracks=[{id:'saved'}];
    onPage?.(page);return page;
  };
  await session.sync();
  assert.ok(published.some(x=>x.lists===1 && !x.liked));
  assert.equal(session.snapshot().liked[0].id,'liked');
  assert.equal(session.snapshot().songs[0].id,'saved');
  assert.deepEqual(session.status().collectionErrors,['Recently played']);
});
test('library metadata cache opens only after verifying its identity and is dropped on account switch',t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-metadata-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const saved=new MusicSession({dir});
  saved.profile={connected:true,id:'one',name:'Test',handle:'@test',avatar:'https://yt3.ggpht.com/test'};
  saved.data.liked=[{id:'track'}];saved.cacheCollections(true,['liked']);
  assert.equal(fs.statSync(saved.cacheFile).mode&0o777,0o600);
  const restored=new MusicSession({dir});
  assert.deepEqual(restored.snapshot().liked,[]);
  const identity={connected:true,id:'one',name:'YouTube Music account'};
  restored.restoreCache(identity);assert.equal(identity.name,'Test');
  assert.equal(restored.snapshot().liked[0].id,'track');
  const switched=new MusicSession({dir});
  switched.restoreCache({connected:true,id:'two'});assert.deepEqual(switched.snapshot().liked,[]);
  assert.equal(fs.existsSync(saved.cacheFile),false);
});
test('partial sessions keep the verified account name and untouched collections, including after a real unlike',async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-partial-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const saved=new MusicSession({dir});
  saved.profile={connected:true,id:'one',name:'Real name',avatar:'https://yt3.ggpht.com/profile'};
  saved.data.liked=[{id:'first'},{id:'second'}];saved.data.playlists=[{id:'playlist'}];
  saved.cacheCollections(true,['liked','playlists']);
  const partial=new MusicSession({dir});
  partial.profile={connected:true,id:'one',name:'YouTube Music account'};
  partial.cacheCollections(true);
  partial.data.history=[{track:{id:'first'}}];partial.cacheCollections(false,['history']);partial.close();
  const read=()=>JSON.parse(fs.readFileSync(saved.cacheFile,'utf8'));
  assert.equal(read().profile.name,'Real name');assert.equal(read().profile.avatar,saved.profile.avatar);
  assert.deepEqual(read().collections.playlists,saved.data.playlists);
  assert.deepEqual(read().collections.liked,saved.data.liked);assert.deepEqual(read().collections.history,partial.data.history);
  const writer=new MusicSession({dir});writer.profile={connected:true,id:'one',name:'YouTube Music account'};writer.rating=async()=>true;
  await writer.rate('first','none');await writer.rate('second','none');writer.close();
  assert.deepEqual(read().collections.liked,[]);assert.deepEqual(read().collections.playlists,saved.data.playlists);
});
test('a blank collection document during sync keeps the verified copy until the site explicitly reports empty',async()=>{
  const s=new MusicSession();const identity={connected:true,id:'one',name:'Actual'};
  s.profile=identity;s.data.playlists=[{id:'p'}];let explicitEmpty=false;
  s.readPageAt=async()=>({identity,tracks:[],artists:[],releases:[],playlists:[],history:[],explicitEmpty});
  await s.sync();assert.deepEqual(s.data.playlists,[{id:'p'}]);assert.deepEqual(s.collectionErrors,['Playlists']);
  explicitEmpty=true;await s.sync();assert.deepEqual(s.data.playlists,[]);assert.deepEqual(s.collectionErrors,[]);
});
test('official queue keeps repeated tracks and excludes the exact playing row plus everything before it',()=>{
  const {readQueue}=require('../src/main/music-session.cjs');
  const first='0_M2JX-Olv8',second='V8Xh5ErjIyM';
  function row(id,selected){return {hasAttribute:()=>selected,data:{videoId:id,title:{runs:[{text:'Title'}]},
    shortBylineText:{runs:[{text:'Artist'}]},lengthText:{simpleText:'3:11'},thumbnail:{thumbnails:[{url:'https://i.ytimg.com/cover.jpg'}]}}};}
  const rows=[row(first,false),row(first,true),row(second,false),row(second,false)];
  const queue={hasAttribute:()=>true,querySelectorAll:()=>rows};
  const result=vm.runInNewContext('('+readQueue.toString()+')("'+first+'","LM")',{document:{querySelector:()=>queue}});
  assert.deepEqual(Array.from(result,t=>t.id),[second,second]);
  assert.equal(result[0].duration,191);assert.equal(result[0].playlistId,'LM');
});

test('interactive results bypass library pagination and background recommendations and cache repeated searches',async()=>{
  const s=new MusicSession();
  s.readTail=s.recommendationTail=new Promise(()=>{});
  s.player={};
  let url,loads=0;
  const track={id:'0_M2JX-Olv8',title:'Feather'};
  s.window=()=>({isDestroyed:()=>false,
    webContents:{getURL:()=>url,isLoadingMainFrame:()=>false},
    loadURL:async href=>{url=href;loads++;}});
  s.run=async()=>({tracks:[track]});
  assert.deepEqual(await s.search('Feather',{interactive:true}),[track]);
  assert.deepEqual(await s.search('feather',{interactive:true}),[track]);
  assert.equal(loads,1);
});

test('typing a newer query cancels an older reader result and keeps new results separate',async()=>{
  const s=new MusicSession();s.player={};
  const deferred=Promise.withResolvers();
  let url,current='old';
  s.window=()=>({isDestroyed:()=>false,
    webContents:{getURL:()=>url,isLoadingMainFrame:()=>false},loadURL:async href=>{url=href;}});
  s.run=async()=>current==='old'?deferred.promise:{tracks:[{id:'new'}]};
  const old=s.search('old',{interactive:true});
  current='new';
  const next=await s.search('new',{interactive:true});
  deferred.resolve({tracks:[{id:'old'}]});
  assert.deepEqual(await old,[]);
  assert.equal(next[0].id,'new');
});

test('a warmed first-party search waits for recycled rows before publishing the next query',async()=>{
  const vm=require('node:vm');
  const s=new MusicSession();s.player={};s.partition={};
  const old={title:'Old'},next={title:'New'};
  const first={data:old};
  const page={data:{},querySelector:selector=>selector.includes('message-renderer')?null:first};
  const input={value:'',focus(){document.activeElement=this;},dispatchEvent(){}};
  const document={querySelector:selector=>selector.includes('search-box')?input:page};
  let href='',loads=0,rowReads=0;
  s.window=()=>({isDestroyed:()=>false,loadURL:async url=>{href=url;loads++;},webContents:{
    getURL:()=>href,sendInputEvent(event){
      if(event.type!=='char')return;
      assert.equal(event.keyCode,'\r');
      href='https://music.youtube.com/search?q='+input.value;
      page.data={}; // Route and page commit before Polymer replaces its first row.
      setTimeout(()=>{first.data=next;},60);
    }
  }});
  s.run=async(win,fn,...args)=>{
    if(fn.name==='readPage'){rowReads++;return {tracks:[first.data]};}
    return vm.runInNewContext('('+fn.toString()+')(...args)',{document,Event,args});
  };
  s.warmSearch();await s.warmingSearch.promise;
  assert.deepEqual(await s.search('New',{interactive:true}),[next]);
  assert.equal(loads,1);assert.equal(rowReads,1);
});

test('the service view fits and resizes inside the original host without opening or focusing a window',()=>{
  const s=new MusicSession();let bounds,visible=false,resize,focus=0;
  const view={setVisible:v=>{visible=v;},setBounds:v=>{bounds=v;}};
  let size=[1024,700];const children=[];
  const host={isDestroyed:()=>false,getContentSize:()=>size,on:(_,cb)=>{resize=cb;},
    contentView:{addChildView:v=>children.push(v)},show:()=>{focus++;},focus:()=>{focus++;}};
  s.playerView=view;s.attachHost(host);
  assert.deepEqual(bounds,{x:0,y:0,width:900,height:680});
  s.adVisible=true;s.showOfficial();
  assert.equal(visible,true);assert.deepEqual(children,[view]);assert.equal(bounds.width,580);
  size=[360,440];resize();
  assert.ok(bounds.x+bounds.width<=360 && bounds.y+bounds.height<=440);
  s.adVisible=false;s.hideOfficial();
  assert.equal(visible,false);assert.equal(focus,0);assert.deepEqual(bounds,{x:0,y:0,width:900,height:680});
});

test('playlist opens independently of library sync and keeps each service-confirmed sort in its own cache',async()=>{
  const s=new MusicSession();s.player={};s.readTail=new Promise(()=>{});
  let sort='default',loads=0;
  const tracks={default:[{id:'b'},{id:'a'}],newest:[{id:'a'},{id:'b'}],oldest:[{id:'b'},{id:'a'}]};
  s.window=()=>({isDestroyed:()=>false,destroy(){},loadURL:async()=>{loads++;}});
  s.collect=async()=>({tracks:tracks[sort]});
  s.run=async(_reader,_fn,choice)=>{sort=choice;return true;};
  assert.deepEqual(await s.playlist('PLfoo',{sort:'newest'}),tracks.newest);
  assert.deepEqual(await s.playlist('PLfoo',{sort:'oldest'}),tracks.oldest);
  assert.deepEqual(await s.playlist('PLfoo',{sort:'newest'}),tracks.newest);
  assert.equal(loads,1);
  s.run=async()=>false;
  await assert.rejects(s.playlist('PLbar',{sort:'oldest'}),/does not offer oldest first/);
  await assert.rejects(s.playlist('PLfoo',{sort:'fake'}),/Unknown playlist order/);
});

test('playlist sorting clicks the service view-order control and waits for the confirmed option',async()=>{
  const {applyPlaylistSort}=require('../src/main/music-session.cjs');const calls=[];
  const items=[{title:'Newest first',selected:false},{title:'Default ordering',selected:true}];
  const el={textContent:'Newest first',click(){calls.push('item');setImmediate(()=>{items[0].selected=true;items[1].selected=false;});}};
  const menu={data:{subMenuItems:items},querySelector:()=>({click:()=>calls.push('menu')}),querySelectorAll:()=>[el]};
  const vm=require('node:vm');
  const result=await vm.runInNewContext('('+applyPlaylistSort.toString()+')("newest")',{document:{querySelector:()=>menu},setTimeout});
  assert.equal(result,true);assert.deepEqual(calls,['menu','item']);
});

test('date-added paging repairs an overlapping site continuation using verified playlist occurrence IDs',async()=>{
  const s=new MusicSession();s.player={};let sort;
  const row=(id,entry)=>({id,playlistEntryId:entry});
  const oldest=[row('songA','s1'),row('songB','s2'),row('songA','s3'),row('songC','s4')];
  const brokenNewest=[oldest[3],oldest[2],oldest[2],oldest[3]];
  s.window=()=>({isDestroyed:()=>false,destroy(){},loadURL:async()=>{}});
  s.run=async(_r,_fn,choice)=>{sort=choice;return true;};
  s.collect=async()=>({tracks:sort==='newest'?brokenNewest:oldest});
  assert.deepEqual((await s.playlist('PLfixture',{sort:'newest'})).map(t=>t.playlistEntryId),['s4','s3','s2','s1']);
  assert.deepEqual((await s.playlist('PLfixture',{sort:'oldest'})).map(t=>t.id),['songA','songB','songA','songC']);
});

test('Up next removes leading song/video duplicates and preserves later repeated entries',async()=>{
  const events=[],s=new MusicSession({onEvent:e=>events.push(e)});
  const current={source:'youtube',id:'abcdefghijk',title:'Surf',artist:'Young Thug'};
  const alternate={...current,id:'lmnopqrstuv',title:'Surf (Official Music Video)'};
  const next={...current,id:'aaaaaaaaaaa',title:'Surf (Live)'};
  s.active={id:current.id,generation:7,track:current};
  s.run=async(_win,fn)=>fn.name==='readQueue'?[alternate,current,next,current]:fn.name==='queueCategories'?[{id:'0-All',title:'All',selected:true}]:{available:true};
  await s.updateQueue(current.id,7);
  const queue=events.find(event=>event.type==='queue');
  assert.deepEqual(queue.tracks.map(t=>t.id),[next.id,current.id]);assert.equal(queue.categories[0].title,'All');
  assert.equal(events.find(e=>e.type==='mode').videoAvailable,true);
});

test('video pane is clipped to the host, disappears on collapse, and yields to advertisements',()=>{
  const s=new MusicSession();let bounds,visible;
  const host={isDestroyed:()=>false,getContentSize:()=>[900,600],contentView:{addChildView(){}},on(){}};
  s.playerView={setBounds:rect=>bounds=rect,setVisible:value=>visible=value};s.attachHost(host);s.mode='video';
  s.setVideoBounds({x:760,y:80,width:500,height:400});
  assert.deepEqual(bounds,{x:760,y:80,width:140,height:400});assert.equal(visible,true);
  s.setVideoBounds(null);assert.equal(visible,false);
  s.adVisible=true;s.showOfficial();s.setVideoBounds(null);assert.equal(visible,true);
});

test('source queue filters click only an existing chip and refuse arbitrary names',()=>{
  const {queueCategories}=require('../src/main/site-player.cjs');
  const clicks=[];
  const chips=['All','Discover'].map((text,index)=>({textContent:text,data:{isSelected:index===0},hasAttribute:()=>false,
    querySelector:()=>({click:()=>clicks.push(text),getAttribute:()=>null})}));
  const run=value=>vm.runInNewContext('('+queueCategories.toString()+')(value)',{document:{querySelectorAll:()=>chips},value});
  assert.equal(run()[0].selected,true);assert.equal(run('1-Discover'),true);
  assert.equal(run('0-All'),true);assert.equal(run('2-Made up'),false);assert.deepEqual(clicks,['Discover']);
});

test('source transport confirms recording change and never skips a service ad',async()=>{
  const {skipRecording}=require('../src/main/site-player.cjs');
  let id='abcdefghijk',ad=true,clicks=0;
  const p={classList:{contains:()=>ad},querySelector:()=>({currentTime:8}),getVideoData:()=>({video_id:id})};
  const button={getClientRects:()=>[1],getAttribute:()=>null,querySelector:()=>null,click(){clicks++;id='lmnopqrstuv';}};
  const run=()=>vm.runInNewContext('('+skipRecording.toString()+')("next")',{document:{querySelector:()=>p,querySelectorAll:q=>q.includes('player-bar')?[button]:[]},setTimeout:r=>r()});
  assert.equal((await run()).reason,'ad');assert.equal(clicks,0);
  ad=false;const result=await run();assert.equal(result.id,'lmnopqrstuv');assert.equal(result.ok,true);assert.equal(clicks,1);
  assert.equal((await run()).reason,'unchanged');
});

test('playlist sharing is read-only and mutations reject invalid input or stale sessions',async()=>{
  const {playlistAction}=require('../src/main/site-playlist-actions.cjs');
  const s=new MusicSession();let opened=0;s.window=()=>{opened++;throw Error('Unexpected reader');};
  assert.equal((await playlistAction(s,'share',{id:'PLfixture'})).url,'https://music.youtube.com/playlist?list=PLfixture');
  await assert.rejects(playlistAction(s,'share',{id:'https://example.org'}),/Invalid/);
  await assert.rejects(playlistAction(s,'create',{title:'Hello'}),/Sign in/);
  s.profile.connected=true;
  await assert.rejects(playlistAction(s,'remove',{id:'PLfixture',videoIds:['bad']}),/valid/);
  await assert.rejects(playlistAction(s,'edit',{id:'PLfixture',privacy:'bad'}),/privacy/);
  const gate=Promise.withResolvers();s.playlistMutation=gate.promise;
  const request=playlistAction(s,'edit',{id:'PLfixture',title:'Changed'});s.epoch++;gate.resolve();
  await assert.rejects(request,/account changed/);assert.equal(opened,0);
});

test('playlist edit reports success only after the official page confirms the saved title and privacy',async()=>{
  const {playlistAction}=require('../src/main/site-playlist-actions.cjs');
  const s=new MusicSession();s.profile.connected=true;
  let inForm=false,submitted=false,touched=0,title='Earlier',privacy='private',destroyed=false;
  s.window=()=>({loadURL:async()=>{},webContents:{setAudioMuted(){}},isDestroyed:()=>destroyed,destroy:()=>{destroyed=true;}});
  s.run=async(_win,fn,action,value)=>{
    if(fn.name==='readPlaylistDetails')return {id:'PLfixture',title,privacy};
    if(action==='edit'){inForm=true;return true;}
    if(action==='form')return inForm?{title,privacy}:null;
    if(action==='title'){title=value;return true;}
    if(action==='openPrivacy')return true;
    if(action==='choosePrivacy'){privacy=value;return true;}
    if(action==='submit'){submitted=true;touched++;inForm=false;return true;}
  };
  const response=await playlistAction(s,'edit',{id:'PLfixture',title:'New name',privacy:'unlisted'});
  assert.equal(submitted,true);assert.equal(touched,1);assert.equal(response.playlist.title,'New name');assert.equal(response.playlist.privacy,'unlisted');assert.equal(destroyed,true);
});

test('removing a repeated song sends one occurrence ID and verifies its count against a reloaded playlist',async()=>{
  const s=new MusicSession();s.profile.connected=true;let visits=0,removed=false,selected,closed=false;
  const id='abcdefghijk';const rows=[{id,playlistEntryId:'first'},{id,playlistEntryId:'second'}];
  s.window=()=>({loadURL:async()=>{visits++;},webContents:{setAudioMuted(){}},isDestroyed:()=>closed,destroy:()=>{closed=true;}});
  s.collect=async()=>({tracks:removed?rows.slice(0,1):rows.slice()});
  s.run=async(_win,fn,name,value)=>{
    if(fn.name==='readPlaylistDetails')return {id:'PLfixture',title:'My music'};
    if(name==='rowMenu'){selected=value.entry;return true;}
    if(name==='menu'){removed=true;return true;}
    if(name==='rowGone')return true;
  };
  const result=await s.playlistAction('remove',{id:'PLfixture',videoIds:[id],playlistEntryId:'second'});
  assert.equal(selected,'second');assert.equal(visits,2);assert.equal(result.playlist.count,1);assert.equal(closed,true);
});

test('playlist previews reach subscribers while the next continuation is still pending',async()=>{
  const s=new MusicSession();s.player={};
  const first=[{id:'abcdefghijk'}],all=[...first,{id:'lmnopqrstuv'}],hold=Promise.withResolvers(),firstSeen=Promise.withResolvers();
  s.window=()=>({loadURL:async()=>{},isDestroyed:()=>false,destroy(){}});
  s.run=async()=>true;
  s.collect=async(_win,_field,scroll,_repeat,onPage)=>{
    if(!scroll)return {tracks:first};
    onPage?.({tracks:first});await hold.promise;onPage?.({tracks:all});return {tracks:all};
  };
  const a=[],b=[];
  const loading=s.playlist('PLfixture',{onPage:tracks=>{a.push(tracks.length);firstSeen.resolve();}});
  await firstSeen.promise;
  const joining=s.playlist('PLfixture',{onPage:tracks=>b.push(tracks.length)});
  assert.deepEqual(a,[1]);assert.deepEqual(b,[1]);
  hold.resolve();assert.equal((await loading).length,2);await joining;
  assert.deepEqual(a,[1,2]);assert.deepEqual(b,[1,2]);
});

test('targeted discovery refresh uses the known first-party section and retains the neighboring shelf',async()=>{
  const s=new MusicSession();s.player={};
  const old={id:'old'},fresh={id:'fresh'},other={id:'1',title:'Other',tracks:[],playlists:[]};
  s.discoveryResult={epoch:0,sections:[{id:'0',title:'Trending',url:'https://music.youtube.com/browse/test',tracks:[old],playlists:[]},other]};
  let url,closed=false;s.window=()=>({loadURL:async value=>{url=value;},isDestroyed:()=>closed,destroy:()=>{closed=true;}});
  s.collect=async()=>({tracks:[old,fresh],playlists:[]});
  const sections=await s.discovery(true,'0');
  assert.equal(url,'https://music.youtube.com/browse/test');assert.equal(closed,true);assert.equal(sections[1],other);
  assert.deepEqual(sections[0].tracks,[fresh,old]);
});

test('dedicated history sync keeps cached coverage until longer pages arrive and preserves same-day repeats',async()=>{
  const s=new MusicSession();s.readTail=new Promise(()=>{});s.profile={id:'owner',connected:true};
  const make=id=>({track:{id},playedOn:'2026-10-07',origin:'account'});
  const cache=[make('one'),make('two')];
  s.data.history=cache;
  const duplicates=[make('one'),make('one'),make('two')],full=[...duplicates,make('three')];
  let destroyed=false,sawSmall=false;
  s.window=role=>{assert.equal(role,'history');return {loadURL:async url=>assert.equal(url,'https://music.youtube.com/history'),isDestroyed:()=>destroyed,destroy:()=>{destroyed=true;}};};
  s.readIdentity=async()=>s.profile;
  const first=Promise.withResolvers(),release=Promise.withResolvers();
  s.collect=async(_win,field,scroll,repeats,onPage)=>{
    assert.equal(field,'history');assert.equal(scroll,true);assert.equal(repeats,true);
    onPage({history:duplicates.slice(0,1)});sawSmall=s.snapshot().history===cache;
    onPage({history:duplicates});first.resolve();await release.promise;return {history:full};
  };
  const heard=[],joined=[];
  const task=s.syncHistory(entries=>heard.push(entries.length));
  await first.promise;const joining=s.syncHistory(entries=>joined.push(entries.length));release.resolve();
  assert.equal((await task).length,4);await joining;
  assert.equal(sawSmall,true);assert.deepEqual(heard,[3,4]);assert.deepEqual(joined,[3,4]);
  assert.equal(s.snapshot().history[0].playedAt,undefined);assert.equal(s.snapshot().history[1].track.id,'one');assert.equal(destroyed,true);
});

test('history ending after account switch cannot publish old plays into the new account',async()=>{
  const s=new MusicSession();s.profile={connected:true,id:'old'};let closed=false;
  s.window=()=>({loadURL:async()=>{},isDestroyed:()=>closed,destroy:()=>{closed=true;}});
  s.readIdentity=async()=>s.profile;
  const started=Promise.withResolvers(),ready=Promise.withResolvers();
  s.collect=async()=>{started.resolve();await ready.promise;return {history:[{track:{id:'old'}}]};};
  const task=s.syncHistory(()=>assert.fail('stale callback'));await started.promise;
  s.epoch++;s.profile={id:'new',connected:true};ready.resolve();
  await assert.rejects(task,/account changed/);assert.equal(s.snapshot().history.length,0);assert.equal(closed,true);
});

test('playlist count fallback reads only the exact committed regular YouTube playlist',async()=>{
  const s=new MusicSession();let committed,reads=0;
  const win={loadURL:async()=>{},isDestroyed:()=>false,webContents:{getURL:()=>committed,executeJavaScript:async()=>{reads++;return {id:'PLfixture',count:493,countSource:'youtube'};}}};
  for(const url of ['https://accounts.google.com/','https://www.youtube.com/playlist?list=PLdifferent','https://www.youtube.com/watch?list=PLfixture']){
    committed=url;assert.equal(await s.youtubePlaylistHeader(win,'PLfixture',0),null);
  }
  assert.equal(reads,0);committed='https://www.youtube.com/playlist?list=PLfixture&hl=en';
  assert.equal((await s.youtubePlaylistHeader(win,'PLfixture',0)).count,493);assert.equal(reads,1);
});

test('identityChecked distinguishes startup restoration from a source-confirmed signed-out account',async()=>{
 const s=new MusicSession();assert.equal(s.status().identityChecked,false);
 s.readPageAt=async()=>({tracks:[],releases:[],identity:{connected:false,name:''}});
 await s.sync();assert.equal(s.status().identityChecked,true);assert.equal(s.status().connected,false);
 const offline=new MusicSession();offline.readPageAt=async()=>{throw Error('offline');};await assert.rejects(offline.sync(),/offline/);
 assert.equal(offline.status().identityChecked,false);
});

test('a confirmed playlist edit cancels a pre-edit reader before it can repopulate stale cache',async t=>{
 const actions=require('../src/main/site-playlist-actions.cjs'),original=actions.playlistAction;t.after(()=>{actions.playlistAction=original});actions.playlistAction=async()=>({ok:true});
 const session=new MusicSession();let destroyed=false;const reader={isDestroyed:()=>destroyed,destroy:()=>{destroyed=true}};session.playlistReader=reader;session.playlistRequest={key:'0/PLedited/default',reader};session.playlistCache.set('old',{});
 await session.playlistAction('remove',{id:'PLedited',videoIds:['abcdefghijk']});assert.equal(session.playlistRequest,null);assert.equal(session.playlistReader,null);assert.equal(destroyed,true);assert.equal(session.playlistCache.size,0);
});

test('reader expiry keeps an in-use search alive then releases its remote renderer',async()=>{
  const s=new MusicSession();let allocations=0,destroyed=0;
  s.window=()=>{allocations++;let closed=false;return {isDestroyed:()=>closed,destroy(){closed=true;destroyed++;}}};
  const reader=s.acquireReader('searchReader','search');s.releaseReader('searchReader',reader,10);
  assert.equal(s.acquireReader('searchReader','search'),reader);
  await new Promise(resolve=>setTimeout(resolve,15));assert.equal(destroyed,0);
  s.releaseReader('searchReader',reader,10);await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(s.searchReader,null);assert.equal(allocations,1);assert.equal(destroyed,1);
});

test('overlapping metadata enrichment opens one source reader at a time and discards old account work',async()=>{
  const s=new MusicSession(),entered=Promise.withResolvers(),hold=Promise.withResolvers(),seen=[];
  const first=s.readMetadata(async()=>{seen.push('first');entered.resolve();await hold.promise;});
  const second=s.readMetadata(()=>seen.push('second'));await entered.promise;assert.deepEqual(seen,['first']);
  s.epoch++;hold.resolve();await first;await assert.rejects(second,/account changed/);
  assert.deepEqual(seen,['first']);
});

test('restored playback requests the timestamp and verifies media before publishing its clock',async()=>{
  const s=new MusicSession(),calls=[],url='https://music.youtube.com/watch?v=abcdefghijk&t=42s';
  s.player={webContents:{getURL:()=>''},loadURL:async href=>calls.push(href)};
  s.run=async(_win,fn,...args)=>{calls.push([fn.name,...args]);return true;};
  await s.play({id:'abcdefghijk'},3,.5,42.8);
  assert.deepEqual(calls,[url,['playerCommand','volume',.5],['playerCommand','play'],['avState'],['restorePosition','abcdefghijk',42.8],['playerCommand','play']]);
  const {restorePosition}=require('../src/main/site-player.cjs');
  const video={duration:40,readyState:2,currentTime:0};let ad=true,actual='abcdefghijk';
  const document={querySelector:()=>({querySelector:()=>video,classList:{contains:()=>ad},getVideoData:()=>({video_id:actual})})};
  const run=()=>vm.runInNewContext('('+restorePosition.toString()+')("abcdefghijk",42.8)',{document});
  assert.equal(run(),false);assert.equal(video.currentTime,0);ad=false;actual='another1234';assert.equal(run(),false);
  actual='abcdefghijk';assert.equal(run(),false);assert.equal(video.currentTime,39.75);assert.equal(run(),true);
});

test('unchanged continuation polls count DOM rows without decoding an entire 1,000-song library',async()=>{
  const s=new MusicSession();let polls=0,fullReads=0;
  const rows=Array.from({length:1000},(_,i)=>({id:String(i)}));
  s.run=async(_win,fn)=>{
    if(fn===readPage){fullReads++;return {tracks:rows,cardCount:rows.length};}
    polls++;return {size:rows.length,pending:polls<4,empty:false,failed:false};
  };
  const data=await s.collect({isDestroyed:()=>false},'tracks',true);
  assert.equal(data.tracks.length,1000);assert.ok(polls>=4);assert.equal(fullReads,2);
});

test('automatic sync reuses only a fresh verified owner snapshot while explicit refresh still visits the source',async()=>{
  const s=new MusicSession();s.profile={connected:true,id:'mine',name:'Account'};s.identityChecked=true;s.restoredOwner='mine';s.data.syncedAt=new Date().toISOString();s.data.playlists=[{id:'my-list'}];
  let requests=0;
  s.readPageAt=async()=>{requests++;throw Error('test network offline');};
  assert.deepEqual((await s.sync({allowCached:true})).playlists,[{id:'my-list'}]);assert.equal(requests,0);
  await assert.rejects(s.sync(),/offline/);assert.equal(requests,1);
  s.restoredOwner='other';await assert.rejects(s.sync({allowCached:true}),/offline/);assert.equal(requests,2);
});

test('general search cards preserve explicit release labels and omit linked artist names',()=>{
  const nav=(pageType,browseId)=>({browseEndpoint:{browseId,browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType}}}});
  const artist={text:'EP',navigationEndpoint:nav('MUSIC_PAGE_TYPE_ARTIST','UCArtist')};
  const item=(i,subtitle)=>({data:{title:{runs:[{text:i===3?'Single':'Title'}]},subtitle,navigationEndpoint:nav('MUSIC_PAGE_TYPE_ALBUM','MPRE'+i)},querySelector:()=>null});
  const cards=[item(0,{runs:[{text:'Single'},artist]}),item(1,{simpleText:'2024 • EP'}),item(2,{runs:[{text:'Album • 2001'}]}),item(3,{runs:[{text:'Single Mothers'},artist]})];
  const document={querySelector:()=>null,querySelectorAll:()=>cards};
  const rows=vm.runInNewContext('('+readPage.toString()+')().albums',{document});
  assert.deepEqual(Array.from(rows,c=>c.releaseType),['single','ep','album',undefined]);
});

test('rapid source seeks coalesce before contacting the stream loader and obsolete work cannot reload a new song',async()=>{
 const s=new MusicSession(),track={id:'abcdefghijk',source:'youtube',title:'Track',artist:'Artist'};
 s.active={id:track.id,generation:1,track};s.desired='play';s.volume=.5;
 const seeks=[];s.run=async(_view,fn,name,value)=>{
  if(fn.name==='playerCommand'){if(name==='seek')seeks.push(value);return true;}
  if(fn.name==='seekReady')return {ready:true};
 };
 await Promise.all([s.command('seek',40),s.command('seek',15),s.command('seek',60)]);
 assert.deepEqual(seeks,[60]);assert.equal(s.seekTarget,null);
 const active=s.active,gate=Promise.withResolvers();s.run=()=>gate.promise;s.seekSerial=10;
 const check=s.monitorSeek(active,10,90);s.active={...active,id:'0123456789a'};
 s.play=()=>assert.fail('Old seek must not reopen a replacement track');gate.resolve({ready:false});await check;
});
test('a stalled source seek retries the same timestamp once, while ads and a paused intent never trigger a reload',async()=>{
 const track={id:'abcdefghijk',source:'youtube',title:'Track',artist:'Artist'},s=new MusicSession();
 s.active={id:track.id,generation:7,track};s.seekSerial=1;s.volume=.4;s.desired='play';s.mode='video';s.run=async()=>({ready:false});
 const reloads=[];s.play=async(...args)=>reloads.push(args);
 await s.monitorSeek(s.active,1,75);
 assert.deepEqual(reloads,[[track,7,.4,75,'video']]);
 s.run=async()=>({ad:true});await s.monitorSeek(s.active,1,80);assert.equal(reloads.length,1);
 s.desired='pause';s.run=async()=>({ready:false});await s.monitorSeek(s.active,1,90);assert.equal(reloads.length,1);
});

test('a prepared document is promoted once with no overlapping audible players',async()=>{
 const s=new MusicSession(),events=[],track={id:'7nxWP9BhI7w'},next={id:'0_M2JX-Olv8'};
 const old={webContents:{setAudioMuted:v=>events.push(['old mute',v])},destroy:()=>events.push(['old close'])};
 const view={setVisible:v=>events.push(['visible',v])};
 const prepared={view,isDestroyed:()=>false,webContents:{setBackgroundThrottling:v=>events.push(['throttle',v]),setAudioMuted:v=>events.push(['new mute',v]),executeJavaScript:async(_code,gesture)=>events.push(['play',gesture]),send:()=>{}},destroy:()=>events.push(['new close'])};
 s.player=old;s.playerView={setVisible(){}};s.active={id:track.id,generation:1,track};s.prepared={owner:s.active,track:next,window:prepared,ready:true};
 s.run=async(win,fn,name)=>{events.push([win===old?'old command':'new command',name]);return true;};
 await s.play(next,2,.5);
 assert.equal(s.player,prepared);assert.equal(s.active.id,next.id);assert.equal(s.active.generation,2);assert.equal(s.prepared,null);
 assert(events.findIndex(e=>e[0]==='old command'&&e[1]==='pause')<events.findIndex(e=>e[0]==='new mute'&&e[1]===false));
 assert.equal(events.filter(e=>e[0]==='old close').length,1);assert(events.some(e=>e[0]==='play'&&e[1]===true));
});
test('native preparation uses no additional document and queue changes destroy obsolete preparation',async()=>{
 const s=new MusicSession(),track={id:'7nxWP9BhI7w'},next={id:'0_M2JX-Olv8'};
 s.active={id:track.id,track};s.nativeNext={active:s.active,id:next.id};let closed=0;
 s.prepared={window:{isDestroyed:()=>false,destroy:()=>closed++}};
 s.window=()=>assert.fail('The first-party queue already prepares this recording');
 await s.prepareNext(next);assert.equal(s.prepared,null);assert.equal(closed,1);
});


test('pausing during a prepared handoff retains pause after promotion',async()=>{
 const s=new MusicSession(),gate=Promise.withResolvers(),started=Promise.withResolvers(),scripts=[];
 const track={id:'7nxWP9BhI7w'},next={id:'0_M2JX-Olv8'};
 const old={webContents:{setAudioMuted(){}},destroy(){}};
 const prepared={view:{setVisible(){}},webContents:{setBackgroundThrottling(){},setAudioMuted(){},executeJavaScript:async script=>scripts.push(script),send(){}},destroy(){}};
 s.player=old;s.active={id:track.id,generation:1,track};s.prepared={owner:s.active,track:next,window:prepared,ready:true};
 let first=true;s.run=async(win,fn,name)=>{if(win===old&&name==='pause'&&first){first=false;started.resolve();await gate.promise;}return true;};
 const playing=s.play(next,2,.5);await started.promise;await s.command('pause');gate.resolve();await playing;
 assert.equal(s.active.id,next.id);assert.equal(s.desired,'pause');assert(scripts[0].endsWith(')(0.5,"pause")'));
 assert(scripts[0].includes('setVolume'));
});

test('source seeks preserve the desired playing or paused state after the scrubber changes',async()=>{
 for(const desired of ['play','pause']){
  const s=new MusicSession(),calls=[];s.active={id:'abcdefghijk',generation:1,clock:{duration:120,position:90}};s.desired=desired;s.player={};
  s.run=async(_view,fn,name)=>{calls.push(name);return true;};s.monitorSeek=async()=>{};
  await s.command('seek',30);assert.deepEqual(calls,['seek',desired]);assert.equal(s.desired,desired);assert.equal(s.active.clock,null);
 }
});

test('a delayed single-song source queue is retried after its initial empty hydration',async t=>{
 const s=new MusicSession(),track={id:'abcdefghijk',source:'youtube',title:'Single',artist:'Artist'},next={...track,id:'lmnopqrstuv',title:'Next'};
 s.active={id:track.id,generation:1,track};s.player={};let reads=0;const done=Promise.withResolvers();
 s.onEvent=event=>{if(event.type==='queue'&&event.tracks.length)done.resolve(event)};
 s.run=async(_win,fn)=>fn.name==='readQueue'?(++reads===1?null:[next]):fn.name==='queueCategories'?[]:{available:false};
 t.after(()=>{clearTimeout(s.queueRetry);s.closed=true});
 await s.updateQueue(track.id,1);const timeout=setTimeout(()=>done.reject(Error('Queue did not rehydrate')),2000);
 try{const event=await done.promise;assert.equal(event.tracks[0].id,next.id);assert.equal(reads,2)}finally{clearTimeout(timeout)}
});

test('a video uses the selected song queue when the service keeps its audio counterpart selected',()=>{
 const {readQueue}=require('../src/main/music-session.cjs'),current='abcdefghijk',audio='lmnopqrstuv',next='zzzzzzzzzzz';
 const rows=[{hasAttribute:()=>true,data:{videoId:audio,title:{simpleText:'Party At My Place'}}},{hasAttribute:()=>false,data:{videoId:next,title:{simpleText:'Next'},shortBylineText:{simpleText:'Artist'},lengthText:{simpleText:'2:00'}}}];
 const player={getVideoData:()=>({video_id:current,title:'Artist - Party At My Place (Official Video)'})};
 const queue={hasAttribute:()=>true,querySelectorAll:()=>rows};const document={querySelector:q=>q==='#movie_player'?player:queue};
 const result=vm.runInNewContext('('+readQueue.toString()+')(id,undefined,title)',{document,id:current,title:'Party At My Place'});
 assert.equal(result.length,1);assert.equal(result[0].id,next);
});


test('selecting a different song verifies and resets zero before publishing playback',async()=>{
 const s=new MusicSession(),calls=[],track={id:'abcdefghijk'};
 s.player={webContents:{getURL:()=> 'https://music.youtube.com/watch?v=lmnopqrstuv',send:(...args)=>calls.push(args)},loadURL:async()=>assert.fail('Reuse the committed route')};
 let checks=0;
 s.run=async(_win,fn,...args)=>{
  calls.push([fn.name,...args]);
  if(fn.name==='restorePosition'){assert.equal(s.awaitingLoad,true);assert.equal(args[1],0);return ++checks>1;}
  return true;
 };
 await s.play(track,2,.4);
 assert.equal(checks,2);assert.equal(s.awaitingLoad,false);
 assert(calls.filter(c=>c[0]==='restorePosition').every(c=>c[2]===0));assert.equal(calls.filter(c=>c[0]==='playerCommand').at(-1)[1],'play');
});

test('source snapshots discard a superseded selection and coalesce concurrent read requests',async()=>{
 const s=new MusicSession(),gate=Promise.withResolvers(),events=[];
 const active={id:'abcdefghijk',generation:1,track:{id:'abcdefghijk'}},player={};s.active=active;s.player=player;s.seq=1;
 let reads=0;s.run=async()=>{reads++;return gate.promise;};s.receivePlayback=data=>events.push(data);
 const task=s.observePlayback();void s.observePlayback();void s.observePlayback();assert.equal(reads,1);
 s.active={id:'lmnopqrstuv',generation:2};s.seq=2;gate.resolve({id:active.id,state:'playing',position:90,duration:120});await task;
 assert.deepEqual(events,[]);assert.equal(reads,1);
 s.run=async()=>({id:s.active.id,state:'playing',position:0,duration:180});await s.observePlayback();assert.equal(events[0].id,s.active.id);
});

test('natural track changes refresh movie labels from the matching recording',()=>{
 const s=new MusicSession(),messages=[],events=[],id='abcdefghijk',next='lmnopqrstuv';
 s.active={id,generation:3,started:true,track:{id,title:'Old title',artist:'Old artist'}};s.cinema=true;s.mode='video';
 s.player={webContents:{getURL:()=> 'https://music.youtube.com/watch?v='+next,send:(...args)=>messages.push(args)}};
 s.onEvent=e=>events.push(e);s.run=async()=>true;s.updateQueue=async()=>{};s.playbackSettings=async()=>{};
 s.receivePlayback({id:next,mediaId:next,state:'playing',position:.2,duration:140,title:'New title',artist:'New artist'});
 const config=messages.find(c=>c[0]==='music:cinema')[1];assert.equal(config.track.title,'New title');assert.equal(config.track.artist,'New artist');
 assert.equal(events.find(e=>e.type==='track').track.title,'New title');assert.equal(events.find(e=>e.type==='progress').position,.2);
});


test('switching to the video counterpart preserves canonical song and artist labels',()=>{
 const s=new MusicSession(),messages=[],id='abcdefghijk',next='lmnopqrstuv';
 s.active={id,generation:3,started:true,track:{id,title:'Yale',artist:'Ken Carson'}};s.cinema=true;s.mode='video';s.switchingCounterpart={generation:3,until:Date.now()+1000};
 s.player={webContents:{getURL:()=> 'https://music.youtube.com/watch?v='+next,send:(...args)=>messages.push(args)}};
 s.run=async()=>true;s.updateQueue=async()=>{};s.playbackSettings=async()=>{};
 s.receivePlayback({id:next,mediaId:next,state:'playing',position:.2,duration:140,title:'Ken Carson - Yale (Official Music Video)',artist:'Video channel'});
 const config=messages.find(c=>c[0]==='music:cinema')[1];assert.equal(config.track.id,next);assert.equal(config.track.title,'Yale');assert.equal(config.track.artist,'Ken Carson');
});


test('a clock captured during navigation cannot publish after the zero reset completes',async()=>{
 const s=new MusicSession(),gate=Promise.withResolvers(),events=[];s.player={};s.active={id:'abcdefghijk'};s.seq=1;s.awaitingLoad=true;
 s.run=()=>gate.promise;s.receivePlayback=data=>events.push(data);
 const task=s.observePlayback();s.awaitingLoad=false;gate.resolve({id:s.active.id,state:'playing',position:95,duration:180});await task;assert.deepEqual(events,[]);
 s.run=async()=>({id:s.active.id,state:'playing',position:0,duration:180});await s.observePlayback();assert.equal(events[0].position,0);
});


test('a decoded seek restores play after the provider pauses its range loader',async()=>{
 for(const desired of ['play','pause']){
  const s=new MusicSession(),commands=[];s.active={id:'abcdefghijk'};s.player={};s.seekSerial=1;s.desired=desired;
  s.run=async(_win,fn,name)=>{if(fn.name==='seekReady')return {ready:true};commands.push(name);return true;};
  await s.monitorSeek(s.active,1,30);assert.deepEqual(commands,desired==='play'?['play']:[]);assert.equal(s.seekTarget,null);
 }
});


test('unavailable video requests keep the current song without searching or navigating',async()=>{
 const s=new MusicSession();s.active={id:'abcdefghijk',generation:1};s.player={};s.mode='song';s.run=async()=>({available:false,hasToggle:false,selected:'song'});s.resolveVideo=()=>assert.fail('Unavailable mode must not perform a search');
 assert.deepEqual(await s.setPlaybackMode('video'),{mode:'song',videoAvailable:false});
});
test('a stalled near-end seek retries the same song instead of accepting a premature end',async()=>{
 const events=[],s=new MusicSession();s.active={id:'abcdefghijk',generation:1,track:{duration:212},seekDuration:212};s.player={};s.seekSerial=1;s.seekTarget={active:s.active,target:208};s.desired='play';s.onEvent=e=>events.push(e);s.run=async()=>({ready:false});const retries=[];s.play=(...args)=>retries.push(args);
 s.receivePlayback({id:s.active.id,state:'ended',position:212,duration:212});
 s.receivePlayback({id:'lmnopqrstuv',title:'Wrong next song',state:'playing',position:0,duration:200});
 assert.equal(events.length,0);await s.monitorSeek(s.active,1,208);assert.equal(retries.length,1);assert.equal(retries[0][3],208);
});


function modeFixture({position=2,duration=209,paused=false}={}){
 const events=[],calls=[],s=new MusicSession({onEvent:e=>events.push(e)});
 const audio={id:'abcdefghijk',title:'São Paulo',artist:'The Weeknd',duration:302};
 s.active={id:audio.id,generation:3,track:audio,clock:{position,duration:302},started:true};s.player={webContents:{send(){}}};s.mode='song';s.desired=paused?'pause':'play';
 s.updateQueue=async()=>{};s.hideOfficial=()=>{};s.seq=5;let switching=false,polls=0;
 s.run=async(_win,fn,...args)=>{
  calls.push([fn.name,...args]);
  if(fn.name==='avState'){
   if(args[0]){switching=true;return true;}
   if(!switching)return {available:true,hasToggle:true,selected:'song',decoded:'song',recording:audio.id,position,duration:302,ready:true};
   polls++;
   // Empty metadata and stale audio must never qualify as the selected video.
   if(polls===1)return {available:true,selected:'video',decoded:null,ready:false};
   if(polls===2)return {available:true,selected:'video',decoded:'song',ready:true,recording:audio.id};
   return {available:true,hasToggle:true,selected:'video',decoded:'video',ready:true,recording:'lmnopqrstuv',title:'São Paulo',duration,position:82};
  }
  if(fn.name==='restorePosition'){
   // Late outgoing progress/end/auto-next must not reach the ordered queue.
   s.receivePlayback({id:audio.id,state:'ended',position:302,duration:302});
   s.receivePlayback({id:'othertrack1',title:'Wrong song',state:'playing',position:0,duration:200});
   return true;
  }
  return true;
 };
 return {s,events,calls,polls:()=>polls};
}
test('mode switch waits through empty metadata and restores the source timestamp instead of a provider resume',async()=>{
 const f=modeFixture();const result=await f.s.setPlaybackMode('video');assert.equal(result.mode,'video');assert.equal(f.polls(),3);
 assert.deepEqual(f.calls.find(c=>c[0]==='restorePosition'),['restorePosition','lmnopqrstuv',2]);
 assert.equal(f.s.active.id,'lmnopqrstuv');assert.equal(f.s.active.track.title,'São Paulo');
 assert.equal(f.events.some(e=>e.type==='ended'),false);assert.equal(f.events.filter(e=>e.type==='track').length,1);
 assert.equal(f.events.find(e=>e.type==='track').counterpart,true);assert.equal(f.events.find(e=>e.type==='progress').position,2);
});
test('a delayed source layout read cannot replace the timestamp captured at the switch gesture',async()=>{
 const f=modeFixture(),run=f.s.run;
 f.s.run=async(...args)=>{const result=await run(...args);return args[1].name==='avState'&&!args[2]&&result.decoded==='song'?{...result,position:82}:result;};
 await f.s.setPlaybackMode('video');assert.deepEqual(f.calls.find(c=>c[0]==='restorePosition'),['restorePosition','lmnopqrstuv',2]);
});
test('a mode switch cancels unfinished startup and releases its loading gate',async()=>{
 const f=modeFixture();f.s.awaitingLoad=true;f.s.playIntent=10;
 await f.s.setPlaybackMode('video');assert.equal(f.s.seq,6);assert.equal(f.s.playIntent,11);assert.equal(f.s.awaitingLoad,false);
 f.s.receivePlayback({id:'lmnopqrstuv',state:'playing',position:2.1,duration:209});
 assert.equal(f.events.at(-2).type,'state');assert.equal(f.events.at(-2).state,'playing');
});
test('switching beyond the shorter counterpart restarts the same song without advancing the queue',async()=>{
 const f=modeFixture({position:251,duration:190});await f.s.setPlaybackMode('video');
 assert.deepEqual(f.calls.find(c=>c[0]==='restorePosition'),['restorePosition','lmnopqrstuv',0]);
 assert.equal(f.events.some(e=>e.type==='ended'),false);assert.equal(f.s.active.id,'lmnopqrstuv');
});
test('paused counterpart switches stay paused and superseded switches cannot publish a new track',async()=>{
 const f=modeFixture({paused:true});await f.s.setPlaybackMode('video');
 assert.deepEqual(f.calls.filter(c=>c[0]==='playerCommand').at(-1),['playerCommand','pause']);
 const g=modeFixture(),run=g.s.run;g.s.run=async(...args)=>{const result=await run(...args);if(args[1].name==='restorePosition')g.s.seq++;return result;};
 await assert.rejects(g.s.setPlaybackMode('video'),/selected song changed/);assert.equal(g.events.some(e=>e.type==='track'),false);
});

test('duplicate video discovery shares a single source lookup',async()=>{
 const s=new MusicSession(),gate=Promise.withResolvers();let reads=0;s.search=()=>{reads++;return gate.promise};const track={id:'abcdefghijk',title:'Track',artist:'Artist'};
 const a=s.resolveVideo(track),b=s.resolveVideo(track);assert.equal(reads,1);gate.resolve([]);assert.equal(await a,null);assert.equal(await b,null);await s.resolveVideo(track);assert.equal(reads,1);
});
test('a recovery preparation request never opens another streaming document',()=>{
 const s=new MusicSession();s.active={id:'abcdefghijk'};s.window=()=>assert.fail('Do not allocate another decoder');s.prepareNext({id:'lmnopqrstuv'});assert.equal(s.prepared,null);
});
test('unresponsive background readers are closed without terminating playback',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const s=new MusicSession();let closed=false;const win={isDestroyed:()=>closed,destroy:()=>closed=true,webContents:{getURL:()=> 'https://music.youtube.com/',executeJavaScript:()=>new Promise(()=>{})}};
 s.player={};const task=s.run(win,()=>true);t.mock.timers.tick(5000);await assert.rejects(task,/stopped responding/);assert.equal(closed,true);assert.ok(s.player);
});


test('song playback clears a persisted native Video preference without changing recordings',async()=>{
 const s=new MusicSession(),calls=[];s.active={id:'abcdefghijk',track:{id:'abcdefghijk'}};s.player={};s.mode='song';s.run=async(_win,fn,mode)=>{calls.push(mode);return mode?true:{hasToggle:true,selected:'video'}};
 assert.equal(await s.ensureAudioMode(),true);assert.deepEqual(calls,[undefined,'song']);assert.equal(await s.ensureAudioMode(),true);assert.equal(calls.filter(value=>value==='song').length,1);s.mode='video';calls.length=0;assert.equal(await s.ensureAudioMode(),false);assert.deepEqual(calls,[]);
});


test('an expired playing stream retries the same recording once without advancing its queue',()=>{
 const s=new MusicSession(),track={id:'abcdefghijk'},retries=[],events=[];s.active={id:track.id,generation:3,track,started:true,clock:{position:208,duration:212}};s.desired='play';s.volume=.4;s.mode='video';s.seekTarget={active:s.active,target:208};s.play=async(...args)=>retries.push(args);s.onEvent=e=>events.push(e);
 const error={id:track.id,state:'error',message:'Stream expired'};s.receivePlayback(error);s.receivePlayback(error);
 assert.deepEqual(retries,[[track,3,.4,208,'video']]);assert.equal(events.filter(e=>e.type==='error').length,1);assert.equal(events.some(e=>e.type==='ended'),false);
});

test('movie-mode skips reset the incoming audio before using the atomic video handoff',async()=>{
 const s=new MusicSession(),calls=[];s.player={loadURL:async()=>{},webContents:{send(){},getURL:()=>''}};s.volume=.5;s.videoIntent=true;
 s.run=async(_win,fn,...args)=>{calls.push([fn.name,...args]);return fn.name==='restorePosition'?true:fn.name==='avState'?{available:true}:true;};
 s.setPlaybackMode=async mode=>{assert.equal(s.awaitingLoad,false);assert(calls.some(c=>c[0]==='restorePosition'&&c[2]===0));calls.push(['switch',mode]);return {mode};};
 await s.play({id:'abcdefghijk',title:'Incoming song',mediaType:'song'},4,.5);
 assert.equal(calls.filter(c=>c[0]==='switch').length,1);assert.deepEqual(calls.find(c=>c[0]==='switch'),['switch','video']);
});

test('closing an already-audio player does not pause, seek, or cancel incoming playback',async()=>{
 const s=new MusicSession();s.mode='song';s.active={id:'abcdefghijk',generation:1};s.awaitingLoad=true;s.seq=7;s.desired='play';s.videoAvailable=true;
 s.run=()=>assert.fail('An unchanged mode must not touch the decoder');
 assert.deepEqual(await s.setPlaybackMode('song'),{mode:'song',videoAvailable:true});assert.equal(s.seq,7);assert.equal(s.awaitingLoad,true);assert.equal(s.desired,'play');
});

test('ordered app queues read only the native handoff head instead of copying a whole playlist on every mutation',async()=>{
 const s=new MusicSession({queueOwnedByApp:()=>true});s.active={id:'abcdefghijk',generation:1,track:{id:'abcdefghijk'}};s.player={};let limit;
 s.run=async(_win,fn,...args)=>{if(fn.name==='readQueue'){limit=args[3];return [{id:'lmnopqrstuv',source:'youtube',title:'Next',artist:'Artist'}];}return fn.name==='queueCategories'?[]:{available:true};};
 await s.updateQueue('abcdefghijk',1);assert.equal(limit,2);assert.equal(s.nativeNext.id,'lmnopqrstuv');
});
test('a queued movie remembers its own incoming audio counterpart',async()=>{
 const f=modeFixture();f.s.mode='video';await f.s.setPlaybackMode('video',true);assert.equal(f.s.audioCounterpart.track.id,'abcdefghijk');
});

