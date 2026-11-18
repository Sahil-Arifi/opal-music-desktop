// Compare built renderers in disposable Electron profiles; no account or network data.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {app,BrowserWindow}=require('electron');
const root=process.env.MUSIC_REPO||path.resolve(__dirname,'..');
const {createServer}=require(root+'/src/main/server.cjs');
const variant=process.argv[2]||'current',renderer=process.argv[3]||root+'/dist/renderer';
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'music-slide-profile-'));app.setPath('userData',profile);
function fixture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#63635a';ctx.fillRect(0,0,48,48);
 const artwork=canvas.toDataURL(),track={id:'fixture-song',source:'youtube',title:'Performance fixture',artist:'Fixture artist',artwork,duration:300};
 const queue=Array.from({length:600},(_,i)=>({...track,id:'fixture-'+i,title:'Queued song '+i}));
 let state={current:track,playing:true,position:15,duration:300,volume:.5,queue,library:[],loading:false,error:'',effects:'full'},sink,progress;
 const home={account:{connected:true,configured:true,name:'Fixture'},recent:[track],liked:[],playlists:[],discover:[],releases:[]};
 const subscribe=()=>()=>{};
 window.music={getState:async()=>state,getHome:async()=>home,getMode:async()=>'full',onState:fn=>{sink=fn;return()=>{}},onProgress:fn=>{progress=fn;return()=>{}},onHome:subscribe,onMode:subscribe,onEnergy:subscribe,onEngine:subscribe,discovery:async()=>[],recentSearches:async()=>[],setVideoBounds:async()=>{},setPlaybackMode:async()=>{},command:async()=>{},lyrics:async()=>({lines:[]})};
 setInterval(()=>{state={...state,position:state.position+.45};progress?.({id:track.id,position:state.position,duration:300})},450);
 let frames=[],long=[];
 new PerformanceObserver(list=>long.push(...list.getEntries().map(e=>e.duration))).observe({type:'longtask',buffered:false});
 let running=false,last=0;
 function tick(now){if(!running)return;if(last)frames.push(now-last);last=now;requestAnimationFrame(tick)}
 window.startSlideMeasure=()=>{frames=[];long=[];last=0;running=true;requestAnimationFrame(tick)};
 window.stopSlideMeasure=()=>{running=false;const sorted=frames.slice().sort((a,b)=>a-b);return {frames:frames.length,p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxFrameMs:Math.max(...frames),longTasks:long.length,longTaskMs:long.reduce((a,b)=>a+b,0)}};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 let server,w;
 try{
  server=await createServer({rendererDir:renderer});const preload=path.join(profile,'fixture.cjs');fs.writeFileSync(preload,'('+fixture.toString()+')()');
  w=new BrowserWindow({width:1220,height:820,useContentSize:true,show:false,webPreferences:{preload,contextIsolation:false,sandbox:true,backgroundThrottling:false}});
  await w.loadURL(server.origin);w.showInactive();await delay(1300);
  const wc=w.webContents;
  async function click(selector){if(!await wc.executeJavaScript('(()=>{const node=document.querySelector('+JSON.stringify(selector)+');if(!node)return false;node.click();return true})()'))throw Error('Missing '+selector)}
  // Warm one mount so the measurement excludes first-use font and JS setup.
  await click('.dock-track');await delay(700);await click('.player-collapse');await delay(700);
  await wc.executeJavaScript('startSlideMeasure()');const a=app.getAppMetrics(),at=performance.now();
  for(let i=0;i<5;i++){await click('.dock-track');await delay(550);if(variant==='immersive'){await click('[aria-label="Enter immersive player"]');await delay(550);await click('[aria-label="Exit immersive player"]');await delay(550);}await click('.player-collapse');await delay(550)}
  const timing=await wc.executeJavaScript('stopSlideMeasure()'),b=app.getAppMetrics(),seconds=(performance.now()-at)/1000;
  const cpu=type=>{const sum=rows=>rows.filter(p=>p.type===type).reduce((n,p)=>n+p.cpu.cumulativeCPUUsage,0);return Number(((sum(b)-sum(a))/seconds*100).toFixed(2))};
  console.log(JSON.stringify({variant,...timing,rendererCPU:cpu('Tab'),gpuCPU:cpu('GPU'),queueSize:600,cycles:5}));
 }catch(error){console.error(error);process.exitCode=1}
 finally{w?.destroy();await server?.close();app.quit()}
});
app.on('quit',()=>fs.rmSync(profile,{recursive:true,force:true}));

