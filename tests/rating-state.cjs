const test=require('node:test'),assert=require('node:assert/strict');
const {RatingState}=require('../src/renderer/rating-state.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('a click fills immediately and rapid intent is coalesced behind the actual source write',async()=>{
 const writes=[],pending=[];let changes=0;const store=new RatingState((track,rating)=>{writes.push(rating);return new Promise((resolve,reject)=>pending.push({resolve,reject}))},()=>changes++);
 const task=store.set('a',{id:'a'},'like','none');assert.equal(store.value('a','none'),'like');await tick();
 store.set('a',{id:'a'},'dislike','none');store.set('a',{id:'a'},'none','none');assert.equal(store.value('a','none'),'none');pending[0].resolve();await tick();assert.deepEqual(writes,['like','none']);pending[1].resolve();await task;assert.equal(store.value('a','none'),'none');assert(changes>=4);store.close();
});
test('a rejected latest write restores the confirmed rating and an abandoned account stops later clicks',async()=>{
 let reject,updates=0;const store=new RatingState(()=>new Promise((_,r)=>reject=r),()=>updates++);
 const task=store.set('a',{},'dislike','like');await tick();reject(Error('Not saved'));await assert.rejects(task,/Not saved/);assert.equal(store.value('a','like'),'like');store.close();const prior=updates;await store.set('b',{},'like','none');assert.equal(updates,prior);
});

