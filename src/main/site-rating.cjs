// Resolve the actual button belonging to this watch page. YouTube's button-shape
// controls use pointer handling, so Electron dispatches a real pointer gesture.
function readRatingControl(id, action) {
  const player=document.querySelector('#movie_player');
  const current=player?.getVideoData?.()?.video_id;
  if(new URL(location.href).searchParams.get('v')!==id || (current && current!==id))return null;
  const bar=document.querySelector('ytmusic-miniplayer segmented-like-dislike-button-view-model') ||
    document.querySelector('ytmusic-player-bar ytmusic-like-button-renderer');
  if(!bar)return null;
  const like=bar.querySelector('like-button-view-model button,#button-shape-like button,#like-button button,button[aria-label="Like"]');
  const dislike=bar.querySelector('dislike-button-view-model button,#button-shape-dislike button,#dislike-button button,button[aria-label="Dislike"]');
  if(!like || !dislike)return null;
  const status=bar.getAttribute('like-status') || bar.data?.likeStatus || bar.likeStatus;
  if(!status && like.getAttribute('aria-pressed')===null && dislike.getAttribute('aria-pressed')===null)return null;
  const rating=status==='LIKE'?'like':status==='DISLIKE'?'dislike':like.getAttribute('aria-pressed')==='true'?'like':dislike.getAttribute('aria-pressed')==='true'?'dislike':'none';
  if(!action || rating===action)return {rating};
  const choose=action==='none'?rating:action;
  const button=choose==='like'?like:dislike;
  if(button.disabled || button.getAttribute('aria-disabled')==='true')return {rating};
  button.scrollIntoView({behavior:'instant',block:'nearest',inline:'nearest'});
  const box=button.getBoundingClientRect(),x=Math.round(box.x+box.width/2),y=Math.round(box.y+box.height/2);
  const target=document.elementFromPoint(x,y);
  return {rating,...(target && box.width && box.height && button.contains(target)?{clickAt:{x,y}}:{})};
}
function clickPoint(contents,point){
  if(!point || !Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y) || point.x<0 || point.y<0)return false;
  const {x,y}=point;
  contents.sendInputEvent({type:'mouseMove',x,y});
  contents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x,y});
  contents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x,y});
  return true;
}
module.exports={readRatingControl,clickPoint};

