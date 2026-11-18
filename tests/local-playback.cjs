const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(require.resolve('../src/playback.js'),'utf8').replace('export {};','');
function fixture(){
 let command;const audio=[],events=[];
 class Audio{
   constructor(){this.currentTime=0;this.duration=NaN;this.starts=[];audio.push(this);}
   play(){this.starts.push(this.currentTime);return Promise.resolve();}
   pause(){}removeAttribute(){}load(){}
 }
 const music={onEngine:cb=>{command=cb;},reportPlayer:(id,payload)=>events.push({id,...payload})};
 vm.runInNewContext(script,{Audio,window:{music},document:{},performance,clearInterval(){},console:{warn(){}}});
 const load=(id,generation,startPosition)=>command({type:'load',generation,value:{track:{id,source:'local',url:'music-media://local/'+id},volume:.4,startPosition}});
 return {command:(...args)=>command(...args),load,audio,events};
}
test('local resume seeks after metadata and before the first play while preserving a newer pause or seek',()=>{
 const f=fixture();f.load('sample',1,43.5);const audio=f.audio[0];assert.deepEqual(audio.starts,[]);
 audio.duration=30;audio.ondurationchange();assert.equal(f.events.length,0);
 audio.onloadedmetadata();assert.deepEqual(audio.starts,[29.75]);assert.equal(f.events[0].position,29.75);
 f.load('other',2,12);const other=f.audio[1];
 f.command({type:'pause',generation:2});f.command({type:'seek',generation:2,value:9});
 other.duration=60;other.onloadedmetadata();assert.equal(other.currentTime,9);assert.deepEqual(other.starts,[]);
 f.command({type:'play',generation:2});assert.deepEqual(other.starts,[9]);
});
test('an abandoned local metadata callback cannot start audio or report against a new track',()=>{
 const f=fixture();f.load('first',1,2);const stale=f.audio[0].onloadedmetadata;
 f.load('second',2,0);stale();assert.deepEqual(f.audio[0].starts,[]);assert.deepEqual(f.audio[1].starts,[0]);
 assert.equal(f.events.length,0);
});

