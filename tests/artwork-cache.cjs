const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createArtworkStore}=require('../src/main/artwork-cache.cjs');
test('artwork shares in-flight loads and survives restart without another network request',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'music-art-'));t.after(()=>fs.rm(dir,{force:true,recursive:true}));let loads=0;const fetchImpl=async()=>{loads++;return new Response(Uint8Array.from([1,2,3]),{headers:{'content-type':'image/jpeg'}})};
 const first=createArtworkStore({dir,fetchImpl});const [a,b]=await Promise.all([first('https://i.ytimg.com/a'),first('https://i.ytimg.com/a')]);assert.equal(loads,1);assert(a.body.equals(b.body));
 const second=createArtworkStore({dir,fetchImpl:()=>{throw Error('Offline')}});assert((await second('https://i.ytimg.com/a')).body.equals(a.body));assert.equal(loads,1);
});
test('a failed image is retryable and cannot populate the successful image cache',async()=>{
 let loads=0;const read=createArtworkStore({fetchImpl:async()=>{loads++;return new Response('error',{status:404,headers:{'content-type':'text/html'}})}});await assert.rejects(read('x'),/unavailable/);await assert.rejects(read('x'),/unavailable/);assert.equal(loads,2);
});

