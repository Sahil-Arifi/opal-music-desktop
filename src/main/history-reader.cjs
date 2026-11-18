// Both readers are serialized by MusicSession.run and execute only in the Music
// document. Keep their date and DOM helpers local to each function.
function readHistory(referenceTime = Date.now()) {
  if (location.pathname.replace(/\/$/,'') !== '/history') return {history:[],tracks:[],cardCount:0};
  const today=new Date(referenceTime);
  const local=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  const key=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
  const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  function headingDay(value) {
    const label=value.toLowerCase().replace(/\u00a0/g,' ').trim();
    if (label==='today') return key(local);
    if (label==='yesterday') return key(new Date(local.getFullYear(),local.getMonth(),local.getDate()-1));
    const weekday=weekdays.indexOf(label);
    if (weekday!==-1) {
      const back=(7+local.getDay()-weekday)%7;
      return back ? key(new Date(local.getFullYear(),local.getMonth(),local.getDate()-back)) : '';
    }
    const iso=label.match(/^(\d{4})-(\d\d)-(\d\d)$/);
    let day,month,year,explicitYear;
    if (iso) {
      year=Number(iso[1]);month=Number(iso[2])-1;day=Number(iso[3]);explicitYear=true;
    } else {
      const stripped=label.replace(/^(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),?\s+/,'');
      const american=stripped.match(/^([a-z]+)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/);
      const european=stripped.match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/);
      if (!american && !european) return '';
      const name=american?american[1]:european[2];
      month=months.findIndex(m=>m===name || (name.length===3 && m.startsWith(name)));
      day=Number(american?american[2]:european[1]);explicitYear=(american||european)[3];
      year=Number(explicitYear)||local.getFullYear();
      if (!explicitYear && (month>local.getMonth() || (month===local.getMonth() && day>local.getDate()))) year--;
    }
    const date=new Date(year,month,day);
    return year>=2000 && date.getFullYear()===year && date.getMonth()===month && date.getDate()===day && date<=local ? key(date) : '';
  }
  function headingRange(value){
    const label=String(value||'').toLowerCase().replace(/\u00a0/g,' ').trim();
    const at=(year,month,day)=>new Date(year,month,day);
    const y=local.getFullYear(),m=local.getMonth(),d=local.getDate();
    const ago=days=>at(y,m,d-days);
    const range=(start,end)=>({from:key(start),to:key(end>local?local:end)});
    const recent=label.match(/^(?:last|past|previous) (\d{1,3}) days$/);
    if(recent && Number(recent[1])>0)return range(ago(Number(recent[1])-1),local);
    if(label==='this month')return range(at(y,m,1),local);
    if(label==='last month' || label==='previous month')return range(at(y,m-1,1),at(y,m,0));
    // The site's calendar week can start Sunday or Monday. Use the union as a
    // conservative bound so stats never overstate a narrower selected period.
    const sun=local.getDay(),mon=(sun+6)%7;
    if(label==='this week')return range(ago(Math.max(sun,mon)),local);
    if(label==='last week' || label==='previous week')return range(ago(Math.max(sun,mon)+7),ago(Math.min(sun,mon)+1));
    if(label==='this year')return range(at(y,0,1),local);
    if(label==='last year' || label==='previous year')return range(at(y-1,0,1),at(y-1,11,31));
    const named=label.match(/^([a-z]+)\s+(\d{4})$/);
    const month=named?months.indexOf(named[1]):-1;
    if(month>=0 && Number(named[2])>=2000 && at(Number(named[2]),month,1)<=local)return range(at(Number(named[2]),month,1),at(Number(named[2]),month+1,0));
    return null;
  }
  const text=label=>(label?.runs||[]).map(r=>r.text).join('') || label?.simpleText || '';
  const root=document.querySelector('ytmusic-browse-response:not([hidden])') || document;
  const history=[];
  const cards=root.querySelectorAll('ytmusic-responsive-list-item-renderer,ytmusic-multi-row-list-item-renderer');
  for (const card of cards) {
    const d=card.data || {};
    const columns=(d.flexColumns||[]).map(c=>c.musicResponsiveListItemFlexColumnRenderer?.text?.runs||[]);
    const name=columns[0]||d.title?.runs||[];
    const id=d.playlistItemData?.videoId || d.navigationEndpoint?.watchEndpoint?.videoId ||
      name.find(r=>r.navigationEndpoint?.watchEndpoint)?.navigationEndpoint.watchEndpoint.videoId;
    const title=name.map(r=>r.text).join('') || card.querySelector('.title')?.textContent?.trim();
    if (!/^[\w-]{11}$/.test(id||'') || !title) continue;
    const runs=[...columns.slice(1).flat(),...(d.subtitle?.runs||[])];
    const kind=r=>r.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
    const credits=runs.filter(r=>kind(r)==='MUSIC_PAGE_TYPE_ARTIST' || r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))
      .map(r=>({id:r.navigationEndpoint.browseEndpoint.browseId,name:r.text})).filter(r=>r.name);
    const album=runs.find(r=>kind(r)==='MUSIC_PAGE_TYPE_ALBUM');
    const artwork=(d.thumbnail || d.thumbnailRenderer)?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || card.querySelector('img')?.src || '';
    const artist=credits.map(a=>a.name).join(' & ') || (columns[1]||[]).find(r=>!/^\s*(?:[•·]|Song|Video)\s*$/i.test(r.text||''))?.text || '';
    const fixed=(d.fixedColumns||[]).flatMap(c=>c.musicResponsiveListItemFixedColumnRenderer?.text?.runs||[]);
    const span=fixed.find(r=>/^\d{1,3}(?::[0-5]\d){1,2}$/.test(r.text))?.text;
    const track={source:'youtube',id,title,artist,artists:credits,channelId:credits[0]?.id||'',album:album?.text||'',
      albumId:album?.navigationEndpoint?.browseEndpoint?.browseId||'',artwork,duration:span?span.split(':').reduce((n,s)=>n*60+Number(s),0):0,categoryId:'10'};
    const shelf=card.closest('ytmusic-shelf-renderer,ytmusic-item-section-renderer');
    const heading=text(shelf?.data?.title) || shelf?.querySelector('.header h2,.header .title,#header h2,h2.title')?.textContent || '';
    const machine=card.querySelector('time[datetime]')?.getAttribute('datetime') || '';
    const stamp=/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(machine)?Date.parse(machine):NaN;
    const playedOn=headingDay(heading),playedRange=playedOn?null:headingRange(heading);
    history.push({track,origin:'account',product:'youtube-music',...(Number.isFinite(stamp)?{playedAt:new Date(stamp).toISOString()}:playedOn?{playedOn}:playedRange?{playedRange}:{})});
  }
  return {history,tracks:history.map(e=>e.track),cardCount:cards.length};
}

