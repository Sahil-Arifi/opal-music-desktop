// These functions run in the first-party document. They return metadata only.
function queueCategories(select) {
  const chips=[...document.querySelectorAll('ytmusic-player-queue #steering-chips ytmusic-chip-cloud-chip-renderer')];
  const categories=chips.map((chip,index)=>{
    const title=(chip.data?.text?.runs?.map(r=>r.text).join('') || chip.textContent || '').trim();
    const selected=chip.data?.isSelected===true || chip.hasAttribute('is-selected') || chip.querySelector('a')?.getAttribute('aria-selected')==='true';
    return {id:index+'-'+title,title,selected};
  });
  if(select!==undefined){
    const index=categories.findIndex(item=>item.id===select);
    if(index<0)return false;
    if(!categories[index].selected)chips[index].querySelector('a')?.click();
    return true;
  }
  return categories.filter(item=>item.title);
}

function avState(select) {
  const player=document.querySelector('#movie_player');
  const detail=player?.getPlayerResponse?.()?.videoDetails;
  const kind=detail?.musicVideoType || '';
  const isMusicVideo=/MUSIC_VIDEO_TYPE_(?:OMV|UGC|LIVE)/.test(kind);
  const toggle=[...document.querySelectorAll('ytmusic-av-toggle')].find(el=>!el.hasAttribute('hidden') && !el.hasAttribute('toggle-disabled'));
  const song=toggle?.querySelector('.song-button'),video=toggle?.querySelector('.video-button');
  const available=isMusicVideo || !!(video && !video.disabled && video.getAttribute('aria-disabled')!=='true');
  if(select){
    if(select==='video' && !available)return false;
    const button=select==='song'?song:video;
    if(button && !button.disabled && (button.getAttribute('aria-pressed')!=='true'||(select==='song'&&isMusicVideo)))button.click();
    if(select==='video'){try{player.setPlaybackQuality?.('auto');}catch{}}
    return true;
  }
  const media=player?.querySelector('video.html5-main-video,video');
  const duration=media?.duration,actual=player?.getVideoData?.()?.video_id;
  const ready=!!media&&media.readyState>=2&&Number.isFinite(duration)&&duration>0&&actual===detail?.videoId&&
    (!(Number(detail?.lengthSeconds)>0)||Math.abs(duration-Number(detail.lengthSeconds))<2);
  return {title:detail?.title||'',position:ready?media.currentTime:undefined,duration:ready?duration:0,ready,decoded:isMusicVideo?'video':kind==='MUSIC_VIDEO_TYPE_ATV'?'song':null,available,hasToggle:!!toggle,selected:video?.getAttribute('aria-pressed')==='true' || (!toggle && isMusicVideo)?'video':'song',recording:detail?.videoId || ''};
}

function frameVideo(active,width,height){
  // Hide every sibling outside the existing player, including fixed site chrome
  // in independent stacking contexts. Do not move the active media element.
  const page=document.documentElement;
  page.toggleAttribute('data-desktop-video',active);
  if(!active)return;
  if(width>0&&height>0){page.style.setProperty('--desktop-video-width',width+'px');page.style.setProperty('--desktop-video-height',height+'px');}
  // Mark only the short ancestor path. Relational selectors over every node
  // repeatedly laid out large native playlist queues during video resizing.
  for(let node=document.querySelector('#movie_player')?.parentElement;node&&node!==page;node=node.parentElement)node.setAttribute('data-desktop-player-path','');
  if(document.getElementById('desktop-video-layout'))return;
  const style=document.createElement('style');style.id='desktop-video-layout';
  const scope='html[data-desktop-video]:not(:has(#movie_player.ad-showing,#movie_player.ad-interrupting))';
  style.textContent=[
    [scope,'overflow:hidden!important;background:#000!important;'],
    [scope+' body','overflow:hidden!important;background:#000!important;'],
    [scope+' [data-desktop-player-path]>:not([data-desktop-player-path]):not(#movie_player)','visibility:hidden!important;pointer-events:none!important;'],
    [scope+' [data-desktop-player-path]','visibility:visible!important;transform:none!important;contain:none!important;overflow:visible!important;clip-path:none!important;'],
    [scope+' #player-page,'+scope+' #main-panel','position:fixed!important;inset:0!important;width:var(--desktop-video-width,100vw)!important;height:var(--desktop-video-height,100vh)!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;padding:0!important;z-index:2147483000!important;background:#000!important;'],
    [scope+' ytmusic-player#player,'+scope+' #song-video,'+scope+' #movie_player','position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;min-height:0!important;margin:0!important;padding:0!important;transform:none!important;visibility:visible!important;'],
    // The compact miniplayer inserts an 82px wrapper. Percentages under it
    // shrink the raster even when the surrounding native view fills the cover.
    [scope+' :is(#music-player-wrapper,#movie_player)','position:fixed!important;inset:0!important;width:var(--desktop-video-width,100vw)!important;height:var(--desktop-video-height,100vh)!important;min-width:var(--desktop-video-width,100vw)!important;min-height:var(--desktop-video-height,100vh)!important;max-width:none!important;max-height:none!important;padding:0!important;margin:0!important;transform:none!important;clip-path:none!important;'],
    [scope+' #movie_player .html5-video-container','position:absolute!important;inset:0!important;width:100%!important;height:100%!important;transform:none;margin:0!important;overflow:hidden!important;'],
    [scope+' #movie_player :is(.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-pause-overlay,.ytp-ce-element)','display:none!important;'],
    [scope+' #movie_player video.html5-main-video','position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:contain!important;object-position:center!important;transform:none!important;margin:0!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;']
  ].map(([selector,css])=>selector+'{'+css+'}').join('\n');
  document.head.appendChild(style);
}

