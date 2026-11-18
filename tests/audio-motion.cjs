const test=require('node:test'),assert=require('node:assert/strict');
const {AudioMotion}=require('../src/main/audio-motion.cjs');
test('analysis starts once for app playback and stops cleanly',async()=>{
 let starts=0,stops=0,cleared=0,tick,visible=true;const messages=[];
 const meter=new AudioMotion({startAudio:async()=>{starts++;return {ok:true}},readEnergy:()=>({bass:2,mid:.4,treble:NaN}),stopAudio:()=>stops++},v=>messages.push(v),{visible:()=>visible,schedule:fn=>{tick=fn;return 1},cancel:()=>cleared++});
 meter.setPlaying(true);await meter.enable();meter.setPlaying(true);tick();assert.equal(starts,1);assert.deepEqual(messages.pop(),{bass:1,mid:.4,treble:0});
 visible=false;tick();assert.equal(messages.length,0);meter.setPlaying(false);assert.deepEqual(messages.pop(),{bass:0,mid:0,treble:0});tick();assert.equal(messages.length,0);meter.close();assert.equal(cleared,1);assert.equal(stops,1);
});
test('failed analysis does not repeatedly prompt but can be explicitly retried',async()=>{
 let calls=0;const meter=new AudioMotion({startAudio:async()=>{calls++;return {ok:false,message:'Permission required'}}},()=>{});
 meter.setPlaying(true);const result=await meter.enable();assert.equal(result.ok,false);meter.setPlaying(false);meter.setPlaying(true);assert.equal(calls,1);await meter.enable();assert.equal(calls,2);meter.close();
});

