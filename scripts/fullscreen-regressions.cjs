// UI fixtures in a disposable browser; never touches the retained account.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright-core'),{createServer}=require('../src/main/server.cjs'),{frameVideo}=require('../src/main/site-player.cjs');
function fixture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=24;canvas.getContext('2d').fillRect(0,0,24,24);
 const track={id:'abcdefghijk',source:'youtube',title:'A long song title that should fit the player without hiding any controls',artist:'Fixture artist',artwork:canvas.toDataURL(),duration:180};
 let state={current:track,position:32,duration:180,playing:true,loading:false,volume:.4,queue:[],library:[],effects:'full'},sink;
 const subscribe=()=>()=>{};window.music={getState:async()=>state,getHome:async()=>({account:{connected:true,configured:true},playlists:[],liked:[],recent:[],discover:[],releases:[]}),getMode:async()=>'full',onState:fn=>(sink=fn,subscribe()),onHome:subscribe,onMode:subscribe,onEngine:subscribe,onEnergy:subscribe,recentSearches:async()=>[],discovery:async()=>[],setVideoBounds:async()=>{},setPlaybackMode:async()=>{},
 command:async(name,value)=>{if(name==='pause')state={...state,playing:false};if(name==='play')state={...state,playing:true};if(name==='toggle')state={...state,playing:!state.playing};if(name==='seek')state={...state,position:value};sink({...state})}};
}
(async()=>{const server=await createServer({rendererDir:path.resolve(__dirname,'../dist/renderer')}),browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1220,height:820}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(fixture);await page.goto(server.origin);
 for(const [width,height] of [[1440,900],[1220,820],[1000,600],[800,590],[760,540],[620,800],[1500,500]]){
  await page.setViewportSize({width,height});await page.getByRole('button',{name:'Enter immersive player',exact:true}).first().click();await page.locator('.immersive-stage').waitFor();await page.waitForFunction(()=>Math.abs(document.querySelector('.immersive-stage').getBoundingClientRect().top)<1);
  const boxes=await page.locator('.immersive-stage .player-sleeve,.immersive-stage .player-info,.immersive-stage .player-progress,.immersive-stage .player-playback,.immersive-stage .player-volume').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {className:n.className,x:r.x,y:r.y,right:r.right,bottom:r.bottom}}));
  for(const box of boxes)assert(box.x>=-1&&box.y>=-1&&box.right<=width+1&&box.bottom<=height+1,'Fullscreen content clips: '+JSON.stringify({width,height,box}));
  assert.equal(await page.locator('.immersive-stage').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  await page.getByRole('button',{name:'Exit immersive player',exact:true}).click();await page.locator('.expanded-player:not(.immersive-stage)').waitFor();
  assert.equal(await page.locator('.controls-resting').count(),0);await page.getByRole('button',{name:'Collapse player',exact:true}).click();await page.locator('.expanded-player').waitFor({state:'detached'});
 }
 await page.setViewportSize({width:1220,height:820});await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('.immersive-stage').getBoundingClientRect().top)<1);
 const sleeve=await page.locator('.player-sleeve').boundingBox();await page.mouse.move(sleeve.x+sleeve.width/2,sleeve.y+sleeve.height/2);await page.locator('.controls-resting').waitFor({timeout:5000});
 await page.mouse.move(sleeve.x+sleeve.width/2+3,sleeve.y+sleeve.height/2);await page.waitForFunction(()=>!document.querySelector('.controls-resting'));
 await page.getByRole('button',{name:'Pause track',exact:true}).hover();await page.waitForTimeout(2800);assert.equal(await page.locator('.controls-resting').count(),0,'Hover holds controls');
 const seek=page.getByRole('slider',{name:'Seek',exact:true}),r=await seek.boundingBox();await page.mouse.move(r.x+r.width*.5,r.y+r.height/2);await page.mouse.down();await page.mouse.move(sleeve.x+20,sleeve.y+20);await page.waitForTimeout(2800);assert.equal(await page.locator('.controls-resting').count(),0,'Drag holds controls');await page.mouse.up();
 await page.getByRole('button',{name:/More options for/}).first().click();await page.waitForTimeout(2800);assert.equal(await page.locator('.controls-resting').count(),0,'Menu holds controls');await page.keyboard.press('Escape');await page.getByRole('menu').waitFor({state:'detached'});assert.equal(await page.locator('.immersive-stage').count(),1);
 await page.evaluate(()=>window.music.command('pause'));await page.mouse.move(sleeve.x+20,sleeve.y+20);await page.waitForTimeout(2800);assert.equal(await page.locator('.controls-resting').count(),0,'Paused controls stay visible');
 await page.keyboard.press('Tab');await page.waitForTimeout(2800);assert.equal(await page.locator('.controls-resting').count(),0,'Keyboard controls stay visible');
 await page.keyboard.press('Escape');assert.equal(await page.locator('.immersive-stage').count(),0);await page.getByRole('button',{name:'Collapse player',exact:true}).click();await page.locator('.expanded-player').waitFor({state:'detached'});
 for(let i=0;i<8;i++){await page.getByRole('button',{name:'Enter immersive player',exact:true}).click();await page.getByRole('button',{name:'Exit immersive player',exact:true}).click();await page.getByRole('button',{name:'Collapse player',exact:true}).click();await page.locator('.expanded-player').waitFor({state:'detached'});}
 assert.deepEqual(errors,[]);console.log('Song fullscreen: seven viewport sizes, repeated entry/exit, idle reveal, hover, drag, menus, pause and keyboard focus passed.');
 const source=await browser.newPage({viewport:{width:1220,height:820}});
 await source.route('https://music.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<html><head></head><body><div id="movie_player"><div class="html5-video-container"><video class="html5-main-video"></video></div></div></body></html>'}));
 await source.goto('https://music.youtube.com/watch?v=abcdefghijk');
 await source.evaluate(()=>{
  window.callbacks={};window.calls=[];window.defaultToggles=0;window.testPaused=false;window.testTime=30;
  window.process={isMainFrame:true};window.require=()=>({ipcRenderer:{on:(name,fn)=>callbacks[name]=fn,send:(name,payload)=>{calls.push(payload);if(payload.kind==='desktop-command'&&payload.name==='seek')testTime=payload.value;}}});
  const p=document.querySelector('#movie_player'),v=p.querySelector('video');
  p.getVideoData=()=>({video_id:'abcdefghijk',title:'Fixture'});p.getPlayerResponse=()=>({videoDetails:{videoId:'abcdefghijk',lengthSeconds:180}});
  Object.defineProperties(v,{paused:{get:()=>testPaused},readyState:{get:()=>4},duration:{get:()=>180},currentTime:{get:()=>testTime,set:n=>testTime=n}});
  p.addEventListener('click',()=>{defaultToggles++;testPaused=!testPaused;});
 });
 await source.evaluate(fs.readFileSync(path.resolve(__dirname,'../src/main/session-preload.cjs'),'utf8'));await source.evaluate('('+frameVideo.toString()+')(true)');
 await source.evaluate(()=>callbacks['music:cinema'](null,{enabled:true,track:{title:'Video fixture',artist:'Artist'},volume:.4}));
 const movieSeek=source.getByRole('slider',{name:'Seek',exact:true});await movieSeek.click({position:{x:300,y:10}});assert.equal(await source.evaluate(()=>testPaused),false);assert.equal(await source.evaluate(()=>defaultToggles),0);assert(await source.evaluate(()=>calls.some(c=>c.kind==='desktop-command'&&c.name==='seek')));
 await source.mouse.move(200,100);await source.waitForFunction(()=>document.querySelector('#desktop-cinema').classList.contains('resting'),{},{timeout:5000});await source.mouse.move(204,100);await source.waitForFunction(()=>!document.querySelector('#desktop-cinema').classList.contains('resting'));
 await source.getByRole('button',{name:'Pause',exact:true}).hover();await source.waitForTimeout(2800);assert.equal(await source.locator('#desktop-cinema.resting').count(),0);
 await source.evaluate(()=>{testPaused=true;document.querySelector('video').dispatchEvent(new Event('pause',{bubbles:true}))});await movieSeek.click({position:{x:400,y:10}});assert.equal(await source.evaluate(()=>testPaused),true);
 for(const [width,height] of [[800,590],[1440,900],[620,800]]){await source.setViewportSize({width,height});const r=await source.locator('video').boundingBox();assert.equal(r.width,width);assert.equal(r.height,height);assert.equal(r.x,0);assert.equal(r.y,0);}
 await source.evaluate(()=>callbacks['music:cinema'](null,{enabled:false}));assert.equal(await source.locator('#desktop-cinema').count(),0);assert.equal(await source.locator('html[data-cinema-resting]').count(),0);
 console.log('Movie fullscreen: seek clicks do not toggle playback, paused seeks remain paused, controls reveal/pin, viewport centers and teardown passed.');
}finally{await browser.close();await server.close()}})().catch(e=>{console.error(e);process.exitCode=1});

