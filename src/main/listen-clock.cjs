// Count listening time from confirmed progress, excluding seeks and buffered time.
class ListenClock {
  constructor(){this.reset();}
  reset(){this.seconds=0;this.position=null;this.at=null;this.playing=false;}
  setPlaying(playing){this.playing=playing;this.position=null;this.at=null;}
  progress(position,now){
    if(!this.playing||!Number.isFinite(position))return this.seconds;
    if(this.position!==null&&this.at!==null){
      const delta=position-this.position,elapsed=(now-this.at)/1000;
      if(delta>0&&elapsed>0&&delta<=elapsed+1)this.seconds+=Math.min(delta,elapsed);
    }
    this.position=position;this.at=now;
    return this.seconds;
  }
}
module.exports={ListenClock};

