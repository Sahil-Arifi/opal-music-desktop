// This function runs inside a first-party Music document. It returns only the
// catalog metadata shown by the site's headers, shelves and recording cards.
function readCatalog(kind,id){
  const visible='ytmusic-browse-response:not([hidden]),ytmusic-search-page:not([hidden])';
  const root=document.querySelector(visible) || document;
  const text=field=>field?.simpleText || field?.runs?.map(r=>r.text).join('') || '';
  const browse=run=>run?.navigationEndpoint?.browseEndpoint;
  const pageType=endpoint=>endpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';
  function releaseFormat(fields){
    for(const field of fields){
      const parts=field?.runs || (field?.simpleText?[{text:field.simpleText}]:[]);
      for(const part of parts){
        if(part.navigationEndpoint)continue;
        const tokens=String(part.text||'').toLowerCase().split(/[·•]/u).map(token=>token.trim());
        const format=tokens.find(token=>token==='album'||token==='single'||token==='ep');
        if(format)return format;
      }
    }
  }
  const image=field=>field?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url ||
    field?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || '';
  const selector='ytmusic-responsive-list-item-renderer,ytmusic-two-row-item-renderer,ytmusic-card-shelf-renderer,ytmusic-multi-row-list-item-renderer';
  const cards=[];let topSongsEndpoint;

  for(const item of root.querySelectorAll(selector)){
    const d=item.data||{},columns=(d.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text || {});
    const title=text(columns[0] || d.title);if(!title)continue;
    const dest=d.navigationEndpoint || (columns[0]||d.title)?.runs?.[0]?.navigationEndpoint || d.onTap;
    const target=dest?.browseEndpoint, type=pageType(target);
    const lines=[...columns.slice(1),d.subtitle,...(d.fixedColumns||[]).map(c=>c.musicResponsiveListItemFixedColumnRenderer?.text)].filter(Boolean);
    const runs=lines.flatMap(v=>v.runs||[]),labels=lines.map(text);
    const credits=runs.filter(r=>pageType(browse(r))==='MUSIC_PAGE_TYPE_ARTIST').map(r=>({id:browse(r).browseId,name:r.text}));
    const album=runs.find(r=>pageType(browse(r))==='MUSIC_PAGE_TYPE_ALBUM');
    const shelf=item.closest('ytmusic-carousel-shelf-renderer,ytmusic-shelf-renderer,ytmusic-playlist-shelf-renderer');
    const header=shelf?.data?.header?.musicCarouselShelfBasicHeaderRenderer || shelf?.querySelector('ytmusic-carousel-shelf-basic-header-renderer')?.data;
    const section=text(shelf?.data?.title || header?.title) || '';
    if(/top songs?|popular|^songs?$/i.test(section)&&!topSongsEndpoint){
      const endpoint=header?.moreContentButton?.buttonRenderer?.navigationEndpoint || shelf?.data?.bottomEndpoint || shelf?.data?.continuations?.[0]?.nextContinuationData;
      const browse=endpoint?.browseEndpoint,watch=endpoint?.watchPlaylistEndpoint;
      if(browse?.browseId)topSongsEndpoint={id:browse.browseId,...(browse.params?{params:browse.params}:{})};
      else if(watch?.playlistId)topSongsEndpoint={playlistId:watch.playlistId};
      if(!topSongsEndpoint){const link=shelf?.querySelector('ytmusic-carousel-shelf-basic-header-renderer a[href*="/browse/"],ytmusic-carousel-shelf-basic-header-renderer a[href*="/playlist?"]');if(link?.href){const url=new URL(link.href,'https://music.youtube.com');if(url.pathname.startsWith('/browse/'))topSongsEndpoint={id:url.pathname.split('/').pop(),params:url.searchParams.get('params')||undefined};else if(url.searchParams.get('list'))topSongsEndpoint={playlistId:url.searchParams.get('list')};}}
    }
    const artwork=image(d.thumbnail || d.thumbnailRenderer) || item.querySelector('img')?.src || '';
    const artist=credits.map(c=>c.name).join(' & '),year=labels.join(' ').match(/\b(?:19|20)\d\d\b/)?.[0];
    if(['MUSIC_PAGE_TYPE_ARTIST','MUSIC_PAGE_TYPE_ALBUM','MUSIC_PAGE_TYPE_PLAYLIST'].includes(type) && target.browseId){
      const k=type==='MUSIC_PAGE_TYPE_ARTIST'?'artist':type==='MUSIC_PAGE_TYPE_ALBUM'?'album':'playlist';
      const releaseType=k==='album'?releaseFormat(lines):undefined;
      const audience=labels.join(' ').match(/[\d.,]+\s*[KMB]?\s+monthly (?:listeners?|audience)/i)?.[0];
      cards.push({kind:k,id:k==='playlist'?target.browseId.replace(/^VL/,''):target.browseId,title,artist,section,artwork,...(releaseType?{releaseType}:{}),...(year?{year}:{}),...(audience?{audience}:{})});
      continue;
    }
    const watch=d.playlistItemData?.videoId || dest?.watchEndpoint?.videoId;
    if(!/^[\w-]{11}$/.test(watch || '') || /podcasts?|episodes?/i.test(section))continue;
    const playCountLabel=labels.find(value=>/^[\d.,]+\s*[KMB]?\s+(?:plays?|views?)$/i.test(value));
    const duration=labels.find(value=>/^\d+(?::\d{2}){1,2}$/.test(value))?.split(':').reduce((n,v)=>n*60+Number(v),0) || 0;
    cards.push({kind:'song',source:'youtube',id:watch,title,artist,artists:credits,channelId:credits[0]?.id||'',album:album?.text||'',albumId:browse(album)?.browseId||'',section,artwork,duration,playlistId:dest?.watchEndpoint?.playlistId,categoryId:'10',...(playCountLabel?{playCountLabel}:{})});
  }
  if(kind==='search')return cards;
  if(kind==='song'){
    const bar=document.querySelector('ytmusic-player-bar'),player=document.querySelector('#movie_player');
    const video=player?.getPlayerResponse?.()?.videoDetails;
    if(video?.videoId!==id)return null;
    const name=bar?.querySelector('.title')?.textContent?.trim() || video.title;
    const byline=bar?.querySelector('.byline'),links=[...byline?.querySelectorAll('a[href]')||[]];
    const artists=links.map(a=>({id:new URL(a.href).pathname.split('/').pop(),name:a.textContent.trim()})).filter(a=>/^UC[\w-]{22}$/.test(a.id));
    const a=links.find(a=>new URL(a.href).pathname.includes('/browse/MPRE'));
    const albumId=a?new URL(a.href).pathname.split('/').pop():'';
    const track={id,source:'youtube',title:name,artist:artists.map(x=>x.name).join(' & ') || video.author || '',artists,channelId:artists[0]?.id || video.channelId,
      album:a?.textContent?.trim() || '',albumId,artwork:video.thumbnail?.thumbnails?.at(-1)?.url||'',duration:Number(video.lengthSeconds)||0};
    const views=String(video.viewCount||'');if(/^\d+$/.test(views))track.playCountLabel=Number(views).toLocaleString('en-US')+' views';
    return {...track,kind,tracks:[track],albums:a?[{kind:'album',id:albumId,title:track.album,artist:track.artist}]:[],singles:[],
      artists:artists.map(a=>({kind:'artist',id:a.id,title:a.name})),playlists:[]};
  }
  const head=root.querySelector('ytmusic-immersive-header-renderer,ytmusic-visual-header-renderer,ytmusic-responsive-header-renderer,ytmusic-detail-header-renderer');
  if(!head?.data?.title)return null;
  const d=head.data, title=text(d.title);
  const art=image(d.thumbnail) || d.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || head.querySelector('img')?.src || '';
  const artist=text(d.straplineTextOne), lines=[text(d.subtitle),text(d.secondSubtitle)];
  const releaseType=kind==='album'?releaseFormat([d.subtitle,d.secondSubtitle]):undefined;
  const year=lines.join(' ').match(/\b(?:19|20)\d\d\b/)?.[0];
  const description=text(d.description) || text(d.description?.musicDescriptionShelfRenderer?.description);
  const follow=head.querySelector('ytmusic-subscribe-button-renderer');
  const followed=typeof follow?.data?.subscribed==='boolean'?follow.data.subscribed:undefined;
  const audience=text(d.monthlyListenerCount) || String(head.innerText||'').match(/[\d.,]+\s*[KMB]?\s+monthly (?:listeners?|audience)/i)?.[0];
  const unique=items=>{const seen=new Set();return items.filter(item=>!seen.has(item.id) && seen.add(item.id));};
  const tracks=cards.filter(c=>c.kind==='song' && (kind==='album'?!c.section || /songs?|tracks?/i.test(c.section):/top songs?|popular|^songs?$/i.test(c.section)));
  return {id,kind,title,artist,artwork:art,description,...(topSongsEndpoint?{topSongsEndpoint}:{}),...(releaseType?{releaseType}:{}),...(year?{year}:{}),...(audience?{audience}:{}),...(followed!==undefined?{followed}:{}),
    tracks:unique(tracks).map(t=>({...t,artist:t.artist || artist || (kind==='artist'?title:''),...(!t.album && kind==='album'?{album:title,albumId:id}:{}),...(releaseType?{releaseType}:{}),artwork:t.artwork || art})),
    albums:unique(cards.filter(c=>c.kind==='album' && !/singles?|eps?\b/i.test(c.section))).map(a=>({...a,artist:a.artist || (kind==='artist'?title:artist)})),
    singles:unique(cards.filter(c=>c.kind==='album' && /singles?|eps?\b/i.test(c.section))).map(a=>({...a,artist:a.artist || (kind==='artist'?title:artist)})),
    artists:unique(cards.filter(c=>c.kind==='artist')),playlists:unique(cards.filter(c=>c.kind==='playlist'))};
}
module.exports={readCatalog};

