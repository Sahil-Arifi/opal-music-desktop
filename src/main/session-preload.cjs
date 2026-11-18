// This sandboxed preload runs only in the first-party playback window.
// Nothing is exposed on window, and no Google sign-in document is inspected.
if (process.isMainFrame && location.origin === 'https://music.youtube.com') {
  const {ipcRenderer} = require('electron');
  let lastState='',lastTime=0,lastId='';
  let tailId='',reloadId='',loadedAtStart=false;
  let tailAt=0;
  function resetRepeat(){tailId='';reloadId='';loadedAtStart=false;}
  function repeatOne(){
    const button=document.querySelector('ytmusic-miniplayer .ytmusicPlayerControlsRepeatButton button');
    if(button)return button.getAttribute('aria-pressed')==='true' && /\b(?:one|1|current|track|song)\b/i.test(button.getAttribute('aria-label')||button.title||'');
    return document.querySelector('ytmusic-player-controls[repeat-mode="ONE"],ytmusic-player-bar[repeat-mode="ONE"]')!==null;
  }
  function observe(event) {
    // Only the main-world snapshot can access decoder identity. Signal even
    // when the site's miniplayer has advanced without updating its watch URL.
    ipcRenderer.send('music:first-party-event',{kind:'observe'});
    const id=new URL(location.href).searchParams.get('v');
    if(!id || !/^[\w-]{11}$/.test(id)){resetRepeat();return;}
    const player=document.querySelector('#movie_player');
    const video=player?.querySelector('video.html5-main-video') || player?.querySelector('video');
    if(cinemaConfig?.enabled){mountCinema();updateCinema(video);}
    const ad=!!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
    const actual=player?.getVideoData?.()?.video_id;
    if(!ad&&actual&&actual!==id)return;
    const details=player?.getPlayerResponse?.()?.videoDetails;
    if(!ad&&details?.videoId&&details.videoId!==id)return;
    const expectedLength=Number(details?.lengthSeconds);
    if(!ad&&expectedLength>0&&video?.readyState>=1&&Number.isFinite(video.duration)&&Math.abs(video.duration-expectedLength)>2)return;
    const error=player?.querySelector('.ytp-error-content-wrap-reason')?.textContent?.trim();
    const blocked=error || !!video?.error;
    const state=blocked?'error':ad?'ad':!video?'buffering':video.ended?'ended':video.paused?'paused':video.readyState<3?'buffering':'playing';
    if(ad || blocked || (lastId && lastId!==id) || event?.type==='seeking' || event?.type==='ended')resetRepeat();
    const selected=document.querySelector('ytmusic-player-queue-item[selected] a[href*="/watch?v="]');
    const selectedId=selected?.href && new URL(selected.href).searchParams.get('v');
    if(!ad&&selectedId&&selectedId!==id&&(!actual||!details?.videoId)){resetRepeat();return;}
    const position=video?.currentTime || 0, duration=video?.readyState>=1 && Number.isFinite(video.duration)?video.duration:0;
    if(!ad && !blocked && (!event?.target || event.target===video)){
      // Repeat One on Music reloads the recording without firing ended.
      // A manual seek to the beginning has no emptied/loadedmetadata pair.
      if(event?.type==='emptied' && tailId===id && performance.now()-tailAt<4000 && repeatOne()){
        reloadId=id;loadedAtStart=false;
      }else if(event?.type==='loadedmetadata' && reloadId===id){
        loadedAtStart=position<2 && duration>2;
      }else if(event?.type==='playing' && reloadId===id){
        if(loadedAtStart && position<2 && repeatOne())ipcRenderer.send('music:first-party-event',{kind:'loop',id});
        resetRepeat();
      }
      if(state==='playing' && duration>2 && position>=duration-2.25){tailId=id;tailAt=performance.now();}
    }
    const changed=lastId!==id;
    if(changed || state!==lastState || ((state==='playing' || state==='paused') && Math.abs(position-lastTime)>.3)){
      const bar=document.querySelector('ytmusic-miniplayer ytmusic-track-info,ytmusic-player-bar');
      const meta=navigator.mediaSession?.metadata;
      const barTitle=bar?.querySelector('.ytmusicTrackInfoTitle,.title')?.textContent?.trim();
      const title=details?.title || player?.getVideoData?.()?.title || meta?.title || barTitle || '';
      const clean=value=>String(value||'').toLowerCase().replace(/\s*[\[(](?:official\s+)?(?:music\s+video|video|audio)[\])]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const artist=(barTitle&&clean(barTitle)===clean(title)?bar?.querySelector('.ytmusicTrackInfoBylineItem a,.byline a')?.textContent?.trim():'') || (clean(meta?.title)===clean(title)?meta?.artist:'') || details?.author || '';
      const artwork=meta?.artwork?.at(-1)?.src || bar?.querySelector('.ytmusicTrackInfoThumbnail,img.image')?.src || '';
      ipcRenderer.send('music:first-party-event',{id,mediaId:details?.videoId||actual||id,state,position,duration,title,artist,artwork,message:error?.slice(0,260)||''});
      lastId=id;
      lastState=state;lastTime=position;
    }
  }
  let cinemaConfig,cinemaNode,cinemaTimer,cinemaSeek,cinemaTime,cinemaPlay,cinemaDragging=false,cinemaKeyboard=false,cinemaLast=0;
  const command=(name,value)=>ipcRenderer.send('music:first-party-event',{kind:'desktop-command',name,value});
  function setCinemaResting(resting){
    cinemaNode?.classList.toggle('resting',resting);document.documentElement?.toggleAttribute('data-cinema-resting',resting);
  }
  function cinemaHeld(){
    const video=document.querySelector('#movie_player video');
    return !video||video.paused||video.readyState<3||cinemaDragging||!!cinemaNode?.querySelector('.cinema-bar:hover')||(cinemaKeyboard&&cinemaNode?.contains(document.activeElement));
  }
  function checkCinemaIdle(){
    cinemaTimer=undefined;if(!cinemaNode)return;
    if(cinemaHeld()){setCinemaResting(false);return;}
    const remaining=2500-(performance.now()-cinemaLast);
    if(remaining>0)cinemaTimer=setTimeout(checkCinemaIdle,remaining);else setCinemaResting(true);
  }
  function revealCinema(){
    if(!cinemaNode)return;cinemaLast=performance.now();setCinemaResting(false);
    if(!cinemaTimer)cinemaTimer=setTimeout(checkCinemaIdle,2500);
  }
  function cinemaIcon(node,name){
    if(node.dataset.icon===name)return;node.dataset.icon=name;
    const paths={play:'M8 5v14l11-7z',pause:'M9 5v14M15 5v14',previous:'M5 5v14M19 5L8 12l11 7z',next:'M19 5v14M5 5l11 7-11 7z',volume:'M11 5L6 9H3v6h3l5 4zM15 8a6 6 0 010 8M18 5a10 10 0 010 14',exit:'M9 3v6H3M15 21v-6h6M9 9L3 3M15 15l6 6'};
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('width','22');svg.setAttribute('height','22');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]);path.setAttribute('fill',name==='play'?'currentColor':'none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');svg.appendChild(path);node.replaceChildren(svg);
  }
  function updateCinema(video){
    if(!cinemaNode||!video)return;
    if(video.paused||video.readyState<3){if(cinemaNode.classList.contains('resting'))revealCinema();}else if(!cinemaTimer&&!cinemaNode.classList.contains('resting'))revealCinema();
    const duration=Number.isFinite(video.duration)?video.duration:0;
    if(document.activeElement!==cinemaSeek){cinemaSeek.max=String(duration||1);cinemaSeek.value=String(video.currentTime||0);}
    const time=seconds=>Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0');
    cinemaTime.textContent=time(video.currentTime||0)+' / '+time(duration);
    cinemaPlay.setAttribute('aria-label',video.paused?'Play':'Pause');cinemaIcon(cinemaPlay,video.paused?'play':'pause');
  }
  function mountCinema(){
    if(!cinemaConfig?.enabled){cinemaNode?.remove();cinemaNode=null;clearTimeout(cinemaTimer);cinemaTimer=undefined;cinemaDragging=false;setCinemaResting(false);return;}
    const player=document.querySelector('#movie_player');if(!player)return;
    if(cinemaNode?.isConnected){for(const [selector,text] of [['.cinema-title',cinemaConfig.track?.title||''],['.cinema-artist',cinemaConfig.track?.artist||'']]){const node=cinemaNode.querySelector(selector);if(node.textContent!==text)node.textContent=text;}return;}
    const node=cinemaNode=document.createElement('div');node.id='desktop-cinema';
    const style=document.createElement('style');style.textContent=`
      #desktop-cinema{position:absolute;inset:0;z-index:2147483500;pointer-events:none;font:16px -apple-system,BlinkMacSystemFont,sans-serif;color:white}
      #desktop-cinema .cinema-bar{box-sizing:border-box;position:absolute;inset:auto 0 0;padding:34px clamp(20px,5vw,80px) 24px;pointer-events:auto;background:linear-gradient(transparent,#000b 36%,#000d);transition:opacity .3s,transform .3s}
      #desktop-cinema.resting .cinema-bar{opacity:0;transform:translateY(10px);pointer-events:none}
      #desktop-cinema .cinema-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:clamp(22px,3vw,40px);font-weight:650;margin-bottom:5px}
      #desktop-cinema .cinema-artist{font-size:15px;color:#fffc;margin-bottom:14px}
      #desktop-cinema .cinema-controls{display:flex;align-items:center;gap:clamp(6px,1.6vw,15px)}
      #desktop-cinema button{display:grid;place-items:center;flex:none;height:42px;min-width:42px;padding:0 12px;border:0;border-radius:22px;background:#ffffff18;color:white;font-size:19px;cursor:pointer}
      #desktop-cinema button:hover{background:#ffffff30}#desktop-cinema button:focus-visible{outline:2px solid white;outline-offset:3px}
      #desktop-cinema input{accent-color:white;height:22px;cursor:pointer;min-width:0}
      #desktop-cinema .cinema-seek{display:block;width:100%;margin:0 0 9px}
      #desktop-cinema .cinema-time{font-size:12px;font-variant-numeric:tabular-nums;color:#fffd;flex:1}
      #desktop-cinema .cinema-volume{width:clamp(60px,12vw,150px)}
      html[data-cinema-resting] #movie_player,html[data-cinema-resting] #movie_player video{cursor:none!important}
      @media(max-width:600px){#desktop-cinema .cinema-bar{padding:30px 16px 14px}#desktop-cinema button{min-width:34px;width:34px;height:36px;padding:0}#desktop-cinema .cinema-time{font-size:10px}#desktop-cinema .cinema-volume{width:70px}}
      #movie_player:is(.ad-showing,.ad-interrupting) #desktop-cinema{display:none}
    `;node.appendChild(style);
    const bar=document.createElement('div');bar.className='cinema-bar';node.appendChild(bar);
    for(const [className,text] of [['cinema-title',cinemaConfig.track?.title||''],['cinema-artist',cinemaConfig.track?.artist||'']]){const el=document.createElement('div');el.className=className;el.textContent=text;bar.appendChild(el);}
    cinemaSeek=document.createElement('input');cinemaSeek.type='range';cinemaSeek.className='cinema-seek';cinemaSeek.step='.1';cinemaSeek.min='0';cinemaSeek.setAttribute('aria-label','Seek');cinemaSeek.addEventListener('change',()=>command('seek',Number(cinemaSeek.value)));bar.appendChild(cinemaSeek);
    const controls=document.createElement('div');controls.className='cinema-controls';bar.appendChild(controls);
    const button=(label,text,callback)=>{const el=document.createElement('button');el.type='button';el.setAttribute('aria-label',label);el.title=label;cinemaIcon(el,text);el.addEventListener('click',event=>{event.stopPropagation();callback();revealCinema();});controls.appendChild(el);return el;};
    button('Previous track','previous',()=>command('previous'));cinemaPlay=button('Play','play',()=>command('toggle'));button('Next track','next',()=>command('next'));
    cinemaTime=document.createElement('span');cinemaTime.className='cinema-time';controls.appendChild(cinemaTime);
    button('Mute / unmute','volume',()=>command('mute'));
    const volume=document.createElement('input');volume.type='range';volume.className='cinema-volume';volume.min='0';volume.max='1';volume.step='.01';volume.value=String(cinemaConfig.volume??.7);volume.setAttribute('aria-label','Volume');volume.addEventListener('change',()=>command('volume',Number(volume.value)));controls.appendChild(volume);
    button('Exit full screen','exit',()=>command('exitCinema'));
    for(const name of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','keydown','keyup'])bar.addEventListener(name,event=>event.stopPropagation());
    bar.addEventListener('pointerenter',revealCinema);bar.addEventListener('pointerleave',revealCinema);player.appendChild(node);revealCinema();updateCinema(player.querySelector('video'));
  }
  ipcRenderer.on?.('music:cinema',(_event,value)=>{cinemaConfig=value;mountCinema();});
  document.addEventListener('mousemove',()=>{cinemaKeyboard=false;revealCinema()},{passive:true});
  document.addEventListener('pointerdown',event=>{if(!cinemaNode)return;cinemaKeyboard=false;cinemaDragging=!!event.target?.closest?.('#desktop-cinema .cinema-bar');revealCinema();},true);
  const releaseCinema=()=>{cinemaDragging=false;revealCinema()};
  document.addEventListener('pointerup',releaseCinema,true);document.addEventListener('pointercancel',releaseCinema,true);
  document.addEventListener('keydown',event=>{if(event.key==='Tab'||event.key?.startsWith('Arrow'))cinemaKeyboard=true;revealCinema();},true);
  for(const name of ['mousedown','mouseup','click','dblclick'])document.addEventListener(name,event=>{if(!cinemaNode||event.target?.closest?.('#desktop-cinema .cinema-bar'))return;const player=document.querySelector('#movie_player');if(player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting'))return;event.preventDefault();event.stopImmediatePropagation();revealCinema();},true);
  document.addEventListener('visibilitychange',revealCinema);
  globalThis.addEventListener?.('focus',()=>{cinemaDragging=false;cinemaKeyboard=false;revealCinema()});globalThis.addEventListener?.('resize',revealCinema);
  document.addEventListener('focusin',revealCinema,true);
  let queueElement,queueObserver,queueTimer;
  let controlsElement,controlsObserver,settingsTimer;
  function watchSettings(){
    const controls=document.querySelector('ytmusic-miniplayer ytmusic-wiz-player-controls') || document.querySelector('ytmusic-player-controls') || document.querySelector('ytmusic-player-bar');
    if(controls===controlsElement)return;
    controlsObserver?.disconnect();controlsElement=controls;
    if(!controls)return;
    const selector='.ytmusicPlayerControlsShuffleButton,.ytmusicPlayerControlsRepeatButton,.shuffle,.repeat';
    const schedule=()=>{
      if(settingsTimer)return;
      settingsTimer=setTimeout(()=>{
        settingsTimer=null;
        const id=new URL(location.href).searchParams.get('v');
        if(id && /^[\w-]{11}$/.test(id))ipcRenderer.send('music:first-party-event',{kind:'settings',id});
      },100);
    };
    controlsObserver=new MutationObserver(records=>{
      if(records.some(r=>r.target===controls || r.target.closest?.(selector) ||
        [...r.addedNodes].some(n=>n.matches?.(selector) || n.querySelector?.(selector))))schedule();
    });
    controlsObserver.observe(controls,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed','aria-label','repeat-mode','shuffle-on']});
    schedule();
  }
  function scheduleQueue(){
    if(queueTimer)return;
    queueTimer=setTimeout(()=>{
      queueTimer=null;
      const id=new URL(location.href).searchParams.get('v');
      if(id && /^[\w-]{11}$/.test(id))ipcRenderer.send('music:first-party-event',{kind:'queue',id});
    },350);
  }
  function watchQueue(){
    const element=document.querySelector('ytmusic-player-queue');
    if(element===queueElement)return;
    queueObserver?.disconnect();queueElement=element;
    if(element){
      queueObserver=new MutationObserver(scheduleQueue);
      queueObserver.observe(element,{subtree:true,childList:true,attributes:true,attributeFilter:['selected','aria-checked']});
      scheduleQueue();
    }
  }
  setInterval(()=>{watchQueue();watchSettings();},500);
  // An SPA can emit its initial playing event while main is still checking
  // the new watch route. Report an immediate fresh snapshot once it matches.
  ipcRenderer.on?.('music:observe-first-party',()=>{lastState='';observe();});
  for(const event of ['playing','pause','ended','error','seeking','seeked','waiting','emptied','loadedmetadata'])document.addEventListener(event,observe,true);
  setInterval(observe,450);
}

