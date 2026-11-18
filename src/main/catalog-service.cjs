const {readCatalog}=require('./catalog-reader.cjs');
const {mergeRecordingVariants}=require('./recording.cjs');
const {clickPoint}=require('./site-rating.cjs');
const origin='https://music.youtube.com';
const delay=n=>new Promise(r=>setTimeout(r,n));
const direct={artist:/^UC[\w-]{22}$/,album:/^MPRE[\w-]{5,120}$/,song:/^[\w-]{11}$/};
const normalized=value=>String(value||'').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();

async function catalog(session,kind,input){
  if(!Object.hasOwn(direct,kind))throw Error('Unknown music page.');
  if(!session.player)void session.start();
  const ref=typeof input==='string'?direct[kind].test(input)?{id:input}:{title:input}:input || {};
  let id=typeof ref.id==='string'&&direct[kind].test(ref.id)?ref.id:'';
  const term=String(ref.title||ref.query||'').trim().slice(0,160),credit=String(ref.artist||'').trim().slice(0,100);
  if(!id && !term)throw Error('Choose an artist, album or song.');
  const epoch=session.epoch;
  session.catalogCache ||= new Map();
  const key=JSON.stringify([epoch,kind,id,term,credit]),cache=session.catalogCache.get(key);
  if(cache?.expires>Date.now())return cache.page;
  const reader=session.window('catalog');reader.webContents.setAudioMuted(true);
  const current=()=>{if(session.closed || session.epoch!==epoch || reader.isDestroyed())throw Error('The selected YouTube Music account changed.');};
  const poll=async(read)=>{
    for(let n=0;n<42;n++){current();const value=await read();current();if(value)return value;await delay(160);}
    return null;
  };
  try{
    if(!id){
      const url=new URL('/search',origin);url.searchParams.set('q',[term,credit].filter(Boolean).join(' '));
      await reader.loadURL(url.href);
      const found=await poll(async()=>{
        const cards=(await session.run(reader,readCatalog,'search')).filter(c=>c.kind===kind && direct[kind].test(c.id));
        if(!cards.length)return null;
        const rank=c=>(normalized(c.title)===normalized(term)?8:normalized(c.title).includes(normalized(term))?3:0)+(credit && normalized(c.artist).includes(normalized(credit))?3:0);
        return cards.sort((a,b)=>rank(b)-rank(a))[0];
      });
      if(!found)throw Error('YouTube Music did not return that '+kind+'.');
      id=found.id;
    }
    current();await reader.loadURL(origin+(kind==='song'?'/watch?v=':'/browse/')+encodeURIComponent(id));
    const page=await poll(async()=>{const result=await session.run(reader,readCatalog,kind,id);return result?.title && (kind!=='album'||result.tracks?.length)?result:null;});
    if(!page)throw Error('YouTube Music could not load this '+kind+' page.');
    if(kind==='artist')page.tracks=mergeRecordingVariants(page.tracks);
    const entry={page,expires:Date.now()+180000};
    session.catalogCache.set(key,entry);session.catalogCache.set(JSON.stringify([epoch,kind,id,'','']),entry);
    while(session.catalogCache.size>48)session.catalogCache.delete(session.catalogCache.keys().next().value);
    return page;
  }finally{if(!reader.isDestroyed())reader.destroy();}
}

function readArtistSubscription(id,desired){
  if(!new URL(location.href).pathname.endsWith('/'+id))return null;
  const element=document.querySelector('ytmusic-immersive-header-renderer ytmusic-subscribe-button-renderer,ytmusic-visual-header-renderer ytmusic-subscribe-button-renderer');
  if(!element)return null;
  if(desired==='confirm-unsubscribe'){
    const dialog=[...document.querySelectorAll('ytmusic-popup-container [role="dialog"],ytmusic-popup-container yt-confirm-dialog-renderer')].find(el=>el.getClientRects().length && /unsubscribe/i.test(el.innerText||''));
    const button=[...dialog?.querySelectorAll('button')||[]].find(el=>el.getClientRects().length && /^unsubscribe$/i.test(el.textContent.trim()));
    if(!button)return null;
    const rect=button.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
    return button.contains(document.elementFromPoint(x,y))?{clickAt:{x,y}}:null;
  }
  const button=element.querySelector('button'),confirmed=element.data?.subscribed;
  const label=(button?.getAttribute('aria-label') || button?.textContent || '').trim();
  const followed=/^(?:unsubscribe|subscribed)\b/i.test(label)?true:/^subscribe\b/i.test(label)?false:typeof confirmed==='boolean'?confirmed:undefined;
  if(followed===undefined)return null;
  if(desired==null || desired===followed)return {followed};
  if(!button || button.disabled)return null;
  button.scrollIntoView({block:'nearest',behavior:'instant'});
  const rect=button.getBoundingClientRect(),x=Math.round(rect.x+rect.width/2),y=Math.round(rect.y+rect.height/2);
  return {followed,...(button.contains(document.elementFromPoint(x,y))?{clickAt:{x,y}}:{})};
}

