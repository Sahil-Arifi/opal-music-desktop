// Local audio stays in the same renderer through navigation and mini-player transitions.
const bridge=window.music;
let active=null,generation=0,desiredVolume=.7;
let localAudio, context, analyser, bins, energyTimer,pendingPosition=null,wantsPlay=false;
let lastProgress=0;
const report=(type,data={})=>{if(active)void bridge.reportPlayer(active.id,{type,generation,...data});};
function stopLocal(){
  pendingPosition=null;wantsPlay=false;
  clearInterval(energyTimer);
  if(localAudio){
    for(const key of ['playing','pause','ended','error','waiting','timeupdate','durationchange','seeked','loadedmetadata'])localAudio['on'+key]=null;
    localAudio.pause();localAudio.removeAttribute('src');localAudio.load();localAudio=null;
  }
  if(context){void context.close().catch(()=>{});context=null;}
}
function bands(){
  if(!analyser||!context||document.hidden||localAudio?.paused)return;
  analyser.getByteFrequencyData(bins);
  const band=(low,high)=>{
    const hz=context.sampleRate/analyser.fftSize;
    const from=Math.max(0,Math.floor(low/hz)),to=Math.min(bins.length,Math.ceil(high/hz));
    let sum=0;
    for(let i=from;i<to;i++)sum+=bins[i]**2;
    return Math.min(1,Math.sqrt(sum/Math.max(1,to-from))/200);
  };
  bridge.reportEnergy({bass:band(35,180),mid:band(180,2400),treble:band(2400,10000)});
}
function startAudio(audio){
  audio.play().catch(e=>{if(audio===localAudio&&e.name!=='AbortError')report('error',{message:'Could not play this audio file.'});});
}
function loadLocal(track,startPosition){
  const audio=localAudio=new Audio();
  wantsPlay=true;
  pendingPosition=Number.isFinite(startPosition)&&startPosition>0?startPosition:null;
  audio.crossOrigin='anonymous';audio.volume=desiredVolume;
  audio.onplaying=()=>report('state',{state:'playing'});
  audio.onpause=()=>{if(!audio.ended)report('state',{state:'paused'});};
  audio.onwaiting=()=>report('state',{state:'buffering'});
  audio.onended=()=>report('ended');
  audio.onerror=()=>report('error',{message:'This audio file could not be opened. Import it again if it moved, or try another format.'});
  const progress=()=>{if(pendingPosition===null)report('progress',{position:audio.currentTime,duration:audio.duration});};
  audio.ontimeupdate=()=>{if(performance.now()-lastProgress>240){lastProgress=performance.now();progress();}};
  audio.ondurationchange=progress;audio.onseeked=progress;
  if(pendingPosition!==null)audio.onloadedmetadata=()=>{
    if(audio!==localAudio)return;
    audio.onloadedmetadata=null;
    if(Number.isFinite(audio.duration)&&audio.duration>0)audio.currentTime=Math.min(pendingPosition,Math.max(0,audio.duration-.25));
    pendingPosition=null;progress();
    if(wantsPlay)startAudio(audio);
  };
  audio.src=track.url;
  try{
    context=new AudioContext();
    analyser=context.createAnalyser();analyser.fftSize=2048;analyser.smoothingTimeConstant=.68;
    context.createMediaElementSource(audio).connect(analyser);analyser.connect(context.destination);
    bins=new Uint8Array(analyser.frequencyBinCount);
    void context.resume().catch(()=>{});energyTimer=setInterval(bands,48);
  }catch(e){console.warn('Local audio analysis unavailable',e);}
  if(pendingPosition===null)startAudio(audio);
}
if(bridge)bridge.onEngine(command=>{
  const {type,value}=command;
  if(type==='load'){
    stopLocal();
    generation=command.generation;active=value.track;desiredVolume=value.volume;
    if(active.source==='local')loadLocal(active,value.startPosition);
    return;
  }
  if(type==='stop'){stopLocal();active=null;return;}
  if(type==='volume')desiredVolume=value;
  if(!active||command.generation!==generation)return;
  if(!localAudio)return;
  if(type==='play'){wantsPlay=true;if(pendingPosition===null)startAudio(localAudio);}
  if(type==='pause'){wantsPlay=false;localAudio.pause();}
  if(type==='seek'&&Number.isFinite(value)){
    if(pendingPosition!==null)pendingPosition=Math.max(0,value);
    else localAudio.currentTime=value;
  }
  if(type==='volume')localAudio.volume=value;
});

export {};

