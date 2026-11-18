const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(path.resolve('node_modules/playwright-core')),{createServer}=require(path.resolve('src/main/server.cjs'));
const dir=path.resolve(__dirname,'../dist/renderer'),variant='bounded';
function fixture(){
 const tracks=Array.from({length:675},(_,i)=>({id:i<2?'dupe':'song-'+i,title:'Track '+String(i).padStart(3,'0'),artist:'Fixture group '+i%5,duration:178+i%64,source:'youtube'}));
 const pl={id:'LM',title:'Liked Songs'};
 const home={account:{configured:true,connected:true,name:'Clock fixture'},recent:[],recentItems:[],recentArtists:[],releases:[],discover:[],liked:[],playlists:[pl]};
 const state={current:tracks[0],position:0,duration:5000,playing:true,volume:.5,effects:'full',queue:[],library:[]};
 let progress,playlists=[],second=0;
 const stub=()=>()=>{};
 window.music={getState:async()=>state,getHome:async()=>home,getMode:async()=>'full',onMode:stub,onState:stub,onHome:stub,onEnergy:stub,onEngine:stub,
 onProgress:fn=>(progress=fn,()=>{}),onPlaylistUpdate:fn=>{playlists.push(fn);return()=>playlists=playlists.filter(v=>v!==fn)},
 discovery:async()=>[],recentSearches:async()=>[],getPlaylist:async(id,sort)=>sort==='newest'?[...tracks].reverse():tracks,playlistDetails:async()=>pl,setVideoBounds:async()=>{},
 playPlaylist:async(id,ids,index,rows)=>{window.lastPlay={id,ids,index,track:rows[index]}},
 orderPlaylist:async(id,ids,rows)=>{window.lastOrder={id,ids,titles:rows?.map(i=>i.title)}},
 };
 window.tick=()=>{progress({id:tracks[0].id,position:++second,duration:5000})};
 window.updatePlaylist=()=>{tracks.push({...tracks[2],id:'extra',title:'Extra item'});playlists.forEach(cb=>cb({id:pl.id,sort:'default',tracks:[...tracks],complete:true}))};
 const longest=[];
 new PerformanceObserver(list=>longest.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:true});
 window.getLong=()=>longest.slice();window.resetLong=()=>{longest.length=0};
}
(async()=>{
 const server=await createServer({rendererDir:dir}),browser=await chromium.launch({channel:'chrome',headless:true});
 try{
 const p=await browser.newPage({viewport:{width:1220,height:820}});p.on('pageerror',e=>console.error(e));await p.addInitScript(fixture);await p.goto(server.origin);await p.getByRole('button',{name:'Liked Songs',exact:true}).first().click();
 const rows=p.locator('.ordered-tracks li');await p.waitForFunction(()=>document.querySelectorAll('.ordered-tracks li').length>=40&&document.querySelectorAll('.ordered-tracks li').length<=80);await p.waitForTimeout(1500);
 const session=await p.context().newCDPSession(p);await session.send('Performance.enable');const metrics=async()=>Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));const before=await metrics();
 const latency=await p.evaluate(async()=>{resetLong();const ms=[];for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,420));const start=performance.now();tick();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));ms.push(performance.now()-start)}return ms});
 const after=await metrics(),long=await p.evaluate(()=>getLong());
 console.log(variant,JSON.stringify({rows:await rows.count(),ticks:12,interval:'420ms + two animation frames',msToSecondFrame:latency.map(Math.round),mainTaskMs:Math.round((after.TaskDuration-before.TaskDuration)*1000),scriptMs:Math.round((after.ScriptDuration-before.ScriptDuration)*1000),longTasks:long}));
 if(variant!=='before'){
   const filter=p.getByRole('searchbox',{name:'Search playlist'});
   await filter.fill('Track 674');assert.equal(await rows.count(),1);await rows.first().locator('.track-main').click();assert.equal((await p.evaluate(()=>lastPlay)).index,674);
   await filter.fill('');await p.waitForFunction(()=>document.querySelectorAll('.ordered-tracks li').length>=40&&document.querySelectorAll('.ordered-tracks li').length<=80);
   await p.getByRole('button',{name:'Move Track 001',exact:true}).press('ArrowUp');await p.waitForFunction(()=>!!window.lastOrder);
   assert.deepEqual(await p.evaluate(()=>lastOrder.titles.slice(0,3)),['Track 001','Track 000','Track 002']); // Preserve the two distinct displayed occurrences sharing one video ID.
   assert.deepEqual(await rows.locator('.track-main strong').allTextContents().then(t=>t.slice(0,3)),['Track 001','Track 000','Track 002']);
   await rows.first().locator('.track-main').click();assert.equal((await p.evaluate(()=>lastPlay)).track.title,'Track 001');
   const sort=p.getByRole('combobox',{name:'Sort tracks'});await sort.click();await p.getByRole('option',{name:'Recently added'}).click();
   await rows.first().locator('.track-main').click();assert.equal((await p.evaluate(()=>lastPlay)).track.title,'Track 674');
   await sort.click();await p.getByRole('option',{name:'Custom order'}).click();
   await p.evaluate(()=>updatePlaylist());await filter.fill('Extra item');await p.waitForFunction(()=>document.querySelectorAll('.ordered-tracks li').length===1);await rows.last().locator('.track-main').click();assert.equal((await p.evaluate(()=>lastPlay)).track.id,'extra');
   await filter.fill('');await rows.nth(3).waitFor();assert.equal((await p.evaluate(()=>lastOrder.ids)).length,675);
   const grip=p.getByRole('button',{name:'Move Track 002',exact:true});await grip.scrollIntoViewIfNeeded();await p.waitForTimeout(350);
   const from=await grip.boundingBox(),target=await p.getByRole('button',{name:'Move Track 003',exact:true}).boundingBox();
   const x=from.x+from.width/2,y=from.y+from.height/2,last=target.y+target.height*.8;
   await p.mouse.move(x,y);await p.mouse.down();
   for(let i=1;i<=12;i++){await p.mouse.move(x,y+(last-y)*i/12);await p.waitForTimeout(25)}
   await p.mouse.up();await p.waitForFunction(()=>window.lastOrder?.titles.indexOf('Track 002')>window.lastOrder?.titles.indexOf('Track 003'));
   await p.getByRole('button',{name:'Home',exact:true}).click();await p.getByRole('heading',{name:'Home',exact:true}).waitFor();assert.equal(await rows.count(),0);
   await p.getByRole('button',{name:'Liked Songs',exact:true}).first().click();await rows.first().waitFor();
   console.log('PASS bounded row mounting, full-length reorder preservation, pointer drag persisted, page exit+return, complete-playlist update, contextual search, source/newest and custom order, keyboard move including duplicate IDs and playback snapshot');
 }
 }finally{await browser.close();await server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});

