const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm');
const {readRatingControl}=require('../src/main/site-rating.cjs');
const {MusicSession}=require('../src/main/music-session.cjs');

test('rating uses pointer input on the requested recording and verifies a fresh watch document',async()=>{
  const s=new MusicSession();s.profile={connected:true};const calls=[];let rating='none',loads=0,closed=false;
  const id='abcdefghijk';
  s.window=()=>({webContents:{setAudioMuted(){},sendInputEvent(e){calls.push(e.type);if(e.type==='mouseUp')rating='like';}},loadURL:async()=>{loads++;},isDestroyed:()=>closed,destroy:()=>{closed=true;}});
  s.run=async(_win,fn,video,action)=>{assert.equal(fn.name,'readRatingControl');assert.equal(video,id);return {rating,...(action && rating!==action?{clickAt:{x:34,y:51}}:{})};};
  assert.equal(await s.rating(id,'like'),'like');assert.equal(loads,2);
  assert.deepEqual(calls,['mouseMove','mouseDown','mouseUp']);assert.equal(closed,false);
});

test('a confirmed service like survives artwork metadata lookup failure',async()=>{
  const s=new MusicSession();s.profile.connected=true;s.rating=async()=>'like';s.search=async()=>{throw Error('offline');};
  await s.rate('abcdefghijk','like');
});

test('signed-in Wiz miniplayer ratings use the segmented controls and honor their pressed state',()=>{
 const id='abcdefghijk',rect={x:40,y:50,width:40,height:30};
 const like={getAttribute:k=>k==='aria-pressed'?'false':null},down={getAttribute:k=>k==='aria-pressed'?'true':null,scrollIntoView(){},getBoundingClientRect:()=>rect,contains:()=>true};
 const root={getAttribute:()=>null,querySelector:q=>q.startsWith('dislike-button')?down:like};
 const document={querySelector:q=>q==='#movie_player'?{getVideoData:()=>({video_id:id})}:q.startsWith('ytmusic-miniplayer')?root:null,elementFromPoint:()=>down};
 const result=vm.runInNewContext('('+readRatingControl.toString()+')(id,"none")',{document,URL,location:new URL('https://music.youtube.com/watch?v='+id),id});
 assert.equal(result.rating,'dislike');assert.equal(result.clickAt.x,60);assert.equal(result.clickAt.y,65);
});

