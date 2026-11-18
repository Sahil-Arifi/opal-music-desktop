const test=require('node:test');
const assert=require('node:assert/strict');
const {importTakeout}=require('../src/main/takeout.cjs');
const url='https://www.youtube.com/watch?v=7nxWP9BhI7w';
const music={header:'YouTube Music',title:'Watched Roads',titleUrl:url,subtitles:[{name:'Portishead'}],time:'2024-03-21T01:02:03.123Z',products:['YouTube']};
test('Takeout imports proven music listens and retains repeat listens at different times',()=>{
  const regular={...music,header:'YouTube'};
  const rows=[regular,music,music,{...music,time:'2024-04-01T02:03:04Z'},{...music,title:'Subscribed to Portishead'},{...music,details:[{name:'From Google Ads'}]}];
  const result=importTakeout(JSON.stringify(rows),'watch-history.json');
  assert.deepEqual(result.history.map(x=>x.playedAt),['2024-04-01T02:03:04.000Z',music.time]);
  assert.equal(result.ambiguous,1);assert.equal(result.recognizedMusic,2);assert.equal(result.skipped,4);
  assert.equal(result.history[0].track.id,'7nxWP9BhI7w');assert.equal(result.history[0].track.artist,'Portishead');
  assert.equal(importTakeout([regular],'watch-history.json',{includeGeneral:true}).history[0].product,'youtube');
});
test('real Takeout HTML structure preserves timestamps and escapes without executing markup',()=>{
  const html='<html><div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube Music<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">Watched <a href="'+url+'">Feather &amp; Light</a><br><a href="https://www.youtube.com/channel/UC123">Nujabes</a><br>Nov 23, 2025, 1:38:42 AM GMT+03:30<br></div><div class="content-cell mdl-typography--caption">Products: YouTube</div></div></div></html>';
  const e=importTakeout(html,'watch-history.html').history[0];
  assert.equal(e.playedAt,'2025-11-22T22:08:42.000Z');assert.equal(e.track.title,'Feather & Light');assert.equal(e.track.artist,'Nujabes');
});

