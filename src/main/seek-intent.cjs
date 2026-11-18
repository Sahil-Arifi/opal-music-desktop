// The UI keeps the newest seek intent until the source reaches it. Late ticks
// from the old position never pull the thumb or lyrics back during buffering.
class SeekIntent {
  constructor(){this.serial=0;this.pending=null;}
  begin(target,now){this.pending={target,at:now,serial:++this.serial};return this.serial;}
  clear(){this.pending=null;this.serial++;}
  cancel(serial){if(this.pending?.serial!==serial)return false;this.pending=null;return true;}
  accept(position,now,playing){
    if(!this.pending)return true;
    const {target,at}=this.pending,elapsed=Math.max(0,(now-at)/1000);
    if(Number.isFinite(position)&&(Math.abs(position-target)<=1.25+(playing?Math.min(elapsed,2):0)||elapsed>=4)){
      this.pending=null;return true;
    }
    return false;
  }
}
module.exports={SeekIntent};