function readPlaylistDetails() {
  const url=new URL(location.href);
  const id=url.searchParams.get('list');
  if (url.origin!=='https://music.youtube.com' || url.pathname!=='/playlist' || !/^[\w-]{2,128}$/.test(id||'')) return null;
  const content=document.querySelector('ytmusic-browse-response:not([hidden])') || document;
  const header=content.querySelector('ytmusic-responsive-header-renderer,ytmusic-detail-header-renderer');
  if (!header) return null;
  const d=header.data||{}, runs=x=>x?.runs||[], text=x=>runs(x).map(r=>r.text).join('')||x?.simpleText||'';
  const title=text(d.title)||header.querySelector('.title')?.textContent?.trim();
  if (!title) return null;
  const editable=header.closest('ytmusic-editable-playlist-detail-header-renderer');
  const edit=editable?.data?.editHeader?.musicPlaylistEditHeaderRenderer;
  if (edit?.playlistId && edit.playlistId!==id) return null;
  const artwork=(d.thumbnail||d.thumbnailRenderer)?.musicThumbnailRenderer?.thumbnail?.thumbnails?.at(-1)?.url || header.querySelector('ytmusic-thumbnail-renderer img')?.src||'';
  const descriptors=[text(d.subtitle),text(d.secondSubtitle),header.querySelector('.second-subtitle')?.textContent||''];
  const countMatch=descriptors.join(' • ').match(/(?:^|[•·,\s])([\d][\d,\u00a0\u202f]*)\s+(?:songs?|tracks?|videos?)\b/i);
  const privacyToken=String(edit?.privacy || edit?.privacyStatus || d.privacy || d.privacyStatus || '').toLowerCase();
  const privacyValue=['private','unlisted','public'].find(label=>privacyToken===label || descriptors.some(s=>s.trim().toLowerCase().split(/\s*[•·]\s*/).includes(label)));
  const owner=[...runs(d.straplineTextOne),...runs(d.subtitle)].find(r=>r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'))?.text;
  const owned=typeof edit?.isOwned==='boolean'?edit.isOwned:typeof d.isOwned==='boolean'?d.isOwned:undefined;
  const canEdit=Boolean(edit || header.querySelector('.edit-playlist-button'));
  return {id,title,artwork,...(countMatch?{count:Number(countMatch[1].replace(/\D/g,''))}:{}),
    ...(owner?{owner}:{}),...(owned===undefined?{}:{owned}),...(canEdit?{editable:true}:{}),...(privacyValue?{privacy:privacyValue}:{})};
}

function readYouTubePlaylistDetails() {
  const url=new URL(location.href);
  const id=url.searchParams.get('list');
  if (url.origin!=='https://www.youtube.com' || url.pathname!=='/playlist' || !/^[\w-]{2,128}$/.test(id||'')) return null;
  const data=window.ytInitialData;
  const sidebar=data?.sidebar?.playlistSidebarRenderer?.items?.find(item=>item.playlistSidebarPrimaryInfoRenderer)?.playlistSidebarPrimaryInfoRenderer ||
    document.querySelector('ytd-playlist-sidebar-primary-info-renderer')?.data;
  const header=data?.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
  const legacy=data?.header?.playlistHeaderRenderer;
  const canonical=sidebar?.navigationEndpoint?.watchEndpoint?.playlistId ||
    sidebar?.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.playlistId || legacy?.playlistId;
  if (canonical && canonical!==id) return null;
  const text=field=>field?.simpleText || field?.content || field?.runs?.map(r=>r.text||'').join('') || '';
  const title=text(sidebar?.title) || text(header?.title?.dynamicTextViewModel?.text) || text(legacy?.title) || data?.metadata?.playlistMetadataRenderer?.title;
  if (typeof title!=='string' || !title.trim()) return null;
  const parts=header?.metadata?.contentMetadataViewModel?.metadataRows?.flatMap(row=>(row.metadataParts||[]).map(part=>text(part.text))) || [];
  const stats=[...(sidebar?.stats||[]).map(text),text(legacy?.numVideosText),...parts];
  let count;
  for (const stat of stats) {
    const exact=stat.trim().match(/^(\d+|\d{1,3}(?:[,\u00a0\u202f ]\d{3})+)\s+videos?$/i);
    if (exact) {
      const value=Number(exact[1].replace(/\D/g,''));
      if (Number.isSafeInteger(value)) {count=value;break;}
    }
  }
  const thumbs=sidebar?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails || [];
  const artwork=thumbs.at(-1)?.url || '';
  return {id,title:title.trim(),...(artwork?{artwork}:{}),...(count!==undefined?{count,countSource:'youtube'}:{})};
}

module.exports={readHistory,readPlaylistDetails,readYouTubePlaylistDetails};

