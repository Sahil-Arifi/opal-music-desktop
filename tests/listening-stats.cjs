const test=require('node:test');
const assert=require('node:assert/strict');
const {computeStats}=require('../src/main/listening-stats.cjs');
const {readHistory,readPlaylistDetails,readYouTubePlaylistDetails}=require('../src/main/history-reader.cjs');
const vm=require('node:vm');
const now=new Date(2026,10,12,12);
const song={id:'0123456789a',source:'youtube',title:'Harbor Light',artist:'The Quartet',album:'Tide',duration:240,artwork:'cover'};
const another={...song,id:'0123456789b',title:'Low Water',album:'Bay'};
const d=(n,h=9)=>new Date(2026,10,n,h).toISOString();
const play=(track,playedAt,listenSeconds)=>({track,playedAt,listenSeconds,product:'youtube-music',origin:'local'});
const remote=(track,playedOn)=>({track,playedOn,product:'youtube-music',origin:'account'});

test('past week and past month use rolling windows and include the cutoff through now',()=>{
 const history=[play(song,d(12),30),play(another,d(6),10),play(another,d(5),8),play(song,d(13),9),play(song,d(12,20),11)];
 const remoteHistory=[remote(another,undefined),remote(another,'2026-02-30')];
 const week=computeStats({history,remoteHistory},'week',now);
 assert.deepEqual(week.totals,{plays:2,seconds:40,artists:1,songs:2,albums:2});
 assert.equal(week.coverage.untimedPlays,2);
 assert.equal(week.coverage.from,new Date(2026,10,6).toISOString());
 assert.equal(week.coverage.to,now.toISOString());
 assert.equal(week.albums[0].name,'Tide');
 assert.equal(computeStats({history,remoteHistory},'month',now).totals.plays,3);
 for (const removed of ['all','6months','year','bogus']) assert.throws(()=>computeStats({},removed,now),/period/);
 const cutoffs = [
   ['week',new Date(2026,10,6),/past seven days/],
   ['month',new Date(2026,9,12),/past month/],
 ];
 for(const [period,cutoff,description] of cutoffs){
   const before=new Date(+cutoff-1);
   const result=computeStats({history:[play(song,cutoff.toISOString(),2),play(another,before.toISOString(),9)]},period,now);
   assert.equal(result.period,period);
   assert.equal(result.coverage.from,cutoff.toISOString());
   assert.match(result.coverage.scope,description);
   assert.equal(result.totals.plays,1);
 }
});

test('calendar anniversaries clamp to the last real day of their destination month',()=>{
 const cases=[
   ['month',new Date(2024,2,31,12),new Date(2024,1,29)],
   ['month',new Date(2025,2,31,12),new Date(2025,1,28)],
   ['month',new Date(2026,0,31,12),new Date(2025,11,31)],
   ['month',new Date(2026,4,31,12),new Date(2026,3,30)],
 ];
 for(const [period,end,cutoff] of cases){
   const history=[play(song,cutoff.toISOString(),10),play(another,new Date(+cutoff-1).toISOString(),5)];
   const result=computeStats({history},period,end);
   assert.equal(result.coverage.from,cutoff.toISOString());
   assert.equal(result.totals.seconds,10);
 }
});

test('rolling week boundaries use local midnight across daylight-saving changes and the new year',()=>{
 for(const [end,cutoff] of [
   [new Date(2026,2,8,19),new Date(2026,2,2)],
   [new Date(2026,2,9,9),new Date(2026,2,3)],
   [new Date(2026,10,1,17),new Date(2026,9,26)],
   [new Date(2026,0,1,8),new Date(2025,11,26)],
 ]) assert.equal(computeStats({},'week',end).coverage.from,cutoff.toISOString());
});

test('daily overlap uses the minimum supported count and preserves repeats and actual measured seconds',()=>{
 const history=[play(song,d(12,9),10),play(song,d(12,11),12),{...play(song,d(12,9),10),origin:'import'},play(another,d(11),0)];
 const remoteHistory=[remote(song,'2026-11-12'),remote(song,'2026-11-12'),remote(song,'2026-11-12'),remote(another,undefined)];
 const week=computeStats({history,remoteHistory},'week',now);
 assert.equal(week.totals.plays,4);assert.equal(week.totals.seconds,22);
 assert.deepEqual(week.songs.map(t=>[t.id,t.plays,t.seconds]),[[song.id,3,22],[another.id,1,0]]);
 assert.equal(week.artists[0].plays,4);assert.equal(week.artists[0].seconds,22);
 assert.equal(computeStats({history,remoteHistory},'month',now).totals.plays,4);
});

