const path = require('node:path');
const fs = require('node:fs');
const {createHash} = require('node:crypto');
const {recordingKey,mergeRecordingVariants}=require('./recording.cjs');
const {readRatingControl,clickPoint}=require('./site-rating.cjs');
const catalogService=require('./catalog-service.cjs');
const {readHistory,readPlaylistDetails,readYouTubePlaylistDetails}=require('./history-reader.cjs');
const {discoveryShelves,nextShelfBatch}=require('./site-discovery.cjs');
const {avState,frameVideo,queueCategories,skipRecording,navigateWatch,watchCommitted,queuePlaybackSettings,restorePosition,playbackSnapshot,seekReady,standbyState,activatePrepared,animateVideoPresentation}=require('./site-player.cjs');
const {videoId,linkedVideoId} = require('./youtube-api.cjs');
const ORIGIN = 'https://music.youtube.com';
const PARTITION = 'persist:youtube-music';
const wait = ms=>new Promise(resolve=>setTimeout(resolve,ms));
const empty = ()=>({songs:[],liked:[],playlists:[],subscriptions:[],recent:[],history:[],discover:[],releases:[],syncedAt:null});
// Exact account domains from https://www.google.com/supported_domains.
// Checking the entire suffix excludes lookalikes such as accounts.google.com.example.org.
const googleAccountSuffixes = new Set(`com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj
com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch ci co.ck cl cm cn com.co co.cr com.cu
cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga ge gg com.gh
com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is it je com.jm jo co.jp
co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv com.ly co.ma md me mg mk ml
com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng com.ni ne nl no com.np nr nu co.nz
com.om com.pa com.pe com.pg com.ph com.pk pl pn com.pr ps pt com.py com.qa ro ru rw com.sa
com.sb sc se com.sg sh si sk com.sl sn so sm sr st com.sv td tg co.th com.tj tl tm tn to com.tr
tt com.tw co.tz com.ua co.ug co.uk com.uy co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm
co.zw cat`.split(/\s+/));
const serviceHosts = new Set([
  'music.youtube.com', 'www.youtube.com', 'accounts.youtube.com', 'accounts.blogger.com',
  'consent.youtube.com', 'consent.google.com', 'myaccount.google.com'
]);

function allowedURL(input) {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const prefix = 'accounts.google.';
    return serviceHosts.has(url.hostname) ||
      (url.hostname.startsWith(prefix) && googleAccountSuffixes.has(url.hostname.slice(prefix.length)));
  } catch {
    return false;
  }
}

function guardNavigation(event, onBlocked) {
  // will-redirect also fires for subframes (challenge widgets, for example).
  // Their document origins are sandboxed by Chromium and the site's CSP.
  if (event.isMainFrame === false || allowedURL(event.url)) return;
  event.preventDefault();
  onBlocked?.(URL.canParse(event.url) ? new URL(event.url).hostname : '');
}

