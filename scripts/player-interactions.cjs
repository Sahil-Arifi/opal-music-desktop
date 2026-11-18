const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright-core'),{createServer}=require('../src/main/server.cjs');
function fixture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=16;const ctx=canvas.getContext('2d');ctx.fillStyle='#a14f43';ctx.fillRect(0,0,16,16);
 const track={playlistId:'PLfixture',album:'A long album title that should wrap inside the menu',albumId:'MPREfixture',id:'abcdefghijk',source:'youtube',title:'Recent song',artist:'Fixture artist',artwork:canvas.toDataURL(),duration:120};
 let state={current:track,playing:false,position:12,duration:120,volume:.5,queue:[],library:[],loading:false,error:'',effects:'full'},sink;
 const tracks=Array.from({length:15},(_,i)=>({...track,id:'song-'+i,title:'Top song '+(i+1)}));
 const home={account:{connected:true,configured:true,name:'Fixture'},recent:[track],recentItems:[{...track,kind:'song'}],recentArtists:[{id:'UCfixture',title:'Fixture artist',artwork:track.artwork}],liked:[],playlists:[],discover:[],releases:[]};
 const subscribe=()=>()=>{};window.calls=[];
 window.music={getState:async()=>state,getHome:async()=>home,getMode:async()=>'full',onState:fn=>{sink=fn;return()=>{}},onHome:subscribe,onMode:subscribe,onEnergy:subscribe,onEngine:subscribe,discovery:async()=>[],recentSearches:async()=>[],setVideoBounds:async()=>{},setPlaybackMode:async()=>{},
 command:async(name,value)=>{window.calls.push({name,value});if(name==='toggle')state={...state,playing:!state.playing};if(name==='seek')state={...state,position:value};sink(state)},
 playSequence:async(tracks,index)=>{window.calls.push({name:'sequence',tracks,index});state={...state,current:tracks[index],queue:tracks.slice(index+1),playing:true};sink(state)},
 catalog:async(kind,ref)=>({kind,id:ref.id,title:'Fixture artist',tracks:tracks.slice(0,5),albums:[],singles:[],artists:[],playlists:[]}),
 artistTopSongs:async()=>tracks,
 stats:async period=>({period,totals:{plays:4,seconds:360,songs:1,artists:1,albums:1},artists:[{id:'artist',name:'Fixture artist',plays:4,seconds:360,listeningSeconds:600,estimatedSeconds:240}],albums:[{id:'album',name:'Fixture album',plays:4,seconds:360,listeningSeconds:600,estimatedSeconds:240}],songs:[{...track,plays:4,seconds:360}],coverage:{accountEntries:200,scope:'Available history for the past month.',untimedPlays:0}}),
 };
}
(async()=>{
 const server=await createServer({rendererDir:path.resolve(__dirname,'../dist/renderer')});let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1220,height:820}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(fixture);await page.goto(server.origin);
  const recent=page.locator('#home-recent-music .history-card').first();await recent.click();
  assert.equal(await page.locator('.expanded-player').count(),0);assert.equal(await recent.locator('.playback-art.playing').count(),1);
  await recent.hover();assert.equal(await recent.locator('.artwork-action').evaluate(el=>getComputedStyle(el).visibility),'visible');
  await page.mouse.move(1200,10);assert.equal(await recent.locator('.artwork-eq').evaluate(el=>getComputedStyle(el).visibility),'visible');
  await recent.click();assert.equal(await recent.locator('.artwork-eq i').first().evaluate(el=>getComputedStyle(el).animationName),'none');
  await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();
  await page.locator('.immersive-stage').waitFor();assert.equal(await page.locator('.expanded-player .player-window-tools button').count(),1);
  await page.getByRole('button',{name:'Exit immersive player'}).click();await page.getByRole('button',{name:'Collapse player'}).click();
  await page.locator('#home-recent-artists .history-card').first().click();await page.locator('.catalog-tracks li').nth(4).waitFor();
  assert.equal(await page.locator('.catalog-tracks li').count(),5);
  await page.getByRole('button',{name:'Show more top songs',exact:true}).click();await page.locator('.catalog-tracks li').nth(14).waitFor();
  await page.locator('.catalog-tracks li').nth(1).locator('.track-main').click();
  const sequence=await page.evaluate(()=>window.calls.find(call=>call.name==='sequence'));assert.equal(sequence.index,1);assert.equal(sequence.tracks.length,15);
  await page.getByRole('button',{name:'Stats',exact:true}).click();await page.locator('.stats-columns').waitFor();
  assert.equal(await page.locator('.stats-columns .rank-count').first().innerText(),'≈ 10 min');
  assert.equal(await page.locator('.stats-songs .rank-count').innerText(),'4 plays');
  assert.equal(await page.getByText(/YouTube Music supplied|Available history|entries/).count(),0);
  await page.getByRole('button',{name:'Past week',exact:true}).click();await page.getByRole('button',{name:'Past week',exact:true}).getAttribute('aria-pressed').then(value=>assert.equal(value,'true'));
  await page.goto(server.origin);
  await page.locator('.dock').getByRole('button',{name:'Next track',exact:true}).click();await page.keyboard.press('Space');
  assert.deepEqual(await page.evaluate(()=>window.calls.slice(-2).map(call=>call.name)),['next','toggle']);
  await page.keyboard.press('Space');assert.equal((await page.evaluate(()=>window.music.getState())).playing,false);
  for(const [width,height] of [[1220,820],[800,590]]){
    await page.setViewportSize({width,height});await page.getByRole('button',{name:'Open now playing',exact:true}).click();
    await page.locator('.player-info').getByRole('button',{name:'More options for Recent song',exact:true}).click();
    const menu=page.getByRole('menu'),rect=await menu.boundingBox();assert(rect.y>=0&&rect.y+rect.height<=height+1);
    assert(await menu.evaluate(el=>el.scrollHeight>=el.clientHeight));
    await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'detached'});
    const controls=await page.locator('.player-primary .btn').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}));
    for(let i=1;i<controls.length;i++)assert(controls[i].left>=controls[i-1].right,'Transport controls should not overlap');
    assert(controls.every(control=>control.width>=30));
    const alignment=await page.locator('.player-playback').evaluate(el=>{const row=el.getBoundingClientRect(),play=el.querySelector('.player-main-play').getBoundingClientRect();return Math.abs(row.x+row.width/2-play.x-play.width/2)});await page.screenshot({path:'/tmp/music-controls-'+width+'.png'});assert(alignment<1.5,'The play button should stay centered: '+alignment+'px at '+width);
    const targets=await page.locator('.player-playback button').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0).map(r=>({x:r.x,y:r.y,right:r.right,bottom:r.bottom})));
    for(let i=0;i<targets.length;i++)for(let j=i+1;j<targets.length;j++){const a=targets[i],b=targets[j];assert(a.right<=b.x+1||b.right<=a.x+1||a.bottom<=b.y+1||b.bottom<=a.y+1,'Playback hit targets overlap');}
    await page.screenshot({path:'/tmp/music-controls-'+width+'.png'});
    await page.getByRole('button',{name:'Collapse player',exact:true}).click();await page.locator('.expanded-player').waitFor({state:'detached'});
  }
  assert.deepEqual(errors,[]);console.log('Verified dock-only recent playback, hover/EQ/pause, immersive shortcut, 15 artist top songs, ordered playback and minutes/plays stats.');
 }finally{await browser?.close();await server.close()}
})().catch(error=>{console.error(error);process.exitCode=1});

