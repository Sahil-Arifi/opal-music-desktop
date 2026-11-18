const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MetadataCache,readBootLibrary}=require('../src/main/metadata-cache.cjs');
test('metadata persists real results across launches and never crosses account owners',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-metadata-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const a=new MetadataCache(dir,'a'.repeat(64));a.set('artist',{title:'Known artist'});a.close();
 const same=new MetadataCache(dir,'a'.repeat(64));assert.equal(same.get('artist').title,'Known artist');same.close();const other=new MetadataCache(dir,'b'.repeat(64));assert.equal(other.get('artist'),null);other.close();
});
test('boot reads only complete metadata matching the locally recorded account',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-boot-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const id='a'.repeat(64),collections=Object.fromEntries(['liked','songs','playlists','subscriptions','recent','history'].map(key=>[key,[]]));
 fs.writeFileSync(path.join(dir,'service-library.json'),JSON.stringify({version:1,id,profile:{name:'Known profile'},collections}));assert.equal(readBootLibrary(dir,id).profile.name,'Known profile');assert.equal(readBootLibrary(dir,'b'.repeat(64)),null);assert.equal(readBootLibrary(dir,null),null);
});

