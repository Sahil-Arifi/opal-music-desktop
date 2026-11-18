const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createServer}=require('../src/main/server.cjs');
const {serveImport}=require('../src/main/import-stream.cjs');
test('the UI rejects framing, remote scripts, player embeds, traversal and mutations',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'music-ui-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.writeFile(path.join(dir,'index.html'),'<title>Music</title>');
  const server=await createServer({rendererDir:dir});t.after(server.close);
  const response=await fetch(server.origin);
  assert.equal(await response.text(),'<title>Music</title>');
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.match(response.headers.get('content-security-policy'),/frame-src 'none'/);
  assert.equal((await fetch(server.origin+'/player')).status,404);
  assert.equal((await fetch(server.origin+'/artwork?url='+encodeURIComponent('https://127.0.0.1/private'))).status,404);
  assert.equal((await fetch(server.origin+'/artwork?url='+encodeURIComponent('https://i.ytimg.com.evil.example/a'))).status,404);
  assert.equal((await fetch(server.origin+'/index.html',{method:'POST'})).status,405);
  assert.equal((await fetch(server.origin+'/%2e%2e%2fpackage.json')).status,404);
});
test('imported audio supports exact ranges and rejects out-of-bounds requests',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'music-audio-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'clip.m4a');await fs.writeFile(file,'0123456789');
  const clip=await serveImport(file,new Request('http://127.0.0.1/file',{headers:{range:'bytes=3-6'}}),'http://127.0.0.1');
  assert.equal(clip.status,206);assert.equal(await clip.text(),'3456');
  assert.equal(clip.headers.get('content-range'),'bytes 3-6/10');
  assert.equal((await serveImport(file,new Request('http://127.0.0.1/file',{headers:{range:'bytes=30-'}}),'http://127.0.0.1')).status,416);
});