test('official range-only plays count inside a whole period and stay unassigned across its boundary',()=>{
 const ranged=(track,from,to)=>({...remote(track),playedRange:{from,to}});
 const history=[play(song,d(4),14),play(song,d(12),9)];
 const remoteHistory=[
   ranged(song,'2026-11-02','2026-11-08'),
   ranged(song,'2026-11-02','2026-11-08'),
   ranged(another,'2026-10-01','2026-10-31'),
   ranged(another,'2026-05-01','2026-05-31'),
   remote(another),
 ];
 const stats=p=>computeStats({history,remoteHistory},p,now);
 assert.equal(stats('week').totals.plays,1);
 assert.equal(stats('month').totals.plays,3);
 assert.equal(stats('month').totals.seconds,23);
 assert.match(stats('week').coverage.scope,/3 entries have no confirmed date/);
 assert.match(stats('month').coverage.scope,/2 entries have no confirmed date/);
});

test('a coarse date range does not erase proven separate days or double-count account and app copies',()=>{
 const ranged=(track,from,to)=>({...remote(track),playedRange:{from,to}});
 const history=[play(song,d(1),11),play(song,d(2),12),play(song,d(3),13),play(song,d(8),14)];
 const remoteHistory=[remote(song,'2026-11-02'),ranged(song,'2026-11-01','2026-11-07')];
 const s=computeStats({history,remoteHistory},'month',now);
 assert.equal(s.totals.plays,4);
 assert.equal(s.totals.seconds,50);
 assert.equal(s.coverage.untimedPlays,0);
 const sameFeed=computeStats({remoteHistory:[...remoteHistory,remote(song,'2026-11-02')]},'month',now);
 assert.equal(sameFeed.totals.plays,3);
});

