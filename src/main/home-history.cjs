const {recordingKey}=require('./recording.cjs');

const limit=18;
const list=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'?value.trim():'';
const nameKey=value=>text(value).normalize('NFKC').toLowerCase();

function historyRows(entries) {
  const rows=[];
  for (const entry of list(entries)) {
    const track=entry?.track||entry;
    if (!track || !text(track.id) || !text(track.title) || !['local','youtube'].includes(track.source)) continue;
    if ((entry.product && entry.product!=='youtube-music') || (track.categoryId && String(track.categoryId)!=='10')) continue;
    const when=text(entry.playedAt);
    const time=/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(when)?Date.parse(when):NaN;
    rows.push({track,time,context:entry.playContext||track.playContext});
  }
  return rows;
}

function credits(track) {
  return list(track.artists).some(credit=>text(credit?.name||credit?.title||credit)) ? track.artists :
    [{name:track.artist,id:track.channelId}];
}

function contextItem(context,playlists) {
  if (!context || !['album','playlist'].includes(context.kind) || !text(context.id)) return null;
  const known=context.kind==='playlist'?playlists.get(context.id):null;
  const title=text(known?.title)||text(context.title);
  if (!title) return null;
  const artist=text(known?.artist)||text(context.artist), artwork=text(known?.artwork)||text(context.artwork);
  return {kind:context.kind,id:context.id,title,...(['album','single','ep'].includes(context.releaseType)?{releaseType:context.releaseType}:{}),...(artist?{artist}:{}),...(artwork?{artwork}:{})};
}

function buildHomeHistory({history,remoteHistory,recent,playlists,artists}={}) {
  const local=historyRows(history),account=historyRows(remoteHistory);
  // Only exact instants are comparable across feeds. Preserve service order for
  // day headings, approximate ranges, and older cached rows with no timestamp.
  const exact=[...local,...account].filter(row=>Number.isFinite(row.time)).sort((a,b)=>b.time-a.time);
  const rows=[...exact,...local.filter(row=>!Number.isFinite(row.time)),...account.filter(row=>!Number.isFinite(row.time)),...historyRows(recent)];
  const playlistById=new Map(list(playlists).filter(p=>p?.id).map(p=>[p.id,p]));
  const portraits=new Map(),idsByName=new Map();
  function remember(name,id) {
    const key=nameKey(name);
    if (!key||!id) return;
    if (!idsByName.has(key)) idsByName.set(key,id);
    else if (idsByName.get(key)!==id) idsByName.set(key,null);
  }
  for (const artist of list(artists)) {
    if (!text(artist?.id)) continue;
    remember(artist.title||artist.name,artist.id);
    if (text(artist.artwork)) portraits.set(artist.id,artist.artwork);
  }
  const detailed=new Map(),keysById=new Map();
  for (const {track} of rows) {
    const id=track.source+':'+track.id;
    if (list(track.artists).length && !detailed.has(id)) detailed.set(id,track);
    if (!keysById.has(id) || keysById.get(id)===id) keysById.set(id,recordingKey(track));
    for (const credit of credits(track)) remember(credit?.name||credit?.title,credit?.id);
  }
  const songs=[],recentArtists=[],recentItems=[],seenSongs=new Set(),seenArtists=new Set(),seenItems=new Set();
  for (const {track,context} of rows) {
    const id=track.source+':'+track.id,rich=detailed.get(id)||track,key=keysById.get(id);
    if (songs.length<limit && !seenSongs.has(key)) {
      songs.push(rich);
      seenSongs.add(key);
    }
    const item=contextItem(context,playlistById);
    const itemKey=item?item.kind+':'+item.id:'song:'+key;
    if (recentItems.length<limit && !seenItems.has(itemKey)) {
      recentItems.push(item?{...item,track:rich}:{...rich,kind:'song'});
      seenItems.add(itemKey);
    }
    if (recentArtists.length<limit) for (const credit of credits(rich)) {
      const title=text(credit?.name||credit?.title||credit);
      const name=nameKey(title);
      if ((!text(credit?.id)&&/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(title)) || !name || name==='local audio' || name==='unknown artist') continue;
      const id=text(credit?.id)||idsByName.get(name), artistKey=id?'id:'+id:'name:'+name;
      if (seenArtists.has(artistKey)) continue;
      seenArtists.add(artistKey);
      const artwork=portraits.get(id);
      recentArtists.push({title,...(id?{id}:{}),...(artwork?{artwork}:{})});
      if (recentArtists.length===limit) break;
    }
    if ([songs,recentArtists,recentItems].every(items=>items.length===limit)) break;
  }
  return {recent:songs,recentArtists,recentItems};
}

module.exports={buildHomeHistory};

