const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Library}=require('../src/main/library.cjs');
test('a clean library is empty, imports persist, and arbitrary filesystem paths cannot become tracks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-store-'));
  try{
    const lib=new Library(dir);
    assert.deepEqual(lib.data.library,[]);assert.equal(lib.data.current,null);
    const file=path.join(dir,'Clouds.m4a');fs.writeFileSync(file,'test');
    const [track]=lib.addFiles([file]);lib.addFiles([file]);
    const reopened=new Library(dir);
    assert.equal(reopened.data.library.length,1);
    assert.equal(reopened.files[track.id].path,file);
    assert.deepEqual(reopened.normalize({...track,url:'file:///invalid'}),track);
    assert.equal(reopened.normalize({source:'local',id:'unknown',url:'file:///invalid'}),null);
    assert.equal(reopened.normalize({source:'youtube',id:'invalid'}),null);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('history imports are idempotent and unclassified video activity stays out of the music history',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-history-'));
  try{
    const lib=new Library(dir),track={id:'abcdefghijk',title:'Real play',artist:'Artist',source:'youtube'};
    const entry={track,playedAt:'2026-11-12T18:00:00Z',origin:'import',product:'youtube-music'};
    lib.importHistory([entry,entry,{...entry,playedAt:'2026-11-11T18:00:00Z',product:'youtube'}]);
    lib.importHistory([entry]);assert.equal(lib.data.history.length,1);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('separate performing artist credits survive playback normalization, history storage, and restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-credits-'));
  try{
    const db=new Library(dir),song=db.normalize({source:'youtube',id:'abcdefghijk',title:'Two voices',artist:'One & Two',
      artists:[{id:'UC1',name:'One',arbitrary:'discarded'},null,'Two',{id:'UCinvalid',name:'   '}],duration:120});
    const expected=[{name:'One',id:'UC1'},{name:'Two'}];
    assert.deepEqual(song.artists,expected);
    db.record(song,{listenSeconds:13});
    const history=new Library(dir).data.history;
    assert.deepEqual(history[0].track.artists,expected);
    const {computeStats}=require('../src/main/listening-stats.cjs');
    const report=computeStats({history},'month');
    assert.deepEqual(report.artists.map(row=>[row.name,row.plays,row.seconds]),[['One',1,13],['Two',1,13]]);
    assert.equal(report.totals.plays,1);assert.equal(report.totals.seconds,13);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('cached duration labels cannot masquerade as unverified artist names',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-credit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const library=new Library(dir);
 const song={source:'youtube',id:'abcdefghijk',title:'Billie Jean',artist:'4:55'};
 assert.equal(library.normalize(song).artist,'');assert.equal(library.normalize({...song,artist:'Michael Jackson'}).artist,'Michael Jackson');assert.equal(library.normalize({...song,channelId:'UCverified'}).artist,'4:55');
});

test('legacy artist clock labels are repaired without changing listening timestamps or measured seconds',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-migrate-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const track={source:'youtube',id:'abcdefghijk',title:'Song',artist:'4:55'};
 fs.writeFileSync(path.join(dir,'collection.json'),JSON.stringify({data:{history:[{track,playedAt:'2026-11-12T23:00:00Z',listenSeconds:55,playId:'original'}],current:track,library:[],queue:[]}}));
 const library=new Library(dir);assert.equal(library.data.history[0].track.artist,'');assert.equal(library.reconcileMetadata([{...track,artist:'Verified artist'}]),true);assert.equal(library.data.current.artist,'Verified artist');assert.equal(library.data.history[0].track.artist,'Verified artist');assert.equal(library.data.history[0].listenSeconds,55);assert.equal(library.data.history[0].playId,'original');assert.equal(library.data.history[0].playedAt,'2026-11-12T23:00:00Z');
});

