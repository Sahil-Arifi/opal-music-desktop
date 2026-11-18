const test=require('node:test');
const assert=require('node:assert/strict');
const {buildHomeHistory}=require('../src/main/home-history.cjs');
const song=(id,title,more={})=>({source:'youtube',id,title,artist:'Quartet',...more});
const event=(track,playedAt,playContext)=>({track,playedAt,playContext,product:'youtube-music'});

test('recent songs merge exact timestamps across feeds, keep fallback ordering, and collapse audio/video uploads',()=>{
  const original=song('audio','Glacier'),video=song('video','Glacier (Official Music Video)');
  const latest=song('new','New song'),live=song('live','Glacier (Live)'),fallback=song('fallback','Fallback');
  const history=[event(original,'2026-11-01T12:00:00Z')];
  const remoteHistory=[event(latest,'2026-11-11T23:30:00-08:00'),{track:video,playedOn:'2026-11-12'},{track:live}];
  const result=buildHomeHistory({history,remoteHistory,recent:[original,fallback]});
  assert.deepEqual(result.recent.map(t=>t.id),['new','audio','live','fallback']);
  assert.deepEqual(result.recentItems.map(t=>t.id),['new','audio','live','fallback']);
  assert.equal(result.recentItems.at(-1).playedAt,undefined);
  assert.equal(history.length,1);assert.equal(remoteHistory.length,3);
});

test('mixed cards come from explicit played contexts, including one track used in two lists',()=>{
  const track=song('one','One',{playlistId:'ambient',albumId:'record',album:'Record'});
  const album={kind:'album',id:'record',title:'Record',artwork:'record-art'};
  const playlist={kind:'playlist',id:'ambient',title:'Old name'};
  const result=buildHomeHistory({history:[
    event({...track,playContext:album},'2026-11-12T12:00:00Z'),
    event(track,'2026-11-12T11:00:00Z',album),
    event(track,'2026-11-12T10:00:00Z',playlist),
    event(track,'2026-11-12T09:00:00Z'),
  ],playlists:[{id:'ambient',title:'Current name',artwork:'playlist-art'}]});
  assert.equal(result.recent.length,1);
  assert.deepEqual(result.recentItems.map(t=>[t.kind,t.title]),[['album','Record'],['playlist','Current name'],['song','One']]);
  assert.equal(result.recentItems[1].artwork,'playlist-art');
  assert.equal(buildHomeHistory({history:[event(track,null,{kind:'album',id:'record'})]}).recentItems[0].kind,'song');
});

test('artists use actual individual credits and artist portraits, retaining distinct artists with the same name',()=>{
  const first=song('one','One',{artist:'Lumen & Wren',artwork:'album-sleeve'});
  const detailed={...first,artists:[{name:'Lumen',id:'UC1'},{name:'Wren',id:'UC2'}]};
  const second=song('two','Two',{artist:'LUMEN',artwork:'another-sleeve'});
  const other=song('three','Three',{artist:'Wren',channelId:'UC3',artwork:'third-sleeve'});
  const result=buildHomeHistory({history:[event(first,'2026-11-12T10:00:00Z'),event(second,'2026-11-11T10:00:00Z')],remoteHistory:[{track:detailed},{track:other}],
    artists:[{id:'UC1',title:'Lumen',artwork:'artist-portrait'},{id:'UC2',title:'Wren'}]});
  assert.deepEqual(result.recentArtists,[{id:'UC1',title:'Lumen',artwork:'artist-portrait'},{id:'UC2',title:'Wren'},{id:'UC3',title:'Wren'}]);
});

test('shelves independently fill to eighteen from played music only',()=>{
  const rows=Array.from({length:29},(_,i)=>({track:song('id'+i,'Song '+i,{artist:i<5?'First':'Artist '+i})}));
  const excluded={track:song('other','Not music',{categoryId:'20'})};
  const value=buildHomeHistory({remoteHistory:[null,excluded,...rows],artists:[{id:'UCnever',title:'Never heard'}]});
  assert.equal(value.recent.length,18);assert.equal(value.recentArtists.length,18);assert.equal(value.recentItems.length,18);
  assert.equal(value.recent[0].id,'id0');assert.equal(value.recentArtists.at(-1).title,'Artist 21');
  assert.deepEqual(buildHomeHistory(),{recent:[],recentArtists:[],recentItems:[]});
});

