const test=require('node:test'),assert=require('node:assert/strict');
const {nextShelfBatch}=require('../src/main/site-discovery.cjs');
test('shelf refresh consumes previously unseen source choices before repeating',()=>{
 const pool=Array.from({length:60},(_,i)=>({id:String(i)})),seen=new Set();
 const a=pool.slice(0,18),b=nextShelfBatch(pool,a,seen),c=nextShelfBatch(pool,b,seen),d=nextShelfBatch(pool,c,seen);
 assert.deepEqual(b,pool.slice(18,36));assert.deepEqual(c,pool.slice(36,54));assert.deepEqual(d.slice(0,6),pool.slice(54));
 assert.equal(new Set(d.map(x=>x.id)).size,d.length);
});
test('small discovery pools preserve the real catalog without inventing items',()=>{
 const one={id:'1'},two={id:'2'},s=new Set();assert.deepEqual(nextShelfBatch([one,two,two],[one],s),[two,one]);
});