async function artistFollow(session,id,enabled){
  if(typeof id!=='string' || !direct.artist.test(id) || typeof enabled!=='boolean')throw Error('Choose a valid artist.');
  if(!session.profile.connected)throw Error('Sign in to follow artists.');
  const epoch=session.epoch,w=session.window('follow');
  const check=()=>{if(session.closed || session.epoch!==epoch || !session.profile.connected)throw Error('The selected YouTube Music account changed.');};
  const url=origin+'/browse/'+id;
  const poll=async(desired,needClick=false,confirmUnsubscribe=false)=>{
    let confirmed=false;
    for(let i=0;i<45;i++){
      check();const state=await session.run(w,readArtistSubscription,id,desired);check();
      if(state && ((state.followed===enabled && (!confirmUnsubscribe || confirmed)) || (needClick&&state.clickAt)))return state;
      if(confirmUnsubscribe && !confirmed){
        const dialog=await session.run(w,readArtistSubscription,id,'confirm-unsubscribe');check();
        if(dialog?.clickAt)confirmed=clickPoint(w.webContents,dialog.clickAt);
      }
      await delay(115);
    }
    return null;
  };
  try{
    await w.loadURL(url);const initial=await poll(enabled,true);
    if(!initial)throw Error('The service did not offer a follow control.');
    if(initial.followed!==enabled){
      const start=await session.run(w,()=>performance.now());check();
      check();clickPoint(w.webContents,initial.clickAt);
      if(!await poll(undefined,false,!enabled))throw Error('YouTube Music did not confirm this subscription.');
      // The UI changes optimistically. Navigating immediately can abort the
      // site's still-pending write and reload its old subscription. Observe
      // completion of the site's own request before verifying on a new page.
      const sent=await session.run(w,async(enabled,start)=>{
        const route='/subscription/'+(enabled?'subscribe':'unsubscribe');
        for(let i=0;i<70;i++){
          const entry=performance.getEntriesByType('resource').find(item=>item.startTime>=start && item.responseEnd>0 && new URL(item.name).pathname.endsWith(route));
          if(entry)return !entry.responseStatus || (entry.responseStatus>=200 && entry.responseStatus<300);
          await new Promise(resolve=>setTimeout(resolve,90));
        }
        return false;
      },enabled,start);check();
      if(sent===false)throw Error('YouTube Music did not finish saving this subscription.');
      await w.loadURL(url);if(!await poll())throw Error('YouTube Music did not save this subscription.');
    }
    session.catalogCache?.clear();
    if(!enabled)session.data={...session.data,subscriptions:session.data.subscriptions.filter(a=>a.id!==id)};
    else if(!session.data.subscriptions.some(a=>a.id===id)){
      const page=await session.run(w,readCatalog,'artist',id);check();
      if(page)session.data={...session.data,subscriptions:[{id,title:page.title,artwork:page.artwork},...session.data.subscriptions]};
    }
    session.cacheCollections(false,['subscriptions']);session.notify();return {followed:enabled};
  }finally{if(!w.isDestroyed())w.destroy();}
}
module.exports={catalog,artistFollow,readArtistSubscription};

async function artistTopSongs(session,reference){
  const page=await catalog(session,'artist',reference),endpoint=page.topSongsEndpoint;
  if(!endpoint)return page.tracks;
  const url=new URL(origin);
  if(typeof endpoint.id==='string'&&/^[-\w]{2,160}$/.test(endpoint.id)){
    url.pathname='/browse/'+endpoint.id;if(typeof endpoint.params==='string')url.searchParams.set('params',endpoint.params);
  }else if(typeof endpoint.playlistId==='string'&&/^[-\w]{2,160}$/.test(endpoint.playlistId)){
    url.pathname='/playlist';url.searchParams.set('list',endpoint.playlistId);
  }else return page.tracks;
  const epoch=session.epoch,reader=session.window('catalog');reader.webContents.setAudioMuted(true);
  try{
    await reader.loadURL(url.href);
    for(let i=0;i<42;i++){
      if(session.closed||epoch!==session.epoch)throw Error('The selected YouTube Music account changed.');
      const cards=await session.run(reader,readCatalog,'search');
      const tracks=cards.filter(card=>card.kind==='song');
      if(tracks.length>page.tracks.length){
        const seen=new Set();return mergeRecordingVariants([...page.tracks,...tracks].filter(track=>!seen.has(track.id)&&seen.add(track.id))).slice(0,100);
      }
      await delay(120);
    }
    return page.tracks;
  }finally{if(!reader.isDestroyed())reader.destroy();}
}
module.exports.artistTopSongs=artistTopSongs;

