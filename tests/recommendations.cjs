const test = require('node:test');
const assert = require('node:assert/strict');
const {createRecommendations,datedReleases,rankCandidates,recordVote} = require('../src/main/recommendations.cjs');

const song = (id, artist, extra={}) => ({id,title:id,artist,source:'youtube',...extra});
const mbid = '10000000-0000-0000-0000-000000000001';
const rgid = '20000000-0000-0000-0000-000000000002';
const first = song('First', 'Sora', {genres:['Ambient']});
const next = song('Second','Sora');
const other = song('Third','Onda',{genres:['Ambient']});
const old = song('Old','Onda');
test('fresh profile makes zero provider requests including when there are no local files', async()=>{
  let calls=0; const fail=()=>{calls++;throw Error('no network expected');};
  const rec=createRecommendations({account:{search:fail},store:{data:{}},musicBrainz:fail});
  assert.deepEqual((await rec.home()).discover,[]);
  assert.equal((await rec.pick()).track,null);
  assert.equal(calls,0);
});
test('account snapshot seeds real discovery, omits known IDs and other video categories, caches repeated search',async()=>{
  const queries=[];
  const rec=createRecommendations({account:{snapshot:()=>({liked:[first,song('F','Finance',{categoryId:'25'})]}),
    search:async q=>(queries.push(q),[first,next,other])},store:{data:{history:[]}}});
  assert.deepEqual((await rec.home()).discover.map(t=>t.id),['Second','Third']);
  await rec.home(); assert.deepEqual(queries,['Sora','ambient music']);
});
test('different pivots away from current artist and suppresses recent and explicit disliked recordings',async()=>{
  const rec=createRecommendations({account:{search:async()=>[first,next,other,old]},store:{data:{}}});
  const voted=await rec.pick({vote:'different',current:first,played:[{track:old}],liked:[first,other]});
  assert.equal(voted.track.id,other.id);
  assert.equal(voted.feedback.votes[0].sign,-1);
  const changed=recordVote(voted.feedback,'like',first);
  assert.equal(changed.votes.length,1);
  assert.equal(changed.votes[0].sign,1);
});
test('radio handles ambiguous MusicBrainz artist names, empty pools, and provider failures without fabricating a pick',async()=>{
  const rec=createRecommendations({account:{search:async()=>{throw Error('offline');}},store:{data:{}},
    musicBrainz:async()=>({artists:[{name:'Sora'},{name:'Sora'}],count:2})});
  assert.equal((await rec.pick({current:song('one','Sora'),vote:'different'})).track,null);
  assert.deepEqual(rankCandidates([first,{...first,id:'first-duplicate'}],{current:first}),[]);
});
test('followed-artist releases use first-release date, verified exact recording and fixed 30 local calendar days',async()=>{
  const date = new Date(2026,10,12,2);
  const artistCredit=[{artist:{id:mbid}}];
  const release=(title,day,extra={})=>({id:rgid,title,'artist-credit':artistCredit,'first-release-date':day,'primary-type':'Single',...extra});
  const groups=[release('Future','2026-11-13'), release('Reissue','2001-02-15'),release('Partial','2026-11'),
    release('Pulse','2026-11-10'),release('False positive','2026-11-11'),release('Reflections','2026-10-14',{'primary-type':'Album'}),
    release('Wrong artist','2026-11-09',{'artist-credit':[{artist:{id:'other'}}]})];
  const mb=async (r,p)=>{
    if (r==='artist/')return {count:1,artists:[{name:'Sora',id:mbid}]};
    if (r==='recording/')return {recordings:[{title:'Refraction','artist-credit':artistCredit}]};
    assert.match(p.query,/2026-10-14 TO 2026-11-12/);return {'release-groups':groups};
  };
  const search=async q=>[song(q,'Sora',{title:q==='Sora False positive'?'Similar recording':q.replace('Sora ','')})];
  const res=await datedReleases([{id:'channel1',title:'Sora - Topic'}],search,mb,date);
  assert.deepEqual(res.map(t=>[t.title,t.releaseDate]),[['Pulse','2026-11-10'],['Refraction','2026-10-14']]);
});
test('ambiguous artist identity never produces a followed-artist release', async()=>{
  const mb=async()=>({count:2,artists:[{name:'Sora',id:mbid},{name:'Sora',id:rgid}]});
  assert.deepEqual(await datedReleases([{title:'Sora'}],()=>{throw Error('unexpected search');},mb,new Date()),[]);
});

test('different pivots to a liked artist with verified distinct genres and rejects unrelated search hits',async()=>{
  const ambient=song('A','Name A'), similar=song('B','Name B'), jazz=song('C','Name C');
  const wrong=song('Bad search hit','Someone Else'), right=song('New Jazz Track','Name C');
  const ids=['00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003'];
  const artists=[ambient,similar,jazz];
  const account={search:async q=>q === 'Name C' ? [wrong,right] : [similar,ambient]};
  const mb=async (r,p)=>{
    if (r==='artist/') {
      const i=artists.findIndex(t=>p.query.includes(t.artist.toLowerCase()));
      return {count:1,artists:[{name:artists[i].artist,id:ids[i]}]};
    }
    const i=ids.indexOf(r.slice('artist/'.length));
    return {genres:[{name:i===2?'jazz':'ambient',count:4}]};
  };
  const rec=createRecommendations({account,store:{data:{}},musicBrainz:mb});
  const {track}=await rec.pick({current:ambient,vote:'dislike',liked:[similar,jazz]});
  assert.equal(track.id,right.id);assert.deepEqual(track.genres,['jazz']);
});

