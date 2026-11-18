const test=require('node:test'),assert=require('node:assert/strict');
const {SeekIntent}=require('../src/main/seek-intent.cjs');
test('newest seek wins over stale ticks and obsolete failure acknowledgements',()=>{
 const seek=new SeekIntent(),old=seek.begin(90,1000),latest=seek.begin(22,1050);
 assert.equal(seek.accept(10,1100,true),false);
 assert.equal(seek.accept(90,1150,true),false);
 assert.equal(seek.cancel(old),false);
 assert.equal(seek.accept(22.1,1200,true),true);
 assert.equal(seek.cancel(latest),false);
 assert.equal(seek.accept(22.6,1700,true),true);
});
test('paused seeks wait for their confirmed target; an unavailable target recovers to actual source time',()=>{
 const seek=new SeekIntent();seek.begin(60,0);
 assert.equal(seek.accept(14,200,false),false);
 assert.equal(seek.accept(60,500,false),true);
 seek.begin(120,1000);assert.equal(seek.accept(14,4999,false),false);
 assert.equal(seek.accept(14,5000,false),true);
 seek.begin(80,6000);seek.clear();assert.equal(seek.accept(0,6100,false),true);
});