function navigateWatch(id,playlistId,startPosition){
  const app=document.querySelector('ytmusic-app');
  if(!app || !window.customElements?.get('ytmusic-app'))return false;
  const here=new URL(location.href);
  if(here.pathname==='/watch' && here.searchParams.get('v')===id && (!playlistId || here.searchParams.get('list')===playlistId))return false;
  document.documentElement.removeAttribute('data-desktop-video');
  // The site's own watch links deliver this event to its navigation handler.
  // The site chooses the stream, checks availability, builds its queue and runs ads.
  const watchEndpoint={videoId:id,...(playlistId?{playlistId}:{}),startTimeSeconds:Math.max(0,Math.floor(startPosition||0))};
  app.dispatchEvent(new CustomEvent('yt-navigate',{bubbles:true,composed:true,detail:{endpoint:{watchEndpoint}}}));
  return true;
}

function restorePosition(id,seconds){
  const player=document.querySelector('#movie_player');
  if(!player || player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting') ||
    player.getVideoData?.()?.video_id!==id)return false;
  const details=player.getPlayerResponse?.()?.videoDetails;
  if(details?.videoId && details.videoId!==id)return false;
  const video=player.querySelector('video.html5-main-video,video');
  if(!video || video.readyState<1 || !Number.isFinite(video.duration) || video.duration<=0)return false;
  // Route and metadata can commit before the recycled media element changes.
  if(Number(details?.lengthSeconds)>0 && Math.abs(video.duration-Number(details.lengthSeconds))>2)return false;
  const target=Math.min(seconds,Math.max(0,video.duration-0.25));
  if(Math.abs(video.currentTime-target)>(target===0?.5:1.5)){
    if(typeof player.seekTo==='function')player.seekTo(target,true);else video.currentTime=target;
    return false;
  }
  return !video.seeking;
}

