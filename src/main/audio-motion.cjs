// The native process tap mixes this app's own CoreAudio processes only.
// It never opens a microphone, captures other apps, or records audio to disk.
class AudioMotion {
  constructor(native,publish,{visible=()=>true,schedule=setInterval,cancel=clearInterval}={}){
    Object.assign(this,{native,publish,visible,schedule,cancel});this.playing=false;this.ready=false;this.attempted=false;this.timer=null;this.task=null;this.closed=false;
  }
  setPlaying(playing){if(this.playing===!!playing)return;this.playing=!!playing;if(this.playing&&!this.attempted)void this.enable();if(!this.playing)this.publish({bass:0,mid:0,treble:0});}
  enable(){
    if(this.closed)return Promise.resolve({ok:false,message:'Audio analysis has stopped.'});
    if(this.task)return this.task;
    if(this.ready)return Promise.resolve({ok:true,message:'Music-reactive glass is active.'});
    this.attempted=true;
    this.task=Promise.resolve().then(()=>this.native?.startAudio?.()||{ok:false,message:'Audio analysis is unavailable on this Mac.'}).then(result=>{
      if(this.closed)return result;
      this.ready=!!result.ok;
      if(this.ready&&!this.timer)this.timer=this.schedule(()=>this.tick(),48);
      return result;
    }).catch(error=>({ok:false,message:error.message||'Audio analysis could not start.'})).finally(()=>{this.task=null});
    return this.task;
  }
  tick(){
    if(!this.ready||!this.playing||!this.visible()||this.closed)return;
    const raw=this.native?.readEnergy?.();if(!raw)return;
    this.publish(Object.fromEntries(['bass','mid','treble'].map(key=>[key,Number.isFinite(raw[key])?Math.max(0,Math.min(1,raw[key])):0])));
  }
  close(){this.closed=true;if(this.timer)this.cancel(this.timer);this.timer=null;this.native?.stopAudio?.();}
}
module.exports={AudioMotion};