test('undated account occurrences are disclosed and excluded from both rolling periods',()=>{
 const history=[play(song,d(1),undefined)];
 const remoteHistory=[remote(song,undefined),remote(song,undefined),remote(another,undefined)];
 for(const [period,expected] of [['week',0],['month',1]]){
   const report=computeStats({history,remoteHistory},period,now);
   assert.equal(report.totals.plays,expected);assert.equal(report.totals.seconds,0);
   assert.equal(report.coverage.untimedPlays,3);assert.match(report.coverage.scope,/3 entries have no confirmed date/);
 }
});
test('listening-time estimates use full lengths only for unmeasured occurrences after cross-feed deduplication',()=>{
 const unknown={...another,id:'0123456789x',duration:0};
 const history=[play(song,d(11,10),19.7),play(unknown,d(11,11),0)];
 const remoteHistory=[remote(song,'2026-11-11'),remote(song,'2026-11-11'),remote(song,'2026-11-11'),remote(song,undefined)];
 const week=computeStats({history,remoteHistory},'week',now);
 assert.equal(week.totals.plays,4);assert.equal(week.totals.seconds,20);
 assert.deepEqual(week.time,{measuredSeconds:20,measuredPlays:1,estimatedSeconds:480,estimatedPlays:2,unknownPlays:1});
 assert.equal(computeStats({history,remoteHistory},'month',now).songs[0].seconds,20);
});
test('known exact timestamps deduplicate identical events while preserving distinct plays of the same title',()=>{
 const history=[play(song,d(11,8),11)];
 const remoteHistory=[{...play(song,d(11,8),undefined),origin:'account'},{...play(song,d(11,9),undefined),origin:'account'}];
 const stats=computeStats({history,remoteHistory},'week',now);
 assert.equal(stats.songs[0].plays,2);assert.equal(stats.totals.seconds,11);
});
test('an official audio and music video share a ranked song while a live version keeps its own row',()=>{
 const video={...song,id:'0123456789v',title:song.title+' (Official Music Video)'};
 const live={...song,id:'0123456789l',title:song.title+' (Live)'};
 const stats=computeStats({history:[play(song,d(11,8),9),play(video,d(12,8),12),play(live,d(11,10),8)]},'month',now);
 assert.equal(stats.totals.songs,2);assert.equal(stats.totals.plays,3);
 assert.equal(stats.songs[0].plays,2);assert.equal(stats.songs[0].seconds,21);
});
test('the same YouTube recording keeps one play and its full credits when the player and account disagree on artist text',()=>{
 const player={...song,artist:'Lumen',channelId:'UCone',artists:[]};
 const account={...song,artist:'Lumen & Wren',artists:[{id:'UCone',name:'Lumen'},{id:'UCtwo',name:'Wren'}]};
 const s=computeStats({history:[play(player,d(12,9),18)],remoteHistory:[remote(account,'2026-11-12')]},'week',now);
 assert.equal(s.totals.plays,1);assert.equal(s.totals.songs,1);assert.equal(s.totals.seconds,18);
 assert.deepEqual(s.artists.map(row=>row.name),['Lumen','Wren']);
});
test('artist and album rankings resolve known IDs without splitting collaborations or merging namesakes',()=>{
 const main={...song,artist:'Quartet',channelId:'UC1',albumId:'MP1'};
 const missing={...main,id:'0123456789y',title:'Another song',channelId:'',albumId:''};
 const featured={...another,artist:'Trio',album:main.album,albumId:main.albumId};
 const s=computeStats({history:[play(main,d(9),8),play(missing,d(10),11),play(featured,d(11),5)]},'month',now);
 assert.equal(s.totals.albums,1);assert.equal(s.albums[0].id,'MP1');assert.equal(s.albums[0].plays,3);
 assert.equal(s.albums[0].artist,undefined);
 assert.equal(s.totals.artists,2);assert.equal(s.artists[0].id,'UC1');assert.equal(s.artists[0].plays,2);
 const otherArtist={...missing,id:'0123456789z',channelId:'UC2',albumId:'MP2',title:'Namesake'};
 const namesakes=computeStats({history:[play(main,d(9),8),play(otherArtist,d(10),9)]},'month',now);
 assert.equal(namesakes.totals.artists,2);assert.equal(namesakes.totals.albums,2);
});
test('artist and album rankings use real credits; tracks with missing metadata are counted as songs',()=>{
 const duet={...song,artists:[{id:'artist1',name:'Lumen'},{id:'artist2',name:'Wren'}],artist:'Lumen & Wren'};
 const local={id:'local1',source:'local',title:'Voice memo',artist:'Local audio',duration:800};
 const s=computeStats({history:[play(duet,d(12,8),5),play(local,d(12,10),2)]},'month',now);
 assert.equal(s.totals.plays,2);assert.equal(s.totals.songs,2);assert.equal(s.totals.albums,1);
 assert.deepEqual(s.artists.map(a=>a.name),['Lumen','Wren']);
 assert.deepEqual(s.artists.map(a=>a.plays),[1,1]);assert.equal(s.albums[0].name,'Tide');
 assert.deepEqual(computeStats({},'month',now).totals,{plays:0,seconds:0,artists:0,songs:0,albums:0});
});

const run=(fn,doc,url,args=[])=>vm.runInNewContext('('+fn.toString()+')(...args)',{document:doc,location:new URL(url),URL,Date,args});
const artist={text:'The Quartet',navigationEndpoint:{browseEndpoint:{browseId:'UCfixture'}}};
function card(heading,stamp){
 const shelf={data:{title:{runs:[{text:heading}]}},querySelector:()=>null};
 return {data:{playlistItemData:{videoId:song.id},flexColumns:[
  {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:song.title}]}}},
  {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[artist]}}}
 ]},closest:()=>shelf,querySelector:q=>q.startsWith('time') && stamp?{getAttribute:()=>stamp}:null};
}
test('official history cards preserve repeated plays and distinguish exact dates, relative headings and unknown groups',()=>{
 const ref=new Date(2026,0,2,12);
 const cards=[card('Today'),card('Today'),card('Yesterday'),card('Dec 31'),card('31 December 2024'),card('Tuesday, December 2, 2025'),card('Older'),card('February 30, 2025'),card('Older','2026-01-01T04:09:05Z')];
 const doc={querySelector:()=>null,querySelectorAll:()=>cards};
 const result=run(readHistory,doc,'https://music.youtube.com/history',[+ref]);
 assert.equal(result.cardCount,9);assert.equal(result.tracks.length,9);
 assert.deepEqual(Array.from(result.history,x=>x.playedOn||null),['2026-01-02','2026-01-02','2026-01-01','2025-12-31','2024-12-31','2025-12-02',null,null,null]);
 assert.equal(result.history.at(-1).playedAt,'2026-01-01T04:09:05.000Z');
 assert.equal(result.history[0].track.artist,'The Quartet');
 assert.equal(run(readHistory,doc,'https://music.youtube.com/library/songs').history.length,0);
});