// Read the song and collection cards the official site has already rendered.
// No service cookies, credentials, stream URLs or internal API keys are read.
function readPage(keepRepeats=false,shelfIndex){
  const tracks=[],playlists=[],artists=[],albums=[],releases=[];
  const seen=new Set();
  const content=document.querySelector('ytmusic-browse-response:not([hidden]), ytmusic-search-page:not([hidden])') || document;
  const shelf=shelfIndex===undefined?null:content.querySelectorAll('ytmusic-carousel-shelf-renderer,ytmusic-shelf-renderer')[shelfIndex];
  const scope=shelf || (keepRepeats?(content.querySelector?.('ytmusic-playlist-shelf-renderer') || content):content);
  const cards=scope.querySelectorAll('ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer,ytmusic-card-shelf-renderer,ytmusic-multi-row-list-item-renderer,ytmusic-playlist-shelf-renderer ytmusic-playlist-panel-video-renderer');
  for(const card of cards){
    const d=card.data || {};
    const flex=(d.flexColumns || []).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
    const head=flex[0] || d.title?.runs || [];
    const runs=[...flex.slice(1).flat(),...(d.subtitle?.runs||[]),...(d.fixedColumns||[]).flatMap(c=>c.musicResponsiveListItemFixedColumnRenderer?.text?.runs || [])];
    const nav=d.navigationEndpoint || head[0]?.navigationEndpoint || d.onTap || {};
    const destination=card.querySelector('a[href*="/playlist?list="]')?.href;
    const playlistId=destination ? new URL(destination).searchParams.get('list') : '';
    const recording=card.querySelector('a[href*="/watch?v="]')?.href;
    const title=head.map(r=>r.text).join('') || card.querySelector('.title')?.textContent.trim();
    if(!title)continue;
    const browse=nav.browseEndpoint, type=browse?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    const covers=(d.thumbnail || d.thumbnailRenderer)?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
    const artwork=covers.at(-1)?.url || card.querySelector('img')?.src || '';
    const watch=d.playlistItemData?.videoId || nav.watchEndpoint?.videoId ||
      (!nav.browseEndpoint && !playlistId && recording ? new URL(recording).searchParams.get('v') : '');
    const owner=runs.find(r=>r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==='MUSIC_PAGE_TYPE_ARTIST') ||
      runs.find(r=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    if(watch && /^[\w-]{11}$/.test(watch) && (keepRepeats || !seen.has(watch))){
      seen.add(watch);
      const durationText=runs.find(r=>/^\d+(:\d{2}){1,2}$/.test(r.text))?.text;
      const duration=durationText?durationText.split(':').reduce((n,v)=>n*60+Number(v),0):0;
      const artist=owner?.text || runs.find(r=>r.text &&
        !/^\s*(?:[•·]|Song|Video|Episode|Podcast|Album|Single|EP|Explicit|\d{1,3}(?::\d{2}){1,2}|\d{4}|[\d.,]+[KMB]?\s+(?:plays?|views?|likes?))\s*$/i.test(r.text) &&
        r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType!=='MUSIC_PAGE_TYPE_ALBUM')?.text || '';
      const albumRun=runs.find(r=>r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==='MUSIC_PAGE_TYPE_ALBUM');
      const album=albumRun?.text || '';
      const artists=runs.filter(r=>r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType==='MUSIC_PAGE_TYPE_ARTIST' || r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
        .map(r=>({id:r.navigationEndpoint.browseEndpoint.browseId,name:r.text}));
      const musicType=nav.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType||d.musicVideoType||'';
      const mediaType=/OMV|UGC|LIVE/.test(musicType)||runs.some(r=>/^video$/i.test(r.text))?'video':/ATV/.test(musicType)?'song':undefined;
      const track={mediaType,source:'youtube',id:watch,title,artist,channelId:owner?.navigationEndpoint?.browseEndpoint?.browseId || '',artists,album,albumId:albumRun?.navigationEndpoint?.browseEndpoint?.browseId || '',duration,artwork,categoryId:'10'};
      if(keepRepeats && typeof d.playlistItemData?.playlistSetVideoId==='string')track.playlistEntryId=d.playlistItemData.playlistSetVideoId;
      tracks.push(track);
      const heading=card.closest('ytmusic-carousel-shelf-renderer,ytmusic-shelf-renderer')?.querySelector('#title,h2')?.textContent||'';
      if(/new release|new from your artist/i.test(heading))releases.push(track);
    }else if(browse?.browseId?.startsWith('VL') || playlistId){
      const id=browse?.browseId?.startsWith('VL')?browse.browseId.slice(2):playlistId;
      if(seen.has('VL'+id))continue;
      seen.add('VL'+id);
      const count=runs.map(r=>r.text).join('').match(/([\d,]+)\s+(?:songs?|videos?)/i);
      playlists.push({id,title,artist:owner?.text || '',artwork,count:count?Number(count[1].replaceAll(',','')):undefined,source:'youtube'});
    }else if(type==='MUSIC_PAGE_TYPE_ALBUM' && !seen.has(browse.browseId)){
      seen.add(browse.browseId);
      const year=runs.find(r=>/^(?:19|20)\d{2}$/.test(r.text||''))?.text;
      const labels=[...runs.filter(r=>!r.navigationEndpoint).map(r=>r.text),d.subtitle?.simpleText];
      const releaseType=labels.flatMap(label=>String(label||'').toLowerCase().split(/[·•]/u).map(t=>t.trim()))
        .find(token=>token==='album'||token==='single'||token==='ep');
      albums.push({kind:'album',id:browse.browseId,title,artwork,artist:owner?.text||'',...(releaseType?{releaseType}:{}),...(year?{year}:{})});
    }else if(type==='MUSIC_PAGE_TYPE_ARTIST' && !seen.has(browse.browseId)){
      seen.add(browse.browseId);artists.push({kind:'artist',id:browse.browseId,title,artwork});
    }
  }
  return {tracks,playlists,artists,albums,releases,cardCount:cards.length};
}

// These functions run inside the first-party document. The search response and
// the recycled Polymer rows can commit independently during an in-page search.
function prepareSearchInput(query){
  const input=document.querySelector('ytmusic-search-box input');
  if(!input)return false;
  const page=document.querySelector('ytmusic-search-page:not([hidden])');
  const first=page?.querySelector('ytmusic-card-shelf-renderer,ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer');
  input[Symbol.for('desktop.music.search')]= {query,pageData:page?.data,firstData:first?.data};
  input.focus();
  input.value=query;
  input.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
  return document.activeElement===input;
}
function searchResponseReady(query){
  const page=document.querySelector('ytmusic-search-page:not([hidden])');
  const previous=document.querySelector('ytmusic-search-box input')?.[Symbol.for('desktop.music.search')];
  if(!page?.data || previous?.query!==query || page.data===previous.pageData)return false;
  if(page.querySelector('ytmusic-message-renderer'))return true;
  const first=page.querySelector('ytmusic-card-shelf-renderer,ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer');
  return !!first?.data && first.data!==previous.firstData;
}
async function readAccount(expand=false){
  const cfg=window.ytcfg;
  const connected=cfg?.get?.('LOGGED_IN');
  if(typeof connected!=='boolean')return null;
  if(!connected)return {connected:false,name:'',identifier:''};

  const menu='ytd-active-account-header-renderer,ytmusic-active-account-header-renderer,ytd-identity-chip-renderer';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  let header=document.querySelector(menu);
  let button;
  if(expand && !header){
    for(let i=0;i<16 && !button;i++){
      button=document.querySelector('ytmusic-settings-button yt-icon-button,button#avatar-btn');
      if(!button)await pause(100);
    }
    if(button){
      button.click();
      for(let i=0;i<24 && !header;i++){await pause(100);header=document.querySelector(menu);}
    }
  }
  const text=id=>header?.querySelector(id)?.textContent?.trim() || '';
  const avatarImage=document.querySelector('ytmusic-settings-button img,button#avatar-btn img');
  const avatarSources=[header?.querySelector('#avatar img,#avatar-image')?.src,
    document.querySelector('ytmusic-settings-button yt-img-shadow')?.getAttribute('delayed-src'),avatarImage?.src];
  const avatar=avatarSources.find(src=>typeof src==='string' && /^https:\/\//.test(src)) || '';
  const name=text('#account-name,#name') || (avatarImage?.alt && !/account|avatar|profile|photo/i.test(avatarImage.alt)?avatarImage.alt:'') || '';
  const email=text('#email'),handle=text('#channel-handle,#handle');
  const identifier=cfg.get('DATASYNC_ID') || cfg.get('DELEGATED_SESSION_ID') || email || handle || avatar;
  if(button && header)button.click();
  return {connected:true,name:name||'YouTube Music account',avatar,email,handle,identifier};
}
function readQueue(id,playlistId,displayTitle,limit=1000){
  const queue=document.querySelector('ytmusic-player-queue');
  if(!queue)return null;
  if(!queue.hasAttribute('autoplay-enabled') && queue.querySelector('#automix[aria-checked="false"]')){
    // Explicit queue items are always available; suggested automix is optional.
    return queueRows(queue.querySelector('#contents') || queue,id,playlistId);
  }
  return queueRows(queue,id,playlistId);

  function queueRows(parent,id,context){
    const rows=Array.from(parent.querySelectorAll('ytmusic-player-queue-item'));
    let selected=rows.findIndex(el=>el.hasAttribute('selected') && el.data?.videoId===id);
    if(selected<0){
      const player=document.querySelector('#movie_player'),actual=player?.getVideoData?.();
      const clean=value=>String(value||'').toLowerCase().replace(/\s*[\[(](?:official\s+)?(?:music\s+video|video|audio)[\])]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
      const titles=new Set([clean(actual?.title),clean(displayTitle)].filter(Boolean));
      if(actual?.video_id===id&&titles.size)selected=rows.findIndex(el=>el.hasAttribute('selected')&&titles.has(clean(el.data?.title?.runs?.map(r=>r.text).join('')||el.data?.title?.simpleText)));
    }
    if(selected<0)return null;
    const text=value=>value?.simpleText || value?.runs?.map(r=>r.text).join('') || '';
    const tracks=[];
    for(const row of rows.slice(selected+1,selected+1+limit)){
      const info=row.data;
      if(!info || !/^[\w-]{11}$/.test(info.videoId))continue;
      const duration=text(info.lengthText).split(':').reduce((time,part)=>time*60+Number(part),0);
      tracks.push({id:info.videoId,source:'youtube',title:text(info.title),artist:(info.shortBylineText?.runs||[]).filter(r=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')).map(r=>r.text).join(' & ') || text(info.shortBylineText),
        duration:Number.isFinite(duration)?duration:0,artwork:info.thumbnail?.thumbnails?.at(-1)?.url || '',
        playlistId:info.navigationEndpoint?.watchEndpoint?.playlistId || context || undefined,categoryId:'10'});
    }
    return tracks;
  }
}
function completePlaylistOrder(tracks){
  // The same recording can occur repeatedly. playlistSetVideoId uniquely
  // identifies an occurrence; duplicate occurrence IDs mean the service
  // appended overlapping pages, not that the user added a song twice.
  const entries=tracks.map(t=>t.playlistEntryId).filter(Boolean);
  return entries.length===new Set(entries).size;
}

async function applyPlaylistSort(sort){
  const labels={default:'Default ordering',newest:'Newest first',oldest:'Oldest first'};
  const label=labels[sort];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const findMenu=()=>document.querySelector('ytmusic-browse-response:not([hidden]) yt-sort-filter-sub-menu-renderer');
  let menu=findMenu();
  if(!menu && sort==='default')return true;
  for(let i=0;i<24 && !menu;i++){await pause(100);menu=findMenu();}
  const options=()=>findMenu()?.data?.subMenuItems || [];
  const choice=options().find(item=>item.title===label);
  if(!choice)return sort==='default';
  if(choice.selected)return true;
  const trigger=menu.querySelector('tp-yt-paper-button,[role=button]');
  if(!trigger)return false;
  trigger.click();
  const option=()=>Array.from(menu.querySelectorAll('[role=option]')).find(el=>el.textContent.trim()===label);
  let button=option();
  for(let i=0;i<12 && !button;i++){await pause(90);button=option();}
  if(!button)return false;
  button.click();
  // The sort is a server-rendered view change. Wait for the site to confirm its
  // selection before reading rows; the previous order can remain for a frame.
  for(let i=0;i<80;i++){
    if(options().some(item=>item.title===label && item.selected))return true;
    await pause(100);
  }
  return false;
}
function playerCommand(name,value){
  const media=document.querySelector('#movie_player video.html5-main-video') || document.querySelector('#movie_player video');
  if(!media)return false;
  const player=document.querySelector('#movie_player'),ad=player?.classList.contains('ad-showing')||player?.classList.contains('ad-interrupting');
  if(name==='next'||name==='previous'){
    const button=document.querySelector(name==='next'?'ytmusic-player-bar .next-button':'ytmusic-player-bar .previous-button');
    if(!button || button.disabled || ad)return false;
    button.click();return true;
  }
  if(name==='play'){if(typeof player?.playVideo==='function'){player.playVideo();return true;}return media.play().then(()=>true).catch(()=>false);}
  if(name==='pause'||name==='stop'){if(typeof player?.pauseVideo==='function')player.pauseVideo();else media.pause();return true;}
  if(name==='seek' && !ad && Number.isFinite(media.duration)){
    const target=Math.min(media.duration,Math.max(0,value));
    const sliders=[...document.querySelectorAll('tp-yt-paper-slider#progress-bar')];
    const slider=sliders.find(node=>node.getClientRects().length&&Math.abs(Number(node.max)-media.duration)<2)||sliders.find(node=>Math.abs(Number(node.max)-media.duration)<2);
    // Use Music's scrubber event so its stream loader requests the seek range,
    // not just the HTML media clock. Keep one canonical control per gesture.
    if(slider){slider.value=target;slider.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}
    else if(typeof player?.seekTo==='function')player.seekTo(target,true);
    else media.currentTime=target;
    return true;
  }
  if(name==='volume'){const level=Math.max(0,Math.min(1,value));if(typeof player?.setVolume==='function')player.setVolume(level*100);else media.volume=level;return true;}
  return false;
}
class MusicSession {
  constructor({onEvent=()=>{},onAccount=()=>{},dir,animationsEnabled=()=>true,queueOwnedByApp=()=>false}={}) {
    this.animationsEnabled=animationsEnabled;this.queueOwnedByApp=queueOwnedByApp;
    if(dir)this.cacheFile=path.join(dir,'service-library.json');
    this.onEvent=onEvent;this.onAccount=onAccount;this.data=empty();this.profile={connected:false,name:''};this.identityChecked=false;
    this.message='';this.epoch=0;this.seq=0;this.readTail=Promise.resolve();this.windows=new Set();
    this.playlistCache=new Map();this.searchCache=new Map();this.searchSequence=0;this.recommendationTail=Promise.resolve();
    this.readerTimers=new Map();this.metadataTail=Promise.resolve();
  }
  status(){
    const browser=this.browserFlow?.status();
    const finishing=!!this.browserFinish;
    const message=this.browserError || (finishing?'Confirming this sign-in with YouTube Music.':browser?.message) || '';
    return {...this.profile,configured:true,identityChecked:this.identityChecked,syncing:!!this.syncTask,signingIn:!!this.auth,playbackAvailable:!!this.player,message:this.message,syncStage:this.syncStage||'',collectionErrors:this.collectionErrors||[],
      browserSignIn:{active:!!browser?.active||finishing,canComplete:!!browser?.canComplete,busy:!!browser?.busy||finishing,
        phase:finishing?'finishing':this.browserError?'error':browser?.active?'waiting':'idle',message}};
  }
  snapshot(){return this.data;}

  clearCache(){
    clearTimeout(this.cacheTimer);this.cacheTimer=null;
    this.dirtyCollections=null;this.restoredOwner=null;
    if(this.cacheFile){
      try{fs.rmSync(this.cacheFile,{force:true});}catch{}
    }
  }

  restoreCache(profile){
    if(!this.cacheFile)return;
    if(!profile.connected){this.clearCache();return;}
    if(!profile.id)return;
    this.restoredOwner=profile.id;
    try{
      const cached=JSON.parse(fs.readFileSync(this.cacheFile,'utf8'));
      if(cached.version!==1 || cached.id!==profile.id){this.clearCache();this.restoredOwner=profile.id;return;}
      const data=empty();
      for(const [key,initial] of Object.entries(data)){
        if(Array.isArray(initial) && Array.isArray(cached.collections?.[key]))data[key]=cached.collections[key];
      }
      if(typeof cached.collections?.syncedAt==='string')data.syncedAt=cached.collections.syncedAt;
      this.data=data;
      this.fillProfile(profile,cached.profile);
    }catch{}
  }

  fillProfile(profile,last){
    if((!profile.name || profile.name==='YouTube Music account') && last?.name)profile.name=last.name;
    for(const key of ['avatar','handle','email'])if(!profile[key] && typeof last?.[key]==='string')profile[key]=last[key];
  }
  cacheCollections(now=false,keys=[]){
    if(!this.cacheFile || !this.profile.connected || !this.profile.id)return;
    if(!this.dirtyCollections || this.dirtyCollections.owner!==this.profile.id)this.dirtyCollections={owner:this.profile.id,keys:new Set()};
    const dirty=this.dirtyCollections.keys;
    for(const key of keys)if(Object.hasOwn(this.data,key))dirty.add(key);
    if(!dirty.size)return;
    if(!now){
      if(!this.cacheTimer)this.cacheTimer=setTimeout(()=>this.cacheCollections(true),1600);
      return;
    }
    clearTimeout(this.cacheTimer);this.cacheTimer=null;
    const {id}=this.profile;
    try{
      let prior;
      try{const saved=JSON.parse(fs.readFileSync(this.cacheFile,'utf8'));if(saved.version===1 && saved.id===id)prior=saved;}catch{}
      // This session may have read just history or one playlist. Only the
      // fields it actually fetched or changed can replace the previous copy.
      const collections=Object.fromEntries(Object.entries(empty()).map(([key,initial])=>[key,dirty.has(key)?this.data[key]:(prior?.collections?.[key]??initial)]));
      const {name,avatar,handle,email}=this.profile;
      const profile={name,avatar,handle,email};this.fillProfile(profile,prior?.profile);
      fs.writeFileSync(this.cacheFile+'.tmp',JSON.stringify({version:1,id,profile,collections}),{mode:0o600});
      fs.renameSync(this.cacheFile+'.tmp',this.cacheFile);
      dirty.clear();
    }catch{try{fs.rmSync(this.cacheFile+'.tmp',{force:true});}catch{}}
  }

  notify(){if(!this.closed)this.onAccount(this.status());}
  attachHost(host){
    if(this.host===host)return;
    if(this.host && !this.host.isDestroyed()){
      this.host.removeListener('resize',this.resizePlayer);
      this.host.removeListener('resized',this.resizePlayer);
      if(this.playerView)this.host.contentView.removeChildView(this.playerView);
    }
    this.host=host;
    this.resizePlayer=()=>{
      if(!this.playerView || !this.host || this.host.isDestroyed())return;
      const [width,height]=this.host.getContentSize();
      if(this.mode==='video' && this.videoBounds && !this.adVisible && !this.manualOfficial){
        const rect=this.cinema?{x:0,y:0,width,height}:this.videoBounds;
        const x=Math.max(0,rect.x),y=Math.max(0,rect.y);
        const w=Math.min(width,rect.x+rect.width)-x,h=Math.min(height,rect.y+rect.height)-y;
        if(w<48 || h<48){this.playerView.setVisible(false);return false;}
        const bounds={x,y,width:w,height:h},key=JSON.stringify(bounds);
        if(this.videoRect!==key||this.videoRectView!==this.playerView){
          this.playerView.setBounds(bounds);
          this.videoRect=key;this.videoRectView=this.playerView;
        }
        const dimensions=w+'x'+h;if(this.videoDimensions!==dimensions){this.videoDimensions=dimensions;void this.run(this.player,frameVideo,true,w,h).catch(()=>{});}
        return true;
      }
      if(!this.adVisible && !this.manualOfficial){
        // The shell can be a 344px mini player while its audio source stays
        // hidden. Keep the source controls in their stable desktop layout.
        this.videoRect='';this.playerView.setBounds({x:0,y:0,width:900,height:680});return;
      }
      this.videoRect='';const compact=width<660;
      const w=compact?Math.max(1,width-16):Math.min(580,width-32);
      const h=Math.max(1,Math.min(compact?height-104:height-165,compact?430:460));
      this.playerView.setBounds({x:compact?8:width-w-16,y:compact?34:58,width:w,height:h});
    };
    host?.on('resize',this.resizePlayer);host?.on('resized',this.resizePlayer);
    if(this.playerView && host){
      host.contentView.addChildView(this.playerView);this.resizePlayer();
    }
  }

  forwardVideoPointer(event,input){
    if(this.cinema)return; // The source preload guards video clicks and owns its full-screen controls.
    if(this.mode!=='video' || this.adVisible || this.manualOfficial || !this.videoBounds || !this.host || this.host.isDestroyed())return;
    // Electron's native child view sits above the shell renderer. Send the
    // gesture to the shell in its coordinate space so video cannot toggle the
    // site player or steal clicks meant for the app's own controls.
    const bounds=this.playerView.getBounds();
    event.preventDefault();
    const forwarded={...input,x:Math.round(bounds.x+input.x),y:Math.round(bounds.y+input.y)};
    if(input.type==='mouseDown')this.host.webContents.focus();
    this.host.webContents.sendInputEvent(forwarded);
  }
  showOfficial(){
    if(this.resizePlayer?.()!==false)this.playerView?.setVisible(true);
  }

  hideOfficial(){
    this.manualOfficial=false;
    if(this.adVisible || (this.mode==='video' && this.videoBounds))this.showOfficial();
    else {this.playerView?.setVisible(false);this.resizePlayer?.();}
  }

  window(role,visible=false) {
    const {BrowserWindow,WebContentsView}=require('electron');
    const standby=role==='standby',player=role==='player'||standby;
    const webPreferences={session:this.partition,nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:!player,
      autoplayPolicy:player?'no-user-gesture-required':'document-user-activation-required',...(player?{preload:path.join(__dirname,'session-preload.cjs')}:{})};
    let win;
    if(player){
      const view=new WebContentsView({webPreferences});if(!standby)this.playerView=view;
      const webContents=view.webContents;
      view.setBounds({x:0,y:0,width:900,height:680});view.setVisible(false);
      if(this.host && !this.host.isDestroyed()){
        this.host.contentView.addChildView(view);if(!standby)this.resizePlayer();
      }
      webContents.on('before-mouse-event',(event,input)=>this.forwardVideoPointer(event,input));
      webContents.on('before-input-event',(event,input)=>{
        if(input.type==='keyDown'&&this.cinema&&[' ','Space','Escape'].includes(input.key)){event.preventDefault();if(input.isAutoRepeat)return;this.onEvent({type:'desktop-command',name:input.key==='Escape'?'exitCinema':'toggle'});return;}
        if(input.type==='keyDown' && input.key==='Escape' && this.manualOfficial){
          event.preventDefault();this.hideOfficial();this.host?.webContents.focus();
        }
      });
      if(standby)webContents.setAudioMuted(true);
      win={view,webContents,loadURL:url=>webContents.loadURL(url),isDestroyed:()=>webContents.isDestroyed(),
        destroy:()=>{if(this.host && !this.host.isDestroyed())this.host.contentView.removeChildView(view);webContents.close();}};
      const restorePresentation=()=>{
        if(this.closed || this.player!==win || !this.active)return;
        if(this.mode==='video' && !this.manualOfficial){
          void this.run(win,frameVideo,true).catch(()=>{});
          if(this.videoBounds)this.showOfficial();
        }
        webContents.send?.('music:cinema',{enabled:!!this.cinema,track:this.active.track,volume:this.volume});
      };
      webContents.on('dom-ready',restorePresentation);
      webContents.on('did-navigate-in-page',restorePresentation);
      webContents.once('destroyed',()=>this.windows.delete(win));
    }else{
      win=new BrowserWindow({title:role==='auth'?'Sign in to YouTube Music':'YouTube Music',width:1040,height:760,show:visible,webPreferences});
      if(role!=='auth')win.webContents.setAudioMuted(true);
      win.on('closed',()=>this.windows.delete(win));
    }
    if(!player&&role!=='auth')win.webContents.on('media-started-playing',()=>{void this.run(win,playerCommand,'pause').catch(()=>{});});
    win.role=role;this.windows.add(win);
    const guard=event=>guardNavigation(event,host=>{
      if(role==='auth'){
        this.message=host ? 'Google sign-in requested a page on '+host+' that this window could not open.' : 'Google sign-in could not open its next page.';
        this.notify();
      }
    });
    win.webContents.on('will-navigate',guard);win.webContents.on('will-redirect',guard);
    win.webContents.setWindowOpenHandler(({url})=>{
      if(role==='auth' && allowedURL(url))void win.loadURL(url).catch(()=>{});
      return {action:'deny'};
    });
    return win;
  }
  acquireReader(field,role){
    clearTimeout(this.readerTimers.get(field));this.readerTimers.delete(field);
    if(!this[field] || this[field].isDestroyed())this[field]=this.window(role);
    return this[field];
  }
  releaseReader(field,reader,delay=0){
    if(this[field]!==reader)return;
    clearTimeout(this.readerTimers.get(field));this.readerTimers.delete(field);
    const release=()=>{
      this.readerTimers.delete(field);
      if(this[field]!==reader)return;
      this[field]=null;
      if(!reader.isDestroyed())reader.destroy();
    };
    if(!delay || this.closed){release();return;}
    const timer=setTimeout(release,delay);timer.unref?.();this.readerTimers.set(field,timer);
  }
  clearReaderTimers(){
    for(const timer of this.readerTimers.values())clearTimeout(timer);
    this.readerTimers.clear();
  }
  readMetadata(task){
    const epoch=this.epoch;
    const request=this.metadataTail.then(()=>{
      if(this.closed || epoch!==this.epoch)throw Error('The YouTube Music account changed.');
      return task();
    });
    this.metadataTail=request.catch(()=>{});return request;
  }
  async run(win,fn,...args){
    if(!win||win.isDestroyed()||new URL(win.webContents.getURL()||'about:blank').origin!==ORIGIN) throw Error('YouTube Music is not ready.');
    const work=win.webContents.executeJavaScript('('+fn.toString()+')(...'+JSON.stringify(args)+')',false);
    if(win===this.player||win===this.prepared?.window||win.role==='auth')return work;
    // A background scrape must not pin a renderer core indefinitely. Cached
    // collections remain available if a disposable reader stops responding.
    let timer;try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{if(!win.isDestroyed())win.destroy();reject(Error('The background music page stopped responding. Try again.'));},5000);timer.unref?.();})]);}finally{clearTimeout(timer);}
  }
  async updateQueue(id,generation){
    const request=this.active;
    if(!request||this.modeTransition)return;if(this.queueRead===request){this.queueDirty=request;return;}
    clearTimeout(this.queueRetry);this.queueRead=request;let retry=false;
    request.queueAttempts=(request.queueAttempts||0)+1;
    try{
      const rows=await this.run(this.player,readQueue,id,request.playlistId,request.track?.title,this.queueOwnedByApp()?2:1000);
      if(this.closed||this.active!==request||this.modeTransition)return;if(!rows){retry=true;return;}
      const tracks=mergeRecordingVariants(rows,request.track);retry=!tracks.length;this.sourceQueue={active:request,tracks};
      const kept=new Set(tracks.map(track=>track.id));
      this.nativeNext={active:request,id:rows[0]?.id,skipIds:rows.filter(track=>!kept.has(track.id)||recordingKey(track)===recordingKey(request.track)).map(track=>track.id)};
      const [categories,av]=await Promise.all([this.run(this.player,queueCategories),this.run(this.player,avState)]);
      if(this.active!==request || this.closed)return;
      if(av && this.videoAvailable!==av.available){this.videoAvailable=av.available;this.notifyMode();}
      if(av&&!av.available&&this.partition){void this.resolveVideo(request.track).then(video=>{if(video&&this.active===request&&!this.closed){this.videoAvailable=true;this.notifyMode();}}).catch(()=>{});}
      const signature=JSON.stringify([generation,id,tracks,categories]);
      if(this.queueSignature!==signature){
        this.queueSignature=signature;
        this.onEvent({type:'queue',id,generation,tracks,categories});
      }
    }catch{}finally{
      if(this.queueRead===request)this.queueRead=null;
      const dirty=this.queueDirty===request;if(dirty)this.queueDirty=null;
      if(!this.closed&&this.active===request&&(dirty||(retry&&request.queueAttempts<5))){this.queueRetry=setTimeout(()=>{void this.updateQueue(id,generation);},dirty?100:request.queueAttempts*500);this.queueRetry.unref?.();}
    }
  }

  notifyMode(){
    if(this.active)this.onEvent({type:'mode',id:this.active.id,generation:this.active.generation,mode:this.mode||'song',videoAvailable:!!this.videoAvailable});
  }
  async queueControls(active,change){
    const deadline=Date.now()+2400;
    for(;;){
      if(this.closed || this.active!==active)throw Error('The playing recording changed.');
      const value=await this.run(this.player,queuePlaybackSettings,active.id,change);
      if(this.closed || this.active!==active)throw Error('The playing recording changed.');
      if(!value.error)return value;
      // Playback can begin before the miniplayer and its replacement buttons
      // finish mounting. Pending responses have never clicked a control.
      if(!value.pending || Date.now()>=deadline)throw Error(value.error);
      await wait(90);
    }
  }
  async playbackSettings(){
    const active=this.active;
    if(!active || !this.player)throw Error('Choose a playing YouTube Music recording.');
    const value=await this.queueControls(active);
    const signature=JSON.stringify([active.generation,active.id,value.shuffle,value.repeat]);
    if(this.settingsSignature!==signature){
      this.settingsSignature=signature;
      this.onEvent({type:'settings',id:active.id,generation:active.generation,...value});
    }
    return value;
  }
  setPlaybackSettings(request){
    if(!request || typeof request!=='object' || !Object.keys(request).length ||
      Object.keys(request).some(k=>!['shuffle','repeat'].includes(k)) ||
      (Object.hasOwn(request,'shuffle') && typeof request.shuffle!=='boolean') ||
      (Object.hasOwn(request,'repeat') && !['off','all','one'].includes(request.repeat))){
      return Promise.reject(Error('Choose a valid shuffle or repeat setting.'));
    }
    const active=this.active;
    const run=async()=>{
      const current=()=>active && this.active===active && !this.closed;
      if(!current())throw Error('The playing recording changed.');
      let state=await this.playbackSettings();
      for(const key of ['shuffle','repeat']){
        if(!Object.hasOwn(request,key))continue;
        const seen=new Set();
        while(state[key]!==request[key]){
          if(!current())throw Error('The playing recording changed.');
          const before=state[key];
          if(seen.has(before))throw Error('YouTube Music could not apply the requested '+key+' setting.');
          seen.add(before);
          await this.queueControls(active,key);
          const deadline=Date.now()+2200;
          do {
            if(!current())throw Error('The playing recording changed.');
            state=await this.playbackSettings();
            if(state[key]!==before)break;
            await wait(60);
          }while(Date.now()<deadline);
          if(state[key]===before)throw Error('YouTube Music did not confirm that '+key+' changed.');
        }
      }
      if(request.shuffle!==undefined)void this.updateQueue(active.id,active.generation).catch(()=>{});
      return state;
    };
    const task=(this.settingsTail||Promise.resolve()).then(run);this.settingsTail=task.catch(()=>{});return task;
  }
  setVideoBounds(bounds){
    const valid=bounds && ['x','y','width','height'].every(k=>Number.isFinite(bounds[k])) && bounds.width>0 && bounds.height>0;
    this.videoBounds=valid?Object.fromEntries(['x','y','width','height'].map(k=>[k,Math.round(bounds[k])])):null;
    if(!valid)this.embeddedVideoBounds=null;else if(bounds.presentation!=='cinema')this.embeddedVideoBounds=this.videoBounds;
    if(this.mode==='video' && !this.manualOfficial && !this.adVisible){
      if(this.videoBounds)this.showOfficial();else this.playerView?.setVisible(false);
    }
  }
  async resolveVideo(track,urgent=false){
    if(track?.mediaType==='video')return track;
    this.videoCache ||= new Map();const key=recordingKey(track);
    const cached=this.videoCache.get(key);if(cached?.expires>Date.now())return cached.value;
    this.videoRequests ||= new Map();if(this.videoRequests.has(key))return this.videoRequests.get(key);
    const epoch=this.epoch;
    const task=(async()=>{
    const rows=await this.search([track.artist,track.title,'official music video'].join(' '),{interactive:urgent});
    const match=rows.find(row=>recordingKey(row)===key&&row.mediaType==='video')||rows.find(row=>recordingKey(row)===key&&/official.*video|music video/i.test(row.title));
    const video=match?{...match,title:track.title,artist:track.artist,album:track.album,albumId:track.albumId,artwork:track.artwork||match.artwork,mediaType:'video'}:null;
    if(this.epoch!==epoch||this.closed)return null;
    if(video){this.audioForVideo ||= new Map();this.audioForVideo.set(video.id,track);}
    this.videoCache.set(key,{value:video,expires:Date.now()+(video?3600000:60000)});return video;
    })().finally(()=>{if(this.videoRequests.get(key)===task)this.videoRequests.delete(key);});
    this.videoRequests.set(key,task);return task;
  }

  setCinema(enabled){
    const changed=this.cinema!==!!enabled;this.cinema=!!enabled;this.videoIntent=!!enabled;
    if(!enabled){if(this.embeddedVideoBounds)this.videoBounds=this.embeddedVideoBounds;this.host?.webContents?.focus?.();}
    if(this.mode==='video'&&this.videoBounds)this.showOfficial();
    this.player?.webContents.send?.('music:cinema',{enabled:this.cinema,track:this.active?.track,volume:this.volume});
    if(changed&&this.mode==='video'&&!this.adVisible&&this.animationsEnabled())void this.run(this.player,animateVideoPresentation,this.cinema).catch(()=>{});
  }

  async setPlaybackMode(mode,force=false){
    if(!['video','song'].includes(mode)||!this.active)throw Error('Choose a playing YouTube Music recording.');
    if(!force&&!this.modeTransition&&this.mode===mode)return {mode,videoAvailable:!!this.videoAvailable};
    // One decoder swap owns its timestamp and queue identity until it commits.
    // A second toggle waits; selecting another song invalidates the transaction.
    if(this.modeTransition){
      const pending=this.modeTransition,generation=this.active.generation;
      await pending.task;
      if(this.active?.generation!==generation)throw Error('The selected song changed.');
      if(this.mode===mode)return {mode:this.mode,videoAvailable:!!this.videoAvailable};
    }
    const transition={generation:this.active.generation,seq:this.seq,mode,active:this.active};
    this.modeChangeSerial=(this.modeChangeSerial||0)+1;
    this.modeTransition=transition;this.modeChange=mode;
    transition.task=this.changePlaybackMode(mode,transition);
    try{return await transition.task;}
    catch(error){
      if(this.modeTransition===transition&&this.active?.generation===transition.generation&&this.seq===transition.seq){
        this.awaitingLoad=true;this.desired='pause';
        await this.run(this.player,playerCommand,'pause').catch(()=>{});
        this.onEvent({type:'error',id:transition.committed?this.active.id:transition.active.id,generation:transition.generation,message:error.message});
      }
      throw error;
    }
    finally{
      if(this.modeTransition===transition){
        this.modeTransition=null;this.modeChange=null;this.switchingCounterpart=null;
        void this.observePlayback();
      }
    }
  }
  async changePlaybackMode(mode,transition){
    const current=()=>!this.closed&&this.modeTransition===transition&&this.active?.generation===transition.generation&&this.seq===transition.seq;
    const check=()=>{if(!current())throw Error('The selected song changed.');};
    const original=transition.active,generation=transition.generation;
    const gesturePosition=this.seekTarget?.active===original?this.seekTarget.target:original.clock?.position;
    const available=await this.run(this.player,avState);check();
    let fallback;
    if(mode==='video'&&!available.available){
      const cached=this.videoCache?.get(recordingKey(original.track));
      fallback=cached?.expires>Date.now()?cached.value:null;
      if(!fallback){this.videoAvailable=false;this.notifyMode();return {mode:this.mode||'song',videoAvailable:false};}
    }
    if(mode==='song'&&!available.hasToggle&&available.selected==='video'){
      fallback=this.audioCounterpart?.track;
      if(!fallback)throw Error('The audio version is unavailable for this recording.');
    }
    if(mode==='video'&&(this.mode!=='video'||available.decoded==='song'))this.audioCounterpart={track:original.track};
    const pendingSeek=this.seekTarget?.active===original?this.seekTarget.target:undefined;
    const position=Number.isFinite(gesturePosition)?gesturePosition:Number.isFinite(pendingSeek)?pendingSeek:Number.isFinite(available.position)?available.position:0;
    // Cancel startup/seek work for the outgoing decoder even when the user
    // switches before the original play() promise has finished.
    this.playIntent=(this.playIntent||0)+1;transition.seq=++this.seq;
    this.seekSerial=(this.seekSerial||0)+1;this.seekTarget=null;
    if(mode==='song')this.videoIntent=false;
    this.onEvent({type:'state',id:original.id,generation,state:'buffering'});
    // Pause the outgoing stream so a shorter counterpart cannot end and advance
    // the provider queue before its position has been restored.
    await this.run(this.player,playerCommand,'pause');check();
    if(fallback){
      const desired=this.desired,loading=this.play(fallback,generation,this.volume,0,mode);
      this.desired=desired;
      transition.seq=this.seq+1;
      await loading;check();
      await this.run(this.player,playerCommand,'pause');check();
    }else if(!await this.run(this.player,avState,mode))throw Error('YouTube Music could not switch this recording.');
    const deadline=Date.now()+12000;let selected;
    while(Date.now()<deadline){
      check();const decoded=await this.run(this.player,avState);check();
      // aria-pressed changes before metadata and the media element are replaced.
      if(decoded.decoded===mode&&decoded.ready&&videoId(decoded.recording)&&
        recordingKey({...original.track,title:decoded.title})===recordingKey(original.track)){
        if(transition.pausedId!==decoded.recording){await this.run(this.player,playerCommand,'pause');check();transition.pausedId=decoded.recording;}
        // Music videos sometimes have longer intros/outros than the audio cut.
        // An out-of-range time restarts this song instead of ending the queue item.
        const target=position>=decoded.duration-.5?0:Math.max(0,position);
        if(await this.run(this.player,restorePosition,decoded.recording,target)){selected={...decoded,target};break;}
      }
      await wait(45);
    }
    check();if(!selected)throw Error('YouTube Music did not finish switching this recording. Try again.');
    const track={...original.track,...(fallback||{}),id:selected.recording,duration:selected.duration,
      title:original.track.title,artist:original.track.artist,artwork:original.track.artwork||fallback?.artwork};
    this.active={id:track.id,generation,track,playlistId:original.playlistId,clock:{position:selected.target,duration:selected.duration}};
    this.awaitingLoad=false;this.mode=mode;this.videoAvailable=mode==='video'||available.available;
    if(original.id!==track.id)this.onEvent({type:'track',id:track.id,generation,track,counterpart:true});
    transition.committed=true;
    this.onEvent({type:'progress',id:track.id,generation,position:selected.target,duration:selected.duration});
    await this.run(this.player,frameVideo,mode==='video'&&!this.manualOfficial);check();
    await this.run(this.player,playerCommand,this.desired||'pause');check();
    if(mode==='video'&&this.videoBounds)this.showOfficial();else this.hideOfficial();
    this.player.webContents?.send?.('music:cinema',{enabled:!!this.cinema,track,volume:this.volume});
    this.notifyMode();
    // Refresh queue only after canonical identity and clock commit together.
    setTimeout(()=>{if(this.active?.id===track.id&&this.active.generation===generation)void this.updateQueue(track.id,generation);},0);
    return {mode,videoAvailable:this.videoAvailable};
  }
  async queueCategory(id){
    const active=this.active;
    if(!active || typeof id!=='string' || id.length>240 || !await this.run(this.player,queueCategories,id))throw Error('This Up next filter is unavailable.');
    for(let i=0;i<30;i++){
      if(this.active!==active)throw Error('The selected song changed.');
      const categories=await this.run(this.player,queueCategories);
      if(categories.some(c=>c.id===id && c.selected)){
        await this.updateQueue(active.id,active.generation);return;
      }
      await wait(120);
    }
    throw Error('YouTube Music did not apply the Up next filter.');
  }

  async ensureAudioMode(active=this.active){
    if(!active||this.modeTransition||this.mode==='video'||this.modeChange==='video'||this.videoIntent||active.track?.mediaType==='video')return false;
    const av=await this.run(this.player,avState).catch(()=>null);
    if(this.active!==active||!av?.hasToggle||(av.decoded?av.decoded!=='video':av.selected!=='video'))return false;
    const recording=av.recording||active.id;
    if(this.audioSelection?.active===active&&this.audioSelection.recording===recording)return true;
    this.audioSelection={active,recording};await this.run(this.player,avState,'song');return true;
  }
  observePlayback(){
    if(this.playbackRead){this.playbackRead.pending=true;return this.playbackRead.task;}
    const read={player:this.player,active:this.active,seq:this.seq,modeSerial:this.modeChangeSerial,awaitingLoad:this.awaitingLoad,pending:false};this.playbackRead=read;
    read.task=(async()=>{
      try{
        const confirmed=read.active?.started?(read.active.clock?.duration||read.active.seekDuration||read.active.track?.duration):0;
        const data=await this.run(read.player,playbackSnapshot,read.active?.id,confirmed||0);
        if(this.closed || this.player!==read.player || this.active!==read.active || this.seq!==read.seq||this.modeChangeSerial!==read.modeSerial)return;
        if(data?.decoded==='video'&&await this.ensureAudioMode(read.active))return;
        if(this.active!==read.active||this.seq!==read.seq||this.modeChangeSerial!==read.modeSerial)return;
        if(data && (!read.awaitingLoad || ['ad','buffering','error'].includes(data.state)))this.receivePlayback(data);
      }catch{}finally{
        if(this.playbackRead===read)this.playbackRead=null;
        if(read.pending && !this.closed && this.player===read.player && this.active===read.active && this.seq===read.seq)void this.observePlayback();
      }
    })();return read.task;
  }
  receivePlayback(data){
    if(!this.active || this.closed)return;
    if(this.modeTransition?.generation===this.active.generation)return;
    if(data?.mediaId&&data.mediaId!==data.id)return;
    if(!videoId(data?.id) || !['playing','ad','buffering','paused','ended','error'].includes(data.state))return;
    const id=data.id,generation=this.active.generation;
    if(this.awaitingLoad && !['ad','buffering','error'].includes(data.state))return;
    const seeking=this.seekTarget?.active===this.active&&this.seekTarget.target<(this.active.seekDuration||this.active.track?.duration||Infinity)-.25;
    if(seeking&&(data.state==='ended'||id!==this.active.id))return;
    if(id!==this.active.id){
      if(this.awaitingLoad || !data.title || !['playing','paused'].includes(data.state) || !data.duration)return;
      const known=this.sourceQueue?.active===this.active?this.sourceQueue.tracks.find(track=>track.id===id):null;
      const track={id,source:'youtube',title:known?.title||String(data.title).slice(0,500),artist:known?.artist||String(data.artist||'').slice(0,500),
        artwork:String(data.artwork||'').slice(0,1500),duration:Number(data.duration)||0,categoryId:'10',playlistId:this.active.playlistId};
      const counterpart=(this.switchingCounterpart?.generation===generation && this.switchingCounterpart.until>=Date.now())||(!this.active.started&&recordingKey(track)===recordingKey(this.active.track));
      if(!this.active.started&&!counterpart){
        const selected=this.active;
        if(!selected.retried){selected.retried=true;this.awaitingLoad=true;void this.player.loadURL(ORIGIN+'/watch?v='+selected.id+'&t=0s').then(()=>{if(this.active!==selected)return;this.awaitingLoad=false;this.player.webContents.send?.('music:observe-first-party');return this.run(this.player,playerCommand,this.desired);}).catch(()=>{if(this.active===selected)this.onEvent({type:'error',...selected,message:'YouTube Music could not play this recording. Try again.'});});}
        else this.onEvent({type:'error',...selected,message:'This recording could not start. Select it again to retry.'});
        return;
      }
      this.switchingCounterpart=null;
      const displayTrack=counterpart?{...this.active.track,...track,title:this.active.track.title,artist:this.active.track.artist,artwork:this.active.track.artwork||track.artwork}:track;
      this.active={id,generation,track:displayTrack,playlistId:this.active.playlistId};this.onEvent({type:'track',id,generation,track:displayTrack,counterpart});
      this.player.webContents.send?.('music:cinema',{enabled:!!this.cinema,track:displayTrack,volume:this.volume});
      if(this.mode==='video')void this.run(this.player,frameVideo,true).catch(()=>{});
      void this.updateQueue(id,generation);
    }
    const clock=this.active.clock;
    if(data.state!=='ad'&&data.duration>0&&clock&&Math.abs(clock.duration-data.duration)>2)return;
    if(data.state!=='ad'&&data.duration>0&&Number.isFinite(data.position))this.active.clock={position:data.position,duration:data.duration};
    if(data.state==='playing'&&id===this.active.id)this.active.started=true;
    if(data.state==='playing' && this.lastQueueTrack!==this.active){
      this.lastQueueTrack=this.active;void this.updateQueue(id,generation);void this.playbackSettings().catch(()=>{});
    }
    if(data.state==='ad' && !this.adVisible){
      this.adVisible=true;this.showOfficial();
    }else if(this.adVisible && data.state!=='ad'){
      this.adVisible=false;if(!this.manualOfficial)this.hideOfficial();
    }
    if(data.state==='ended'){if(this.switchingCounterpart?.until>Date.now()||(this.seekTarget&&(data.position<data.duration-.15||Date.now()-(this.seekTarget.at||Date.now())<1500)))return;if(data.duration>0&&data.position>=data.duration-.15)this.onEvent({id,generation,type:'ended',position:data.position,duration:data.duration});return;}
    if(data.state==='error'){
      const recoveryKey=generation+':'+id;
      if(this.active.started&&this.desired==='play'&&this.recoveryFor!==recoveryKey){
        this.recoveryFor=recoveryKey;const active=this.active;
        const target=this.seekTarget?.active===active?this.seekTarget.target:active.clock?.position||0;
        this.onEvent({id,generation,type:'state',state:'buffering'});
        void this.play(active.track,generation,this.volume,target,this.mode||'song').catch(()=>{});return;
      }
      this.onEvent({id,generation,type:'error',message:data.message||'YouTube Music could not play this track.'});return;
    }
    const state=data.state==='ad'?'buffering':data.state;
    this.onEvent({id,generation,type:'state',state,ad:data.state==='ad'});
    if(data.state!=='ad' && data.duration>0 && Number.isFinite(data.position))this.onEvent({id,generation,type:'progress',position:data.position,duration:data.duration});
  }

  start(){
    if(this.player)return this.starting || Promise.resolve(this.status());
    const {app,session,ipcMain}=require('electron');
    this.cacheFile ||= path.join(app.getPath('userData'),'service-library.json');
    this.partition=session.fromPartition(PARTITION);this.partition.setPermissionRequestHandler((_w,_p,done)=>done(false));
    this.player=this.window('player');
    this.receive=(_event,data)=>{
      const frame=_event.senderFrame;
      const prepared=this.prepared;
      if(prepared&&frame&&_event.sender===prepared.window.webContents&&frame===prepared.window.webContents.mainFrame&&frame.origin===ORIGIN){
        if(data?.state==='ad'||data?.state==='playing')void this.run(prepared.window,playerCommand,'pause').catch(()=>{});
        return;
      }
      if(_event.sender!==this.player?.webContents || !frame || frame!==this.player.webContents.mainFrame || frame.origin!==ORIGIN || !this.active || this.closed)return;
      if(data?.kind==='desktop-command'&&['toggle','next','previous','seek','mute','volume','exitCinema'].includes(data.name)){this.onEvent({type:'desktop-command',name:data.name,value:data.value});return;}
      if(data?.kind==='queue'){
        if(this.active.id===data.id && new URL(frame.url).searchParams.get('v')===data.id)void this.updateQueue(data.id,this.active.generation);
        return;
      }
      if(data?.kind==='settings'){
        if(this.active.id===data.id && new URL(frame.url).searchParams.get('v')===data.id)void this.playbackSettings().catch(()=>{});
        return;
      }
      if(data?.kind==='loop'){
        const {id,generation}=this.active;
        if(!this.awaitingLoad && !this.adVisible && id===data.id && new URL(frame.url).searchParams.get('v')===id){this.active.clock=null;this.onEvent({type:'loop',id,generation});}
        return;
      }
      if(data?.kind==='observe')void this.observePlayback();
    };
    ipcMain.on('music:first-party-event',this.receive);
    const startupEpoch=this.epoch;
    this.starting=(async()=>{
      try{
        await this.player.loadURL(ORIGIN+'/');
        const account=await this.readIdentity(this.player);
        if(startupEpoch!==this.epoch || this.closed)return this.status();
        if(account){this.restoreCache(account);this.profile=account;this.identityChecked=true;this.notify();}
        const home=await this.collect(this.player,'tracks',false);
        if(startupEpoch===this.epoch && !this.active && !this.closed)this.data={...this.data,discover:home.tracks,releases:home.releases};
      }catch{if(startupEpoch===this.epoch && !this.active && !this.closed)this.message='YouTube Music could not load. Check your connection and try again.';}
      finally{this.starting=null;this.notify();}
      return this.status();
    })();
    return this.starting;
  }
  async readIdentity(win,expand=false){
    for(let i=0;i<20;i++){
      const result=await this.run(win,readAccount,expand).catch(()=>null);
      if(result){
        const {identifier,...profile}=result;
        if(typeof identifier==='string' && identifier)profile.id=createHash('sha256').update(identifier).digest('hex');
        return profile;
      }
      if(win.isDestroyed()||this.closed)return null;
      await wait(150);
    }
    return null;
  }
  signIn(){
    if(this.closed || this.disconnecting)throw Error('The account session is closing.');
    if(this.browserFlow || this.browserFinish || this.browserCancel)throw Error('Finish or cancel the Chrome sign-in first.');
    if(this.profile.connected)throw Error('Sign out before connecting another account.');
    this.browserError='';
    if(!this.player)void this.start();
    if(this.auth && !this.auth.isDestroyed()){this.auth.show();this.auth.focus();return this.status();}
    const auth=this.auth=this.window('auth',true);
    this.message='';this.notify();
    auth.on('closed',()=>{if(this.auth===auth){this.auth=null;this.notify();}});
    const inspect=async()=>{
      if(auth.isDestroyed() || this.auth!==auth)return;
      const u=new URL(auth.webContents.getURL()||'about:blank');
      if(u.hostname==='accounts.google.com'&&/rejected|denied|unsupported|blocked/i.test(u.pathname)){
        this.message='Google could not sign in using this window. Review the message from Google.';this.notify();return;
      }
      if(u.origin!==ORIGIN)return;
      const identity=await this.readIdentity(auth);
      if(identity?.connected && this.auth===auth) {
        this.profile=identity;this.identityChecked=true;this.message='';this.data=empty();this.epoch++;
        auth.close();this.notify();
      }
    };
    auth.webContents.on('did-finish-load',()=>void inspect().catch(()=>{}));
    auth.webContents.on('did-navigate-in-page',()=>void inspect().catch(()=>{}));
    // Prefer the site's own Sign in link so Google's locale, template, and return
    // parameters remain intact. A fresh session can be opened before Home loads.
    const target=new URL('https://accounts.google.com/ServiceLogin');
    const next=new URL('https://www.youtube.com/signin');
    next.search=new URLSearchParams({action_handle_signin:'true',app:'desktop',next:ORIGIN+'/'});
    target.search=new URLSearchParams({ltmpl:'music',service:'youtube',uilel:'3',passive:'true',continue:next.href});
    void (async()=>{
      const link=await this.run(this.player,()=>document.querySelector('a[href^="https://accounts.google.com/ServiceLogin"]')?.href).catch(()=>null);
      if(this.auth!==auth || auth.isDestroyed())return;
      const entry=URL.canParse(link) && new URL(link).origin==='https://accounts.google.com' ? link : target.href;
      await auth.loadURL(entry);
    })().catch(()=>{if(this.auth===auth){this.message='The Google sign-in page could not load.';this.notify();}});
    return this.status();
  }
  async startPasskeySignIn(){
    if(this.closed || this.browserCancel || this.disconnecting)throw Error('The account session is closing. Try again in a moment.');
    if(this.profile.connected)throw Error('Sign out before connecting another account.');
    if(this.browserFinish)return this.status();
    if(!this.player)void this.start();
    this.cancelSignIn();
    this.browserError='';
    if(!this.browserFlow){
      const {app}=require('electron');
      const {BrowserSignIn}=require('./browser-signin.cjs');
      this.browserFlow=new BrowserSignIn({dir:app.getPath('userData'),targetSession:this.partition,onStatus:()=>this.notify()});
    }
    const flow=this.browserFlow;
    try{
      await flow.start();
    }catch(error){
      if(this.browserFlow===flow){
        this.browserError=error.message;
        await flow.close();
        if(this.browserFlow===flow)this.browserFlow=null;
        this.notify();
      }
      throw error;
    }
    this.notify();return this.status();
  }

  completePasskeySignIn(){
    if(this.browserFinish)return this.browserFinish.then(()=>this.status());
    const flow=this.browserFlow;
    if(!flow || this.browserCancel || this.closed)throw Error('Start a Chrome sign-in first.');
    if(this.profile.connected)throw Error('Sign out before connecting another account.');
    const epoch=++this.epoch;
    const assertCurrent=()=>{
      if(this.closed || this.browserFlow!==flow || this.epoch!==epoch)throw Error('The Chrome sign-in was cancelled.');
    };
    this.browserError='';
    const operation=(async()=>{
      const candidate=await flow.complete();
      assertCurrent();
      if(!candidate.ok)throw Error(candidate.message || 'Finish signing in to YouTube Music in Chrome first.');
      // A transferred session is only a candidate. Always let the real service
      // authenticate it in a newly loaded top-level YouTube Music document.
      const verification=this.window('verify');
      let identity;
      try{
        await verification.loadURL(ORIGIN+'/');
        identity=await this.readIdentity(verification);
        assertCurrent();
      }finally{
        if(!verification.isDestroyed())verification.destroy();
      }
      if(!identity?.connected)throw Error('YouTube Music did not accept the Chrome session. Complete sign-in on YouTube Music and try again.');
      if(!this.active)await this.player.loadURL(ORIGIN+'/').catch(()=>{});
      assertCurrent();
      await flow.close();
      assertCurrent();
      this.profile=identity;this.identityChecked=true;this.data=empty();this.message='';this.browserFlow=null;
    })().catch(async error=>{
      // Cancellation waits for the helper's outstanding writes before clearing
      // the target partition. A failed or partially transferred login stays guest.
      if(this.browserFlow===flow && this.epoch===epoch){
        await this.partition.clearStorageData({storages:['cookies']});
        this.browserError=error.message;
        if(!flow.status().active){
          await flow.close();
          if(this.browserFlow===flow)this.browserFlow=null;
        }
      }
      throw error;
    }).finally(()=>{
      if(this.browserFinish===operation)this.browserFinish=null;
      this.notify();
      if(this.profile.connected && !this.closed && this.epoch===epoch)void this.sync().catch(()=>{});
    });
    this.browserFinish=operation;this.notify();
    return operation.then(()=>this.status());
  }

  cancelPasskeySignIn(){
    if(this.browserCancel)return this.browserCancel;
    const flow=this.browserFlow,finish=this.browserFinish;
    if(!flow && !finish){this.browserError='';this.notify();return Promise.resolve(this.status());}
    this.epoch++;this.browserFlow=null;this.browserError='';
    const cancellation=(async()=>{
      try{
        await flow?.cancel();
        if(finish){
          await finish.catch(()=>{});
          await this.partition.clearStorageData({storages:['cookies']});
        }
      }finally{
        this.browserCancel=null;this.notify();
      }
      return this.status();
    })();
    this.browserCancel=cancellation;
    return cancellation;
  }

  async collect(win,field,scroll=true,keepRepeats=false,onPage){
    let result,previousCount=-1,previousItems=0,stableSince=Date.now();
    while(!this.closed && !win.isDestroyed()){
      const status=await this.run(win,(scroll,field,keepRepeats)=>{
        const container=document.querySelector('ytmusic-browse-response:not([hidden]),ytmusic-search-page:not([hidden])') || document;
        const shelf=container.querySelector('ytmusic-playlist-shelf-renderer');
        const cardScope=keepRepeats && field!=='history' && shelf?shelf:container;
        const cards=cardScope.querySelectorAll(field==='history'?'ytmusic-responsive-list-item-renderer,ytmusic-multi-row-list-item-renderer':'ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer,ytmusic-card-shelf-renderer,ytmusic-multi-row-list-item-renderer,ytmusic-playlist-shelf-renderer ytmusic-playlist-panel-video-renderer');

        const scope=shelf || container;
        const continuations=[...scope.querySelectorAll('ytmusic-continuation-item-renderer,yt-next-continuation')].filter(el=>el.getClientRects().length>0);
        // The section's continuation loads sibling shelves (e.g. Suggestions)
        // and can carry the unsorted order. Scroll the playlist's own sentinel.
        if(scroll && continuations.length)continuations[0].scrollIntoView({block:'nearest',behavior:'instant'});
        else if(scroll){
          cards[cards.length-1]?.scrollIntoView({block:'end',behavior:'instant'});
        }
        const message=container.querySelector('ytmusic-message-renderer,ytmusic-item-section-renderer #message')?.textContent || '';
        const failed=/something went wrong|try again|page (?:isn.t|is not|not) available|couldn.t load|sign in to view/i.test(message) ||
          !!container.querySelector('ytmusic-error-screen-renderer,yt-error-screen-renderer,ytd-error-screen-renderer');
        return {size:cards.length,pending:continuations.length>0,empty:!!message.trim(),failed};
      },scroll,field,keepRepeats);
      const changed=status.size!==previousCount;
      if(changed){previousCount=status.size;stableSince=Date.now();}
      // While a continuation is loading, only count lightweight DOM nodes.
      // Parse and transfer large track arrays when a page changes or settles.
      const settled=!status.pending && Date.now()-stableSince>800;
      if(changed || !result || !previousItems || settled){
        result=field==='history'?await this.run(win,readHistory):await this.run(win,readPage,keepRepeats);
        const n=result[field]?.length||0;
        if(n>previousItems){onPage?.(result);previousItems=n;}
      }
      const count=result[field]?.length||0;
      const idle=Date.now()-stableSince;
      if(status.failed)throw Error('YouTube Music could not show this collection.');
      if(!scroll && count)return {...result,pendingContinuation:status.pending};
      if(!status.pending && ((result.cardCount>0 && idle>800) || (!result.cardCount && (status.empty || idle>4800))))return {...result,explicitEmpty:status.empty};
      if(status.pending && idle>14000)break;
      await wait(300);
    }
    throw Error('YouTube Music stopped loading before the complete collection was available. Please refresh and try again.');
  }
  readPageAt(url,field='tracks',scroll=true,keepRepeats=false,onPage,includeIdentity=false){
    if(!this.player)void this.start();
    const epoch=this.epoch;
    const call=this.readTail.then(async()=>{
      if(epoch!==this.epoch || this.closed)throw Error('The YouTube Music account changed.');
      const reader=this.acquireReader('reader','reader');
      await reader.loadURL(url);
      const identity=includeIdentity ? await this.readIdentity(reader,true) : null;
      let data;
      try{
        data=await this.collect(reader,field,scroll,keepRepeats,result=>{
          if(epoch===this.epoch && !this.closed)onPage?.(result);
        });
      }catch(error){
        // A usable profile can accompany a failed Home shelf. Continue with
        // the account's own collection pages instead of discarding its identity.
        if(!identity?.connected)throw error;
        data={tracks:[],releases:[],collectionUnavailable:true};
      }
      if(epoch!==this.epoch || this.closed)throw Error('The YouTube Music account changed.');
      return includeIdentity?{...data,identity}:data;
    });
    this.readTail=call.catch(()=>{});return call;
  }
  sync({allowCached=false}={}){
    const age=Date.now()-Date.parse(this.data.syncedAt);
    if(allowCached && this.identityChecked && this.profile.connected && this.restoredOwner===this.profile.id &&
      !this.collectionErrors?.length && age>=0 && age<1800000 && !this.syncTask)return Promise.resolve(this.data);
    if(this.syncTask && this.syncEpoch===this.epoch)return this.syncTask;
    let epoch=this.epoch;
    const current=()=>this.epoch===epoch && !this.closed;
    const assertCurrent=()=>{if(!current())throw Error('The YouTube Music account changed.');};
    const publish=fields=>{
      assertCurrent();
      this.data={...this.data,...fields};
      this.cacheCollections(false,Object.keys(fields));this.notify();
    };
    this.collectionErrors=[];
    this.syncStage='Profile';
    this.message='';
    const task=(async()=>{
      const home=await this.readPageAt(ORIGIN+'/','tracks',false,false,undefined,true);
      const identity=home.identity;
      assertCurrent();
      if(!identity)throw Error('YouTube Music could not confirm your account.');
      const changed=this.profile.connected && (!identity.connected || (this.profile.id && identity.id && this.profile.id!==identity.id));
      if(changed){
        this.syncEpoch=epoch=++this.epoch;
        this.clearCache();this.data=empty();
      }
      if(identity.connected && identity.id && this.restoredOwner!==identity.id)this.restoreCache(identity);
      if(identity.id && identity.id===this.profile.id)this.fillProfile(identity,this.profile);
      this.profile=identity;this.identityChecked=true;
      if(changed)this.notify();
      if(home.collectionUnavailable){this.collectionErrors.push('Home');this.notify();}
      else publish({discover:home.tracks,releases:home.releases});
      if(identity.connected){
        // Fetch first pages first, so the user can browse every collection even
        // while the official site paginates a long library.
        const sections=[
          ['Playlists','/library/playlists','playlists',page=>({playlists:page.playlists})],
          ['Liked songs','/playlist?list=LM','tracks',page=>({liked:page.tracks})],
          ['Recently played','/history','history',page=>({recent:page.tracks,history:page.history || []})],
          ['Library songs','/library/songs','tracks',page=>({songs:page.tracks})],
          ['Subscriptions','/library/subscriptions','artists',page=>({subscriptions:page.artists})]
        ];
        const partial=[];
        const load=async(section,all)=>{
          const [label,route,field,select]=section;
          assertCurrent();this.syncStage=label;this.notify();
          try{
            const update=(page,complete=false)=>{
              const fields=select(page);
              if(field==='history' && (this.historyRequest?.epoch===epoch || this.historyCompleteEpoch===epoch ||
                fields.history.length<this.data.history.length))delete fields.history;
              // While a page is incomplete retain the rest of any verified
              // cached collection. Replace it exactly when paging completes.
              if(!complete){
                for(const key of Object.keys(fields)){
                  const items=fields[key],existing=this.data[key];
                  if(!existing?.length || items.length>=existing.length)continue;
                  const id=key==='history'?item=>[item.track.id,item.playedOn||'',item.playedAt||''].join('|'):item=>item.id;
                  const remaining=new Map();
                  for(const item of items)remaining.set(id(item),(remaining.get(id(item))||0)+1);
                  fields[key]=[...items,...existing.filter(item=>{
                    const k=id(item),matches=remaining.get(k)||0;
                    if(!matches)return true;
                    remaining.set(k,matches-1);return false;
                  })];
                }
              }
              publish(fields);
            };
            const page=await this.readPageAt(ORIGIN+route,field,all,false,update);
            // A blank, still-mounting site document isn't proof that a
            // previously populated collection was removed from the account.
            if(!page[field]?.length && !page.explicitEmpty && Object.keys(select(page)).some(key=>this.data[key]?.length)){
              throw Error('YouTube Music did not confirm an empty collection.');
            }
            update(page,all || !page.pendingContinuation);
            if(!all && field!=='history' && page[field]?.length && page.pendingContinuation)partial.push(section);
            this.collectionErrors=this.collectionErrors.filter(x=>x!==label);
          }catch(error){
            assertCurrent();
            if(!this.collectionErrors.includes(label))this.collectionErrors.push(label);
            this.message='Could not finish loading '+this.collectionErrors.join(', ')+'.';
            this.notify();
          }
        };
        for(const section of sections)await load(section,false);
        if(!allowCached)for(const section of partial)await load(section,true);
      }
      assertCurrent();
      this.message=this.collectionErrors.length?'Could not finish loading '+this.collectionErrors.join(', ')+'.':'';
      this.data={...this.data,syncedAt:this.collectionErrors.length?null:new Date().toISOString()};
      this.cacheCollections(true,['syncedAt']);return this.data;
    })().catch(error=>{if(current())this.message=error.message;throw error;})
      .finally(()=>{if(this.syncTask===task){this.syncTask=null;this.syncStage='';if(this.reader)this.releaseReader('reader',this.reader);this.notify();}});
    this.syncTask=task;this.syncEpoch=epoch;this.notify();return task;
  }
  async syncHistory(onPage){
    if(!this.profile.connected)throw Error('Sign in to load your YouTube Music history.');
    this.ensureRestored();
    const epoch=this.epoch,existing=this.historyRequest;
    if(existing?.epoch===epoch){
      if(typeof onPage==='function'){
        existing.listeners.add(onPage);
        if(existing.latest)onPage(existing.latest);
      }
      return existing.promise;
    }
    const reader=this.window('history');
    const request={epoch,listeners:new Set(typeof onPage==='function'?[onPage]:[]),latest:null};
    this.historyRequest=request;
    const assertCurrent=()=>{
      if(this.closed || this.epoch!==epoch || !this.profile.connected || reader.isDestroyed())throw Error('The selected YouTube Music account changed.');
    };
    const publish=(page,complete=false)=>{
      assertCurrent();
      if(!Array.isArray(page.history))throw Error('YouTube Music did not provide history.');
      const history=page.history;
      if(complete && !history.length && this.data.history.length && !page.explicitEmpty)throw Error('YouTube Music did not confirm an empty history.');
      if(!complete && history.length<this.data.history.length)return;
      this.data={...this.data,history};
      if(complete)this.historyCompleteEpoch=epoch;
      this.cacheCollections(complete,['history']);
      if(request.latest?.length!==history.length || complete){
        request.latest=history;
        for(const listener of request.listeners)listener(history);
      }
    };
    request.promise=(async()=>{
      await reader.loadURL(ORIGIN+'/history');
      assertCurrent();
      const identity=await this.readIdentity(reader);
      assertCurrent();
      if(!identity?.connected || (identity.id && this.profile.id && identity.id!==this.profile.id))throw Error('YouTube Music could not verify the history account.');
      const page=await this.collect(reader,'history',true,true,publish);
      publish(page,true);
      return page.history;
    })().finally(()=>{
      if(!reader.isDestroyed())reader.destroy();
      if(this.historyRequest===request)this.historyRequest=null;
    });
    return request.promise;
  }
  artistTopSongs(ref){return this.readMetadata(()=>catalogService.artistTopSongs(this,ref));}
  catalog(kind,ref){return this.readMetadata(()=>catalogService.catalog(this,kind,ref));}
  ensureRestored(){
    if(this.profile.connected && this.profile.id && this.restoredOwner!==this.profile.id)this.restoreCache(this.profile);
  }
  artistFollow(id,enabled){this.ensureRestored();return catalogService.artistFollow(this,id,enabled);}
  followedArtists(){return this.data.subscriptions.slice();}
  async discovery(refresh=false,sectionId){
    if(this.discoverPools?.epoch!==this.epoch)this.discoverPools={epoch:this.epoch,pools:new Map(),seen:new Map()};
    const pools=this.discoverPools.pools;
    const seenFor=key=>{
      const seen=this.discoverPools.seen;
      if(!seen.has(key))seen.set(key,new Set());
      return seen.get(key);
    };
    if(refresh && typeof sectionId==='string'){
      const cached=this.discoveryResult;
      const section=cached?.epoch===this.epoch && cached.sections.find(item=>item.id===sectionId);
      const target=section?.url && URL.canParse(section.url)?new URL(section.url):null;
      const supply=pools.get(sectionId);
      if(section && supply && ['tracks','playlists'].some(k=>supply[k].some(item=>!seenFor(sectionId+k).has(item.id) && !section[k]?.some(t=>t.id===item.id)))){
        const updated={...section,tracks:nextShelfBatch(supply.tracks,section.tracks,seenFor(sectionId+'tracks')),
          playlists:nextShelfBatch(supply.playlists,section.playlists||[],seenFor(sectionId+'playlists'))};
        cached.sections=cached.sections.map(s=>s===section?updated:s);return cached.sections;
      }
      if(target?.origin===ORIGIN && (target.pathname.startsWith('/browse/') || target.pathname==='/playlist')){
        return this.refreshDiscoverySection(section,target,cached);
      }
      if(cached?.epoch===this.epoch && sectionId.startsWith('artist-') && sectionId.length<=160){
        const artist=await this.catalog('artist',sectionId.slice(7));
        if(cached.epoch!==this.epoch)throw Error('The selected YouTube Music account changed.');
        const old=section?.tracks||[],tracks=nextShelfBatch(artist.tracks,old,seenFor(sectionId+'tracks'));
        if(!tracks.length)throw Error('No more songs were available from this artist.');
        const item={id:sectionId,title:'More from '+artist.title,tracks,playlists:[]};
        cached.sections=[item,...cached.sections.filter(s=>s.id!==sectionId)];return cached.sections;
      }
    }
    if(!this.player)void this.start();
    const epoch=this.epoch;
    if(this.discoveryTask?.epoch===epoch)return this.discoveryTask.promise;
    if(!refresh && this.discoveryResult?.epoch===epoch && this.discoveryResult.until>Date.now())return this.discoveryResult.sections;
    const reader=this.window('discovery');
    const current=()=>!this.closed && this.epoch===epoch && !reader.isDestroyed();
    const request={epoch};
    request.promise=(async()=>{
      await reader.loadURL(ORIGIN+'/');
      await this.collect(reader,'tracks',false);
      let headers=await this.run(reader,discoveryShelves,false);
      for(let page=0;page<3 && headers.length<18 && current();page++){
        const oldCount=headers.length;
        await this.run(reader,discoveryShelves,true);
        for(let tries=0;tries<12;tries++){
          await wait(150);
          if(!current())throw Error('The account changed while loading discovery.');
          headers=await this.run(reader,discoveryShelves,false);
          if(headers.length>oldCount)break;
        }
        if(headers.length<=oldCount)break;
      }
      const sections=[],homeTracks=[];
      for(const header of headers){
        if(!current())throw Error('The account changed while loading discovery.');
        if(!header.title || /podcasts?/i.test(header.title))continue;
        const result=await this.run(reader,readPage,false,header.index);
        const id=String(header.index),prior=refresh?this.discoveryResult?.sections.find(item=>item.title===header.title):null;
        const tracks=nextShelfBatch(result.tracks,prior?.tracks||[],seenFor(id+'tracks')),playlists=nextShelfBatch(result.playlists,prior?.playlists||[],seenFor(id+'playlists'));
        pools.set(id,{tracks:result.tracks,playlists:result.playlists});
        for(const track of result.tracks)homeTracks.push(track);
        if(tracks.length || playlists.length)sections.push({id,title:header.title,url:header.url,tracks,playlists});
        if(sections.length>=12)break;
      }
      if(!current())throw Error('The account changed while loading discovery.');
      if(homeTracks.length){
        const prior=refresh?this.discoveryResult?.sections.find(s=>s.id==='discover'):null;
        const tracks=nextShelfBatch(homeTracks,prior?.tracks||[],seenFor('discovertracks'));
        pools.set('discover',{tracks:homeTracks,playlists:[]});sections.unshift({id:'discover',title:'Discover',tracks,playlists:[]});
      }
      this.discoveryResult={epoch,until:Date.now()+90000,sections};
      return sections;
    })().finally(()=>{
      if(!reader.isDestroyed())reader.destroy();
      if(this.discoveryTask===request)this.discoveryTask=null;
    });
    this.discoveryTask=request;return request.promise;
  }
  async refreshDiscoverySection(section,url,cached){
    const epoch=this.epoch,reader=this.window('discovery-section');
    try{
      await reader.loadURL(url.href);
      const result=await this.collect(reader,'tracks',false);
      if(this.closed || this.epoch!==epoch)throw Error('The selected account changed.');
      const fresh=(items,old,suffix)=>{
        if(!this.discoverPools.seen.has(section.id+suffix))this.discoverPools.seen.set(section.id+suffix,new Set());
        return nextShelfBatch(items,old,this.discoverPools.seen.get(section.id+suffix));
      };
      const tracks=fresh(result.tracks,section.tracks,'tracks'),playlists=fresh(result.playlists,section.playlists||[],'playlists');
      this.discoverPools.pools.set(section.id,{tracks:result.tracks,playlists:result.playlists});
      if(!tracks.length && !playlists.length)throw Error('YouTube Music did not return new choices for this section.');
      const sections=(this.discoveryResult?.epoch===epoch?this.discoveryResult.sections:cached.sections)
        .map(item=>item.id===section.id?{...item,tracks,playlists}:item);
      this.discoveryResult={epoch,until:Date.now()+90000,sections};return sections;
    }finally{if(!reader.isDestroyed())reader.destroy();}
  }
  async youtubePlaylistHeader(reader,id,epoch){
    const target=new URL('/playlist','https://www.youtube.com');
    target.searchParams.set('list',id);target.searchParams.set('hl','en');
    // This read-only helper is the sole metadata reader for regular YouTube.
    // Validate both the committed document and its parsed playlist identity.
    try{
      await reader.loadURL(target.href);
      for(let i=0;i<16;i++){
        if(this.closed || this.epoch!==epoch || reader.isDestroyed())return null;
        const url=new URL(reader.webContents.getURL());
        if(url.origin!==target.origin || url.pathname!==target.pathname || url.searchParams.get('list')!==id)return null;
        const details=await reader.webContents.executeJavaScript('('+readYouTubePlaylistDetails.toString()+')()',false);
        if(details?.id===id)return details;
        await wait(110);
      }
    }catch{}
    return null;
  }
  playlistDetails(id){return this.readMetadata(()=>this.readPlaylistDetails(id));}
  async readPlaylistDetails(id){
    if(typeof id!=='string' || !/^[-\w]{2,128}$/.test(id))throw Error('Invalid YouTube Music playlist.');
    if(!this.player)void this.start();
    const epoch=this.epoch,reader=this.window('playlist-details');
    try{
      await reader.loadURL(ORIGIN+'/playlist?list='+encodeURIComponent(id));
      for(let i=0;i<32;i++){
        if(this.closed || this.epoch!==epoch)throw Error('The YouTube Music account changed.');
        const details=await this.run(reader,readPlaylistDetails);
        if(details?.title){
          const covers=await this.run(reader,()=>[...document.querySelectorAll('ytmusic-playlist-shelf-renderer ytmusic-responsive-list-item-renderer')].map(el=>
            el.data?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || el.querySelector('img')?.src).filter(Boolean));
          const complete=this.playlistCache.get(epoch+'/'+id+'/default');
          let metadata=details;
          if(details.count===undefined){
            if(complete?.expires>Date.now())metadata={...details,count:complete.tracks.length};
            else{
              const fallback=await this.youtubePlaylistHeader(reader,id,epoch);
              if(this.closed || this.epoch!==epoch)throw Error('The YouTube Music account changed.');
              if(fallback)metadata={...details,artwork:details.artwork || fallback.artwork || '',
                ...(fallback.count!==undefined?{count:fallback.count,countSource:'youtube'}:{})};
            }
          }
          return {...metadata,id,artist:details.owner||'',mosaic:[...new Set(covers)].slice(0,4)};
        }
        await wait(120);
      }
      throw Error('YouTube Music did not provide the playlist details.');
    }finally{if(!reader.isDestroyed())reader.destroy();}
  }
  async playlistAction(action,payload){
    this.ensureRestored();
    const {playlistAction}=require('./site-playlist-actions.cjs');
    const epoch=this.epoch,result=await playlistAction(this,action,payload);
    if(epoch!==this.epoch || this.closed)throw Error('The selected YouTube Music account changed.');
    if(action!=='share'){
      const request=this.playlistRequest;
      if(payload?.id&&request?.key.split('/')[1]===payload.id){this.playlistRequest=null;if(this.playlistReader===request.reader)this.playlistReader=null;if(!request.reader.isDestroyed())request.reader.destroy();}
      this.playlistCache.clear();
      if(result.playlist){
        const lists=this.data.playlists.filter(item=>item.id!==result.playlist.id);
        this.data={...this.data,playlists:action==='unsave'?lists:[result.playlist,...lists]};this.cacheCollections(false,['playlists']);this.notify();
      }
    }
    return result;
  }

  async playlist(id,{sort='default',onPage}={}){
    if(typeof id!=='string'||!/^[-\w]{2,128}$/.test(id))throw Error('Invalid YouTube Music playlist.');
    if(!['default','newest','oldest'].includes(sort))throw Error('Unknown playlist order.');
    if(!this.player)void this.start();
    const epoch=this.epoch,key=epoch+'/'+id+'/'+sort;
    if(this.playlistRequest?.key===key){
      const request=this.playlistRequest;
      if(typeof onPage==='function'){
        request.listeners.add(onPage);
        if(request.latest)onPage(request.latest);
      }
      return request.promise;
    }
    if(this.playlistRequest && !this.playlistRequest.reader.isDestroyed()){this.playlistRequest.reader.destroy();this.playlistReader=null;}
    this.playlistRequest=null;
    const cached=this.playlistCache.get(key);
    if(cached && cached.expires>Date.now())return cached.tracks;
    // Opening a playlist does not wait for the account's long library sync.
    // A new selection closes only the previous playlist reader.
    const reader=this.acquireReader('playlistReader','playlist');
    const request={key,reader,listeners:new Set(typeof onPage==='function'?[onPage]:[]),latest:null};this.playlistRequest=request;
    const current=()=>!this.closed && this.epoch===epoch && this.playlistRequest===request;
    request.promise=(async()=>{
      await reader.loadURL(ORIGIN+'/playlist?list='+encodeURIComponent(id));
      const deliver=page=>{
        if(!current() || !page.tracks.length || (request.latest && (request.latest.length>=page.tracks.length || sort!=='default')))return;
        request.latest=page.tracks;
        for(const listen of request.listeners)listen(request.latest);
      };
      const first=await this.collect(reader,'tracks',false,true);
      if(!current())throw Error('The selected playlist changed.');
      if(sort==='default')deliver(first);
      if(!await this.run(reader,applyPlaylistSort,sort)){
        throw Error('YouTube Music does not offer '+(sort==='oldest'?'oldest':'newest')+' first for this playlist.');
      }
      // The first page after a confirmed date-sort selection is reliable.
      // Continuations can overlap on the site; validate those before publishing.
      const page=await this.collect(reader,'tracks',true,true,deliver);
      if(!current())throw Error('The selected playlist changed.');
      let tracks=page.tracks;
      const reverse=sort==='newest'?'oldest':sort==='oldest'?'newest':null;
      if(reverse && !completePlaylistOrder(tracks)){
        // Some site rollouts append default-order pages to the sorted first
        // page. Read the opposite chronological order and verify entry IDs.
        if(!await this.run(reader,applyPlaylistSort,reverse))throw Error('YouTube Music could not provide the complete date-added order.');
        const opposite=await this.collect(reader,'tracks',true,true);
        if(!current())throw Error('The selected playlist changed.');
        if(opposite.tracks.length!==tracks.length || !completePlaylistOrder(opposite.tracks))throw Error('YouTube Music returned incomplete date-added pages for this playlist.');
        const reversed=opposite.tracks.slice().reverse();
        if(tracks[0]?.playlistEntryId!==reversed[0]?.playlistEntryId)throw Error('YouTube Music returned conflicting date-added orders for this playlist.');
        const confirmed=new Set(reversed.map(t=>t.playlistEntryId));
        if(tracks.some(t=>!confirmed.has(t.playlistEntryId)))throw Error('YouTube Music changed this playlist while it was loading.');
        tracks=reversed;
      }
      const expires=Date.now()+120000;
      this.playlistCache.set(key,{tracks,expires});
      if(reverse && !this.playlistCache.has(epoch+'/'+id+'/'+reverse))this.playlistCache.set(epoch+'/'+id+'/'+reverse,{tracks:tracks.slice().reverse(),expires});
      while(this.playlistCache.size>12)this.playlistCache.delete(this.playlistCache.keys().next().value);
      return tracks;
    })().catch(error=>{if(!current())throw Error('The selected playlist changed.');throw error;}).finally(()=>{
      if(this.playlistRequest===request){this.playlistRequest=null;this.releaseReader('playlistReader',reader);}
    });
    return request.promise;
  }
  interactiveSearchReader(){
    if(this.searchReader && !this.searchReader.isDestroyed() && this.searchReaderEpoch!==this.epoch)this.searchReader.destroy();
    this.searchReaderEpoch=this.epoch;
    return this.acquireReader('searchReader','search');
  }
  warmSearch(){
    if(this.closed || !this.partition || this.pendingSearch)return;
    const reader=this.interactiveSearchReader();
    if(reader.webContents.getURL() || this.warmingSearch?.reader===reader)return;
    const warm={reader};
    this.warmingSearch=warm;
    warm.promise=reader.loadURL(ORIGIN+'/').catch(()=>{}).finally(()=>{
      if(this.warmingSearch===warm)this.warmingSearch=null;
      if(!this.pendingSearch)this.releaseReader('searchReader',reader,45000);
    });
  }
  async searchCatalog(raw){
    const query=typeof raw==='string'?raw.trim().slice(0,300):'';
    const epoch=this.epoch,songs=await this.search(query,{interactive:true});
    const hit=epoch===this.epoch?this.searchCache.get(epoch+' '+query.toLowerCase()):null;
    return {songs:mergeRecordingVariants(songs),artists:hit?.artists||[],albums:hit?.albums||[],playlists:hit?.playlists||[]};
  }
  async search(raw,{interactive=false}={}){
    const query=typeof raw==='string'?raw.trim().slice(0,300):'';
    if(!query)return [];
    const epoch=this.epoch;
    const key=epoch+' '+query.toLowerCase();
    if(interactive && this.pendingSearch?.key===key && this.pendingSearch.sequence===this.searchSequence)return this.pendingSearch.promise;
    const sequence=interactive?++this.searchSequence:0;
    const current=()=>!this.closed && this.epoch===epoch && (!interactive || sequence===this.searchSequence);
    const cached=this.searchCache.get(key);
    if(cached && cached.expires>Date.now())return cached.tracks;
    const read=async()=>{
      if(!current())return [];
      const id=linkedVideoId(query);
      let tracks,metadata={};
      if(id){
        const url=new URL('https://www.youtube.com/oembed');url.searchParams.set('url',ORIGIN+'/watch?v='+id);url.searchParams.set('format','json');
        const res=await fetch(url,{signal:AbortSignal.timeout(12000)});
        if(!res.ok)throw Error('YouTube Music could not open that song link.');
        const d=await res.json();tracks=[{id,source:'youtube',title:d.title,artist:d.author_name,artwork:d.thumbnail_url,duration:0,categoryId:'10'}];
      }else{
        if(!this.player)void this.start();
        const reader=interactive?this.interactiveSearchReader():this.acquireReader('recommendationReader','search');
        const url=new URL('/search',ORIGIN);url.searchParams.set('q',query);
        if(interactive && this.warmingSearch?.reader===reader)await Promise.race([this.warmingSearch.promise,wait(1000)]);
        if(!current())return [];
        const contents=reader.webContents;
        const matches=()=>{
          const at=new URL(contents.getURL()||'about:blank');
          return at.origin===ORIGIN && at.pathname==='/search' && at.searchParams.get('q')===query;
        };
        let spa=false,failure,waitingForDocument=false;
        if(interactive && typeof contents.sendInputEvent==='function' && !matches()){
          spa=await this.run(reader,prepareSearchInput,query).catch(()=>false);
          if(!current())return [];
          if(spa){
            contents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
            contents.sendInputEvent({type:'char',keyCode:'\r'});
            contents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
          }
        }
        const navigate=()=>{
          waitingForDocument=matches();
          void reader.loadURL(url.href).then(()=>{waitingForDocument=false;},err=>{failure=err;});
        };
        if(!spa)navigate();
        const fallbackAt=Date.now()+3500;
        const deadline=Date.now()+15000;
        while(current() && Date.now()<deadline){
          if(failure)throw Error('YouTube Music search could not load.');
          if(spa && Date.now()>fallbackAt){spa=false;navigate();}
          if(!waitingForDocument && matches() && (!spa || await this.run(reader,searchResponseReady,query).catch(()=>false))){
            const data=await this.run(reader,readPage,false).catch(()=>null);
            if(data && (data.tracks?.length || data.artists?.length || data.albums?.length || data.playlists?.length)){
              tracks=data.tracks||[];metadata={artists:data.artists||[],albums:data.albums||[],playlists:data.playlists||[]};break;
            }
            if(data && await this.run(reader,()=>!!document.querySelector('ytmusic-search-page ytmusic-message-renderer')).catch(()=>false)){tracks=[];break;}
          }
          await wait(interactive?45:90);
        }
        if(!current())return [];
        if(!tracks)throw Error('YouTube Music search timed out. Try again.');
      }
      if(!current())return [];
      this.searchCache.set(key,{tracks,...metadata,expires:Date.now()+180000});
      if(this.searchCache.size>48)this.searchCache.delete(this.searchCache.keys().next().value);
      return tracks;
    };
    if(!interactive){
      const task=this.recommendationTail.then(read).finally(()=>{
        if(this.recommendationReader)this.releaseReader('recommendationReader',this.recommendationReader,1500);
      });
      this.recommendationTail=task.catch(()=>{});
      return task;
    }
    const task=read().finally(()=>{
      if(this.pendingSearch?.promise===task){
        this.pendingSearch=null;
        if(this.searchReader)this.releaseReader('searchReader',this.searchReader,45000);
      }
    });
    this.pendingSearch={key,sequence,promise:task};
    return task;
  }
  hasPrepared(id){return !!this.prepared?.ready&&this.prepared.owner===this.active&&this.prepared.track.id===id;}
  cancelPrepared(){
    const prepared=this.prepared;this.prepared=null;
    if(prepared&&!prepared.window.isDestroyed())prepared.window.destroy();
  }
  prepareNext(track){
    // The first-party queue already buffers its successor. A second full
    // music document competes with current playback for CPU and decoder memory.
    this.cancelPrepared();
  }

  async usePrepared(track,generation,volume,intent){
    const prepared=this.prepared;
    if(!prepared?.ready||prepared.owner!==this.active||prepared.track.id!==track.id)return false;
    this.prepared=null;const previous=this.player;
    previous.webContents.setAudioMuted(true);
    await this.run(previous,playerCommand,'pause').catch(()=>{});
    if(this.playIntent!==intent||this.closed){if(this.player===previous)previous.webContents.setAudioMuted(false);prepared.window.destroy();return false;}
    this.seq++;this.player=prepared.window;this.playerView=prepared.window.view;
    this.active={id:track.id,generation,track,playlistId:track.playlistId};this.volume=volume;this.awaitingLoad=false;
    this.mode='song';this.videoAvailable=false;this.switchingCounterpart=null;this.adVisible=!!prepared.ad;
    this.player.webContents.setBackgroundThrottling?.(false);
    this.player.webContents.setAudioMuted(false);
    if(this.adVisible)this.showOfficial();else this.hideOfficial();
    previous.destroy();
    await this.player.webContents.executeJavaScript('('+activatePrepared.toString()+')('+JSON.stringify(volume)+','+JSON.stringify(this.desired)+')',true);
    this.player.webContents.send?.('music:cinema',{enabled:!!this.cinema,track,volume});
    if(this.videoIntent){await this.run(this.player,frameVideo,true);this.mode='video';this.videoAvailable=true;this.showOfficial();this.notifyMode();}
    this.player.webContents.send?.('music:observe-first-party');return true;
  }
  async play(track,generation,volume=.7,startPosition=0,presentation){
    if(!videoId(track?.id))throw Error('Invalid YouTube Music recording.');
    const intent=this.playIntent=(this.playIntent||0)+1;this.desired='play';
    if(this.audioCounterpart&&recordingKey(this.audioCounterpart.track)!==recordingKey(track))this.audioCounterpart=null;
    if(track.mediaType==='video'&&this.audioForVideo?.has(track.id))this.audioCounterpart={track:this.audioForVideo.get(track.id)};
    if(startPosition===0&&await this.usePrepared(track,generation,volume,intent))return;
    if(intent!==this.playIntent)return;
    this.cancelPrepared();
    if(!this.player)void this.start();
    const seq=++this.seq;
    const playlistId=/^[\w-]{2,128}$/.test(track.playlistId || '')?track.playlistId:undefined;
    const videoRequested=this.videoIntent||presentation==='video';
    this.videoDimensions='';this.mode=videoRequested?'video':'song';this.videoAvailable=!!videoRequested;this.switchingCounterpart=null;this.playerView?.setVisible(false);
    const resume=Number.isFinite(startPosition) ? Math.max(0,startPosition) : 0;
    this.active={id:track.id,generation,track,playlistId};this.volume=volume;this.awaitingLoad=true;
    try {
      const url=ORIGIN+'/watch?v='+track.id+(playlistId?'&list='+playlistId:'')+'&t='+Math.floor(resume)+'s';
      let routed=false;
      const loaded=this.player.webContents.getURL?.();
      // From Home, a playlist endpoint starts a miniplayer without navigating
      // to the watch page. Open that initial playlist URL directly so queue,
      // metadata and the selected item agree. Later selections reuse it.
      if(loaded?.startsWith(ORIGIN+'/') && (!playlistId || new URL(loaded).pathname==='/watch')){
        const dispatched=await this.run(this.player,navigateWatch,track.id,playlistId,resume).catch(()=>false);
        const deadline=Date.now()+1800;
        while(dispatched && this.seq===seq && Date.now()<deadline){
          if(await this.run(this.player,watchCommitted,track.id,playlistId).catch(()=>false)){routed=true;break;}
          await wait(45);
        }
      }
      if(this.seq!==seq)return;
      if(!routed)await this.player.loadURL(url);
      if(this.seq!==seq)return;
      for(let i=0;i<45;i++){
        if(this.seq!==seq)return;
        if(await this.run(this.player,playerCommand,'volume',this.volume).catch(()=>false))break;
        await wait(100);
      }
      if(this.seq!==seq)return;
      await this.run(this.player,playerCommand,this.desired).catch(()=>{});
      {
        const deadline=Date.now()+30000;let positioned=false;
        while(this.seq===seq && Date.now()<deadline){
          if(!videoRequested)await this.ensureAudioMode().catch(()=>{});
          else if(track.mediaType==='video'){
            const av=await this.run(this.player,avState).catch(()=>null);
            if(av?.hasToggle&&av.decoded!=='video'&&this.videoSelection!==seq){this.videoSelection=seq;await this.run(this.player,avState,'video');}
          }
          if(await this.run(this.player,restorePosition,track.id,resume).catch(()=>false)){positioned=true;break;}
          if(this.adVisible)break; // Site received startTimeSeconds and handles the post-ad start.
          await wait(60);
        }
        if(this.seq===seq && !positioned && !this.adVisible)throw Error('The selected recording did not become ready.');
      }
      if(this.seq!==seq)return;
      this.awaitingLoad=false;
      this.player.webContents.send?.('music:observe-first-party');
      await this.run(this.player,playerCommand,this.desired).catch(()=>{});
      // Movie-mode skips use the same atomic counterpart/clock handoff as
      // an explicit Song/Video click. A fallback already has an outer owner.
      if(videoRequested&&!this.modeTransition)await this.setPlaybackMode('video',true);
      this.player.webContents.send?.('music:cinema',{enabled:!!this.cinema,track:this.active?.track,volume:this.volume});
    }catch{if(this.seq===seq)this.onEvent({type:'error',...this.active,message:'YouTube Music could not open this track. Check your connection.'});}
  }
  hasDuplicateNext(){return !!this.active&&this.nativeNext?.active===this.active&&this.nativeNext.skipIds.includes(this.nativeNext.id);}
  async waitForNaturalAdvance(id){
    const active=this.active;
    if(!active||this.nativeNext?.active!==active||this.nativeNext.id!==id)return false;
    // The source already prepares its own next stream. Adopt its handoff instead
    // of stopping and navigating it a second time at the natural song boundary.
    const deadline=Date.now()+350;
    while(this.active===active&&!this.closed&&Date.now()<deadline)await wait(20);
    return this.active?.id===id;
  }
  async monitorSeek(active,serial,target){
    const current=()=>!this.closed&&this.active===active&&this.seekSerial===serial;
    const deadline=Date.now()+3000;let repairedEnd=false;
    while(current()&&Date.now()<deadline){
      const status=await this.run(this.player,seekReady,active.id,target).catch(()=>null);
      if(!current()||status?.ad)return;
      if(status?.ended&&!repairedEnd&&target<status.duration-.25){repairedEnd=true;await this.run(this.player,playerCommand,'seek',target);if(current())await this.run(this.player,playerCommand,this.desired||'pause');continue;}
      if(status?.ready){
        // The provider can pause asynchronously while swapping an unbuffered
        // range, after the first Play command. Restore intent once it is ready.
        this.seekTarget=null;
        if(this.desired==='play')await this.run(this.player,playerCommand,'play').catch(()=>{});
        return;
      }
      await wait(60);
    }
    // Some source streams stall forever at an unbuffered range. Reopen the
    // same first-party watch endpoint at the requested timestamp once. Its
    // own stream loader, catalog checks and ads still own playback.
    if(current()&&this.desired==='play'&&!(active.seekDuration>0&&target>=active.seekDuration-.25)){
      this.seekTarget=null;
      await this.play(active.track,active.generation,this.volume,target,this.mode||'song');
    }
  }
  async command(name,value){
    if(!this.active)return;
    if(name==='stop'){
      this.cancelPrepared();clearTimeout(this.queueRetry);this.playIntent=(this.playIntent||0)+1;
      this.seq++;this.active=null;this.desired='pause';this.mode='song';this.switchingCounterpart=null;this.player?.webContents.stop();
      this.hideOfficial();
      if(this.adVisible){this.adVisible=false;if(!this.manualOfficial)this.hideOfficial();}
      await this.run(this.player,playerCommand,'stop').catch(()=>{});return;
    }
    if(name==='next' || name==='previous'){
      this.switchingCounterpart=null;
      const result=await this.run(this.player,skipRecording,name,this.nativeNext?.active===this.active?this.nativeNext.skipIds:[]);
      if(!result.ok)throw Error(result.reason==='ad'?'Playback can skip after the advertisement.':'YouTube Music has no '+name+' track available.');
      return true;
    }
    if(name==='seek'){
      const active=this.active,serial=this.seekSerial=(this.seekSerial||0)+1;
      const duration=active.clock?.duration||active.track?.duration;active.seekDuration=duration;active.clock=null;this.seekTarget={active,serial,target:value,at:Date.now()};
      // Rapid clicks collapse to the newest request before touching the loader.
      await wait(16);
      if(this.active!==active||serial!==this.seekSerial)return true;
      const accepted=await this.run(this.player,playerCommand,name,value);
      if(!accepted)throw Error('Seeking is unavailable until this recording has loaded.');
      if(this.active===active&&serial===this.seekSerial)await this.run(this.player,playerCommand,this.desired||'pause');
      void this.monitorSeek(active,serial,value).catch(()=>{});return true;
    }
    if(name==='play'||name==='pause')this.desired=name;
    if(name==='volume' && Number.isFinite(value))this.volume=Math.max(0,Math.min(1,value));
    const accepted=await this.run(this.player,playerCommand,name,value);
    if(name==='play'&&this.seekTarget?.active===this.active){const {active,serial,target}=this.seekTarget;void this.monitorSeek(active,serial,target).catch(()=>{});}
    return accepted;
  }
  rating(id,action){
    const epoch=this.epoch;
    const task=(this.ratingTail||Promise.resolve()).then(()=>{
      if(epoch!==this.epoch)throw Error('The YouTube Music account changed.');
      return this.readOrSetRating(id,action);
    });
    this.ratingTail=task.catch(()=>{});return task;
  }
  async readOrSetRating(id,action){
    if(!this.profile.connected)throw Error('Sign in to rate songs in your YouTube Music account.');
    if(!videoId(id))throw Error('Invalid YouTube Music recording.');
    const epoch=this.epoch;
    const displayed=this.active?.id===id?new URL(this.player.webContents.getURL()||'about:blank'):null;
    // A native video pane can cover the player's rating controls. Perform writes
    // in a dedicated full-size muted watch document and verify the committed rating.
    const isPlayer=!action && displayed?.origin===ORIGIN && displayed.searchParams.get('v')===id;
    const reader=isPlayer?this.player:this.acquireReader('ratingReader','rating');
    const check=()=>{
      if(this.closed || this.epoch!==epoch || !this.profile.connected)throw Error('The YouTube Music account changed.');
      if(isPlayer && this.active?.id!==id)throw Error('The selected track changed.');
    };
    const poll=async(read)=>{
      for(let i=0;i<45;i++){check();const result=await read();check();if(result)return result;await wait(140);}
      return null;
    };
    const url=ORIGIN+'/watch?v='+id;
    const get=choice=>this.run(reader,readRatingControl,id,choice);
    try{
      if(!isPlayer){
        reader.webContents.setAudioMuted(true);
        if(reader.webContents.getURL?.()!==url)await reader.loadURL(url);
        check();
      }
      const before=await poll(async()=>{
        const result=await get(action);
        return result && (!action || result.rating===action || result.clickAt)?result:null;
      });
      if(!before)throw Error('YouTube Music did not offer a rating control for this song.');
      if(!action || before.rating===action)return before.rating;
      check();
      if(!clickPoint(reader.webContents,before.clickAt))throw Error('YouTube Music could not select that rating.');
      const confirmed=()=>poll(async()=>(await get())?.rating===action);
      if(!await confirmed())throw Error('YouTube Music did not acknowledge the rating.');
      await reader.loadURL(url);check();
      if(!await confirmed())throw Error('YouTube Music did not save the rating. Please try again.');
      return action;
    }catch(error){
      if(!isPlayer && !reader.isDestroyed())reader.destroy();
      throw error;
    }finally{if(!isPlayer)this.releaseReader('ratingReader',reader,1500);}
  }
  getRating(id){return this.rating(id);}
  async rate(id,rating){
    this.ensureRestored();
    if(!['like','dislike','none'].includes(rating))throw Error('Invalid rating.');
    const epoch=this.epoch;
    await this.rating(id,rating);
    if(epoch!==this.epoch)throw Error('The YouTube Music account changed.');
    if(rating!=='like')this.data.liked=this.data.liked.filter(t=>t.id!==id);
    else if(!this.data.liked.some(t=>t.id===id)){
      const known=this.active?.id===id?this.active.track:[...this.data.songs,...this.data.recent,...this.data.discover].find(track=>track.id===id);
      const tracks=known?[known]:await this.search(ORIGIN+'/watch?v='+id).catch(()=>[]);
      if(epoch!==this.epoch)throw Error('The YouTube Music account changed.');
      if(tracks[0])this.data.liked.unshift(tracks[0]);
    }
    this.cacheCollections(false,['liked']);this.notify();
  }
  cancelSignIn(){if(this.auth && !this.auth.isDestroyed())this.auth.close();return this.status();}
  show(){
    if(this.auth && !this.auth.isDestroyed()){this.auth.show();this.auth.focus();return;}
    if(!this.player)void this.start();
    if(this.player.webContents.getURL()==='about:blank')void this.player.loadURL(ORIGIN+'/').catch(()=>{});
    if(this.manualOfficial){void this.run(this.player,frameVideo,this.mode==='video').catch(()=>{});this.hideOfficial();return;}
    void this.run(this.player,frameVideo,false).catch(()=>{});this.manualOfficial=true;this.showOfficial();this.player.webContents.focus();
  }
  async signOut(){
    if(this.disconnecting)return this.disconnecting;
    this.disconnecting=this.clearAccountSession();
    try{return await this.disconnecting;}finally{this.disconnecting=null;}
  }
  async clearAccountSession(){
    this.clearReaderTimers();
    this.playlistCache.clear();this.playlistRequest=null;this.searchCache.clear();this.searchSequence++;this.pendingSearch=null;
    this.adVisible=false;this.hideOfficial();
    this.epoch++;this.seq++;this.active=null;this.profile={connected:false,name:''};this.identityChecked=true;this.clearCache();this.data=empty();this.message='';
    const cancel=this.cancelPasskeySignIn();
    if(this.auth && !this.auth.isDestroyed())this.auth.destroy();this.auth=null;
    if(this.reader && !this.reader.isDestroyed())this.reader.destroy();this.reader=null;
    for(const win of this.windows)if(win!==this.player&&!win.isDestroyed())win.destroy();
    if(this.player && !this.player.isDestroyed())await this.player.loadURL('about:blank').catch(()=>{});
    await cancel;
    if(this.partition){await this.partition.clearStorageData();await this.partition.clearCache();}
    this.notify();return this.status();
  }
  close(){
    clearTimeout(this.queueRetry);
    if(this.cacheTimer)this.cacheCollections(true);
    this.cancelPrepared();
    this.clearReaderTimers();
    this.closed=true;this.seq++;this.epoch++;this.active=null;
    if(this.host && !this.host.isDestroyed()){this.host.removeListener('resize',this.resizePlayer);this.host.removeListener('resized',this.resizePlayer);}
    if(this.receive)require('electron').ipcMain.removeListener('music:first-party-event',this.receive);
    for(const win of this.windows)if(!win.isDestroyed())win.destroy();
    if(this.browserFlow || this.browserFinish || this.browserCancel)return this.cancelPasskeySignIn();
  }
}
module.exports={MusicSession,allowedURL,guardNavigation,readPage,readQueue,applyPlaylistSort};