// Read in the page's main world: isolated preloads cannot access the site's
// player methods and must never infer decoder identity from the URL alone.
function playbackSnapshot(confirmedId,confirmedDuration){
  const routeId=new URL(location.href).searchParams.get('v'),player=document.querySelector('#movie_player');
  if(!routeId || !/^[\w-]{11}$/.test(routeId) || !player)return null;
  const ad=player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting');
  const actual=player.getVideoData?.(),details=player.getPlayerResponse?.()?.videoDetails;
  const id=ad?routeId:(actual?.video_id || routeId);
  const video=player.querySelector('video.html5-main-video,video');
  if(!ad && details?.videoId && details.videoId!==id)return null;
  if(!ad && !actual?.video_id && !player.querySelector('.ytp-error-content-wrap-reason') && !video?.error)return null;
  const mediaDuration=video?.readyState>=1&&Number.isFinite(video.duration)?video.duration:0;
  const confirmed=!ad&&id===confirmedId&&confirmedDuration>0;
  // Music can extend the MSE buffer duration after a range seek without changing
  // the recording. Keep its previously confirmed content clock in that case.
  const duration=confirmed?confirmedDuration:mediaDuration;
  if(!ad&&!confirmed&&Number(details?.lengthSeconds)>0&&duration>0&&Math.abs(duration-Number(details.lengthSeconds))>2)return null;
  const error=player.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim();
  const state=error||video?.error?'error':ad?'ad':!video?'buffering':video.ended?'ended':video.paused?'paused':video.readyState<3?'buffering':'playing';
  const bar=document.querySelector('ytmusic-miniplayer ytmusic-track-info,ytmusic-player-bar'),meta=navigator.mediaSession?.metadata;
  const barTitle=bar?.querySelector('.ytmusicTrackInfoTitle,.title')?.textContent?.trim();
  const title=details?.title || actual?.title || '';
  const clean=value=>String(value||'').toLowerCase().replace(/\s*[\[(](?:official\s+)?(?:music\s+video|video|audio)[\])]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const metaMatches=!!title && clean(meta?.title)===clean(title),barMatches=!!title && clean(barTitle)===clean(title);
  const artist=(barMatches?bar?.querySelector('.ytmusicTrackInfoBylineItem a,.byline a')?.textContent?.trim():'') || (metaMatches?meta?.artist:'') || details?.author || actual?.author || '';
  const artwork=(metaMatches?meta?.artwork?.at(-1)?.src:'') || (barMatches?bar?.querySelector('.ytmusicTrackInfoThumbnail,img.image')?.src:'') || details?.thumbnail?.thumbnails?.at(-1)?.url || '';
  return {decoded:/MUSIC_VIDEO_TYPE_(?:OMV|UGC|LIVE)/.test(details?.musicVideoType||'')?'video':'song',id,routeId,mediaId:ad?id:(actual?.video_id||id),state,position:confirmed?Math.min(duration,video?.currentTime||0):video?.currentTime||0,duration,title,artist,artwork,message:error?.slice(0,260)||''};
}

function watchCommitted(id,playlistId){
  const here=new URL(location.href);
  if(here.pathname!=='/watch' || here.searchParams.get('v')!==id || (playlistId && here.searchParams.get('list')!==playlistId))return false;
  const p=document.querySelector('#movie_player');
  return !!p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting') || p.getVideoData?.()?.video_id===id);
}

async function skipRecording(direction,skipIds=[]) {
  const player=document.querySelector('#movie_player');
  if(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'))return {ok:false,reason:'ad'};
  const old=player?.getVideoData?.()?.video_id || new URL(location.href).searchParams.get('v');
  if(!old)return {ok:false,reason:'empty'};
  const media=player?.querySelector('video.html5-main-video,video');
  const oldTime=media?.currentTime || 0;
  const rows=[...document.querySelectorAll('ytmusic-player-queue ytmusic-player-queue-item')];
  const at=rows.findIndex(row=>row.hasAttribute('selected') && row.data?.videoId===old);
  const immediate=at>=0?rows[at+(direction==='next'?1:-1)]:null;
  const adjacent=direction==='next'&&at>=0?rows.slice(at+1).find(row=>!skipIds.includes(row.data?.videoId)):immediate;
  const buttons=[...document.querySelectorAll(direction==='next'?
    'ytmusic-miniplayer button[aria-label="Next"],ytmusic-wiz-player-controls button[aria-label="Next"],ytmusic-player-controls .next-button,ytmusic-player-bar .next-button':
    'ytmusic-miniplayer button[aria-label="Previous"],ytmusic-wiz-player-controls button[aria-label="Previous"],ytmusic-player-controls .previous-button,ytmusic-player-bar .previous-button')];
  const button=buttons.find(b=>b.getClientRects().length && !b.disabled && b.getAttribute('aria-disabled')!=='true') ||
    buttons.find(b=>!b.disabled && b.getAttribute('aria-disabled')!=='true');
  if(!button && !adjacent)return {ok:false,reason:'empty'};
  const control=adjacent&&adjacent!==immediate?adjacent:(button?.querySelector('button') || button || adjacent);
  control.click();
  for(let i=0;i<110;i++){
    await new Promise(resolve=>setTimeout(resolve,45));
    const current=player?.getVideoData?.()?.video_id;
    if(current && current!==old)return {ok:true,id:current};
    if(direction==='previous' && oldTime>2 && media && media.currentTime<1.3)return {ok:true,id:old};
    if(adjacent?.hasAttribute('selected') && adjacent.data?.videoId===old)return {ok:true,id:old};
  }
  return {ok:false,reason:'unchanged'};
}

function queuePlaybackSettings(id,change){
  const player=document.querySelector('#movie_player');
  if(player?.classList.contains('ad-showing') || player?.classList.contains('ad-interrupting'))return {error:'Queue settings are available after the advertisement.'};
  const actual=player?.getVideoData?.()?.video_id;
  if(!player || !actual)return {pending:true,error:'YouTube Music is loading the recording.'};
  if(actual!==id)return {error:'The playing recording changed.'};
  const legacyGroups=[...document.querySelectorAll('ytmusic-player-controls,ytmusic-player-bar')].filter(el=>el.querySelector('.shuffle') && el.querySelector('.repeat'));
  const legacy=legacyGroups.find(el=>el.querySelector('.shuffle').getClientRects().length>0) || legacyGroups[0];
  const shuffle=document.querySelector('ytmusic-miniplayer .ytmusicPlayerControlsShuffleButton button,ytmusic-wiz-player-controls button[aria-label^="Shuffle" i]') || legacy?.querySelector('.shuffle');
  const repeat=document.querySelector('ytmusic-miniplayer .ytmusicPlayerControlsRepeatButton button,ytmusic-wiz-player-controls button[aria-label^="Repeat" i]') || legacy?.querySelector('.repeat');
  if(!shuffle || !repeat)return {pending:true,error:'YouTube Music did not offer shuffle and repeat for this queue.'};
  const shufflePressed=shuffle.getAttribute('aria-pressed');
  const shuffleOn=shufflePressed==='true'||shufflePressed==='false'?shufflePressed==='true':legacy?.shuffleEnabled;
  const legacyMode=legacy?.repeatMode?.toLowerCase();
  const label=repeat.getAttribute('aria-label')||repeat.title||'';
  const mode=legacyMode==='none'?'off':['off','all','one'].includes(legacyMode)?legacyMode:(
    /\b(?:one|1|current|track|song)\b/i.test(label)?'one':
    /\b(?:all|playlist|queue)\b/i.test(label)?'all':repeat.getAttribute('aria-pressed')==='false'||/\boff\b/i.test(label)?'off':null);
  if(typeof shuffleOn!=='boolean' || !mode)return {pending:true,error:'YouTube Music did not confirm the current queue settings.'};
  if(change){
    const queue=document.querySelector('ytmusic-player-queue');
    if(change==='shuffle' && queue && !queue.querySelector('ytmusic-player-queue-item'))return {pending:true,error:'Wait for YouTube Music to load the queue before shuffling it.'};
    const button=change==='shuffle'?shuffle:repeat;
    if(button.disabled || button.getAttribute('aria-disabled')==='true')return {error:'YouTube Music disabled this queue setting.'};
    (button.querySelector('button')||button).click();
  }
  return {shuffle:shuffleOn,repeat:mode};
}

module.exports={avState,frameVideo,queueCategories,skipRecording,navigateWatch,watchCommitted,queuePlaybackSettings,restorePosition,playbackSnapshot};

function seekReady(id,target){
  const player=document.querySelector('#movie_player');
  if(player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting'))return {ad:true};
  const media=player?.querySelector('video.html5-main-video,video');
  return {ready:player?.getVideoData?.()?.video_id===id&&!!media&&!media.ended&&!media.seeking&&media.readyState>=3&&Math.abs(media.currentTime-target)<3,ended:!!media?.ended,duration:Number.isFinite(media?.duration)?media.duration:0};
}
module.exports.seekReady=seekReady;

function standbyState(id){
  const player=document.querySelector('#movie_player'),media=player?.querySelector('video.html5-main-video,video');
  if(!player)return null;
  const ad=player.classList.contains('ad-showing')||player.classList.contains('ad-interrupting');
  const ready=player.getVideoData?.()?.video_id===id&&!!media&&media.readyState>=3&&!media.seeking;
  if(ad||ready){
    if(typeof player.pauseVideo==='function')player.pauseVideo();else media?.pause();
  }
  if(ready&&!ad&&media.currentTime>.04){if(typeof player.seekTo==='function')player.seekTo(0,true);else media.currentTime=0;return {ad:false,ready:false};}
  return {ad,ready:ad||ready,position:media?.currentTime||0,duration:Number.isFinite(media?.duration)?media.duration:0};
}
module.exports.standbyState=standbyState;

// Preparation already rewound and buffered the first frame. Activate it in one trip.
function activatePrepared(volume,intent){
 const player=document.querySelector('#movie_player'),media=player?.querySelector('video.html5-main-video,video');if(!media)return false;
 if(typeof player.setVolume==='function')player.setVolume(Math.max(0,Math.min(1,volume))*100);else media.volume=Math.max(0,Math.min(1,volume));
 if(intent==='pause'){if(typeof player.pauseVideo==='function')player.pauseVideo();else media.pause();return true;}
 if(typeof player.playVideo==='function'){player.playVideo();return true;}return media.play().then(()=>true);
}
module.exports.activatePrepared=activatePrepared;

// One composited animation; the decoder, media element, and native view stay alive.
function animateVideoPresentation(immersive){
 const node=document.querySelector('#movie_player .html5-video-container');if(!node?.animate)return false;
 const key=Symbol.for('desktop-music.presentation');node[key]?.cancel();
 node.style.willChange='opacity,transform';
 const animation=node.animate([{opacity:.38,transform:immersive?'scale(1.035)':'scale(.985)'},{opacity:1,transform:'scale(1)'}],
  {duration:420,easing:'cubic-bezier(.22,1,.36,1)'});
 node[key]=animation;
 animation.finished.catch(()=>{}).finally(()=>{if(node[key]===animation){delete node[key];node.style.removeProperty('will-change');}});
 return true;
}
module.exports.animateVideoPresentation=animateVideoPresentation;