test('playlist header reports actual count, privacy, owner and artwork while separating edit permission from ownership',()=>{
 const header={data:{title:{runs:[{text:'Test list'}]},subtitle:{runs:[artist]},secondSubtitle:{runs:[{text:'Unlisted • 1,205 songs • 30 hours'}]},
  thumbnail:{musicThumbnailRenderer:{thumbnail:{thumbnails:[{url:'cover'}]}}}},closest:()=>({data:{editHeader:{musicPlaylistEditHeaderRenderer:{playlistId:'PLfixture'}}}}),querySelector:()=>null};
 const doc={querySelector:q=>q.startsWith('ytmusic-browse-response')?null:header};
 const result=run(readPlaylistDetails,doc,'https://music.youtube.com/playlist?list=PLfixture');
 assert.equal(result.count,1205);assert.equal(result.owner,'The Quartet');assert.equal(result.privacy,'unlisted');
 assert.equal(result.artwork,'cover');assert.equal(result.editable,true);assert.equal(result.owned,undefined);
 header.data.secondSubtitle={runs:[{text:'About 1.2K views'}]};
 const unspecified=run(readPlaylistDetails,doc,'https://music.youtube.com/playlist?list=PLfixture');
 assert.equal(unspecified.count,undefined);assert.equal(unspecified.privacy,undefined);
 assert.equal(run(readPlaylistDetails,doc,'https://music.youtube.com/playlist?list=PLother'),null);
});

test('the YouTube playlist header reports exact playlist totals without counting rendered rows or views',()=>{
 const list='PLfixture',url='https://www.youtube.com/playlist?list='+list;
 const sidebar={title:{runs:[{text:'Example'}]},navigationEndpoint:{watchEndpoint:{playlistId:list}},
   stats:[{simpleText:'234,567 views'},{runs:[{text:'1,493'},{text:' videos'}]}],
   thumbnailRenderer:{playlistVideoThumbnailRenderer:{thumbnail:{thumbnails:[{url:'thumbnail'}]}}}};
 const data={sidebar:{playlistSidebarRenderer:{items:[{playlistSidebarPrimaryInfoRenderer:sidebar}]}}};
 const read=(href=url)=>vm.runInNewContext('('+readYouTubePlaylistDetails.toString()+')()',
   {window:{ytInitialData:data},document:{querySelector:()=>null},location:new URL(href),URL});
 assert.equal(read().count,1493);assert.equal(read().countSource,'youtube');assert.equal(read().artwork,'thumbnail');
 sidebar.stats=[{simpleText:'100+'},{simpleText:'1.7K videos'},{simpleText:'234,567 views'}];
 assert.equal(read().count,undefined);
 data.header={pageHeaderRenderer:{content:{pageHeaderViewModel:{metadata:{contentMetadataViewModel:{metadataRows:[
   {metadataParts:[{text:{content:'0 videos'}}]}]}}}}}};
 assert.equal(read().count,0);
 assert.equal(read('https://www.youtube.com/playlist?list=PLOther'),null);
 assert.equal(read('https://music.youtube.com/playlist?list='+list),null);
});

test('artist and album listening-time ranking is independent of the song play-count ranking',()=>{
 const short={...song,id:'short',artist:'Quick',channelId:'UCshort',album:'Short',albumId:'MPshort',duration:30};
 const long={...song,id:'long',artist:'Long',channelId:'UClong',album:'Long album',albumId:'MPlong',duration:600};
 const report=computeStats({history:[play(short,d(12,8),20),play(short,d(12,9),20),play(long,d(12,10),300)]},'month',now);
 assert.equal(report.songs[0].id,'short');assert.equal(report.songs[0].plays,2);
 assert.equal(report.artists[0].name,'Long');assert.equal(report.artists[0].listeningSeconds,300);
 assert.equal(report.albums[0].id,'MPlong');assert.equal(report.albums[0].estimatedSeconds,0);
 const estimated=computeStats({remoteHistory:[{track:long,playedOn:'2026-11-12'}]},'month',new Date('2026-11-13T12:00:00'));
 assert.equal(estimated.artists[0].seconds,0);assert.equal(estimated.artists[0].estimatedSeconds,600);
 assert.equal(estimated.artists[0].listeningSeconds,600);
});

