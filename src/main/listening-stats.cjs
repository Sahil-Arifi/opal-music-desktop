const {recordingKey}=require('./recording.cjs');
const periods = {
  week: 'Available history for the past seven days.',
  month: 'Available history for the past month.',
};

function periodStart(period, now) {
  const year=now.getFullYear(),month=now.getMonth(),day=now.getDate();
  if (period==='week') return new Date(year,month,day-6);
  const lastDayOfPriorMonth=new Date(year,month,0).getDate();
  return new Date(year,month-1,Math.min(day,lastDayOfPriorMonth));
}

function dayOf(date) {
  return [date.getFullYear(), String(date.getMonth()+1).padStart(2,'0'), String(date.getDate()).padStart(2,'0')].join('-');
}

function localDay(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y,m,d] = key.split('-').map(Number);
  const result = new Date(y,m-1,d);
  return dayOf(result) === key ? result : null;
}

function normalize(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLocaleLowerCase('en-US') : '';
}

function richer(left,right) {
  const merged = {...left};
  for (const field of ['title','artist','album','artwork','channelId','albumId','artists','duration']) {
    if ((!merged[field] || (Array.isArray(merged[field]) && !merged[field].length)) && right[field]) merged[field] = right[field];
  }
  return merged;
}

function bucket() {
  return {exact:new Map(), approximate:0};
}

const sourceCounts = () => ({account:0,import:0,local:0});

// Two services can describe the same listen at different precisions. Within
// overlapping ranges only the highest independently supported count is certain.
function groupRanges(ranges) {
  const groups=[];
  for (const range of ranges.sort((a,b)=>a.from.localeCompare(b.from))) {
    let group=groups.at(-1);
    if (!group || range.from>group.to) {
      group={from:range.from,to:range.to,counts:sourceCounts(),dated:0};
      groups.push(group);
    } else if (range.to>group.to) group.to=range.to;
    group.counts[range.source]++;
  }
  return groups;
}

function computeStats({history=[], remoteHistory=[]}={}, period='month', now=new Date()) {
  if (!Object.hasOwn(periods,period)) throw Error('Choose a supported listening period.');
  now = new Date(now);
  if (!Number.isFinite(+now)) throw Error('Invalid listening period end.');
  const today = dayOf(now);
  const lower = periodStart(period, now);
  const first = dayOf(lower);
  const tracks = new Map();
  const canonicalRecordings = new Map(), artistIds = new Map(), albumIds = new Map();
  const localEntries = Array.isArray(history) ? history : [];
  const accountEntries = Array.isArray(remoteHistory) ? remoteHistory : [];
  const artistsOf = track => Array.isArray(track.artists) && track.artists.length ? track.artists : [{name:track.artist,id:track.channelId}];
  const albumKey = track => JSON.stringify([normalize(track.album),normalize(track.artist)]);
  function remember(map,name,id) {
    if (!name || !id) return;
    if (!map.has(name)) map.set(name,id);
    else if (map.get(name)!==id) map.set(name,null);
  }
  // Playback and the history shelf can credit a collaboration differently.
  // Use the verified video ID first; account cards carry individual artist credits.
  for (const entry of [...accountEntries,...localEntries]) {
    const track=entry?.track;
    if (!track || typeof track.id!=='string' || !track.id || track.source!=='youtube' || (entry.product && entry.product!=='youtube-music')) continue;
    const key=recordingKey(track);
    if (!canonicalRecordings.has(track.id) || canonicalRecordings.get(track.id)==='youtube:'+track.id) canonicalRecordings.set(track.id,key);
    for (const credit of artistsOf(track)) if (credit?.id) remember(artistIds,normalize(credit.name),credit.id);
    if (normalize(track.album)) remember(albumIds,albumKey(track),track.albumId);
  }
  let untimedPlays = 0;
  let crossingWindow = 0;

  function ingest(entry, remote) {
    const track=entry?.track;
    if (!track || typeof track.id !== 'string' || !track.id || !['youtube','local'].includes(track.source)) return;
    if (entry.product && entry.product !== 'youtube-music') return;
    const key=track.source==='youtube'?canonicalRecordings.get(track.id):track.source+':'+track.id;
    const stamp = typeof entry.playedAt === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d\d:\d\d)$/.test(entry.playedAt) ? Date.parse(entry.playedAt) : NaN;
    const date = Number.isFinite(stamp) ? new Date(stamp) : localDay(entry.playedOn || entry.playedAt);
    const day = date ? dayOf(date) : '';
    if (day > today || (Number.isFinite(stamp) && stamp > +now)) return;
    const group = remote || entry.origin === 'account' ? 'account' : entry.origin === 'import' ? 'import' : 'local';
    if (!tracks.has(key)) tracks.set(key,{track, days:new Map(), ranges:[]});
    const item=tracks.get(key);
    item.track=richer(item.track,track);
    if (!day) {
      const range=entry.playedRange;
      if (range && localDay(range.from) && localDay(range.to) && range.from<=range.to && range.to<=today) {
        if (range.from>=first) item.ranges.push({...range,source:group});
        else if (range.to>=first) crossingWindow++;
        return;
      }
      untimedPlays++;
      return;
    }
    if (!item.days.has(day)) item.days.set(day,{account:bucket(),import:bucket(),local:bucket()});
    const side=item.days.get(day)[group];
    if (!Number.isFinite(stamp)) { side.approximate++; return; }
    const seconds = Number.isFinite(entry.listenSeconds) && entry.listenSeconds>0 ? entry.listenSeconds : 0;
    side.exact.set(stamp, Math.max(seconds,side.exact.get(stamp)||0));
  }
  for (const entry of accountEntries) ingest(entry,true);
  for (const entry of localEntries) ingest(entry,false);

  const songs=[], artists=new Map(), albums=new Map();
  let plays=0, seconds=0;
  let measuredPlays=0,estimatedPlays=0,estimatedSeconds=0;
  function add(map,id,name,artist,artwork,count,time,estimate) {
    const row=map.get(id) || {id,name,artwork:artwork||'',plays:0,seconds:0,estimatedSeconds:0,listeningSeconds:0,...(artist?{artist}:{})};
    row.plays+=count;row.seconds+=time;row.estimatedSeconds+=estimate;row.listeningSeconds+=time+estimate;
    if (!row.artwork && artwork) row.artwork=artwork;
    map.set(id,row);
  }

  for (const {track,days,ranges} of tracks.values()) {
    let count=0, time=0, measuredCount=0;
    const groups=groupRanges(ranges);
    for (const [day,group] of days) {
      if (day<first) continue;
      // A history row may be mirrored across local playback, Takeout, and the
      // account. With day-only server timestamps, use the largest proven number
      // of occurrences on that day, without assuming each feed observed new ones.
      const counts=[], timestamps=new Set();
      const rangeGroup=groups.find(range=>range.from<=day && day<=range.to);
      const measured=new Map();
      for (const [kind,side] of Object.entries(group)) {
        const quantity=side.exact.size+side.approximate;
        if (rangeGroup) rangeGroup.counts[kind]+=quantity;
        counts.push(quantity);
        for (const [at,secs] of side.exact) {
          timestamps.add(at);
          measured.set(at,Math.max(secs,measured.get(at)||0));
        }
      }
      const datedPlays=Math.max(timestamps.size,...counts);
      if (rangeGroup) rangeGroup.dated+=datedPlays;
      else count+=datedPlays;
      for (const recorded of measured.values()) {
        if (recorded>0) {time+=recorded;measuredCount++;}
      }
    }
    for (const group of groups) {
      count+=Math.max(group.dated,...Object.values(group.counts));
    }
    if (!count) continue;
    plays+=count;seconds+=time;
    measuredPlays+=measuredCount;
    // The service publishes a recording's duration, not time actually heard.
    // Estimate only entries with no measured app session, after feed deduplication.
    let estimate=0;
    if (Number.isFinite(track.duration) && track.duration>0) {
      const unmeasured=count-measuredCount;
      estimatedPlays+=unmeasured;
      estimate=unmeasured*track.duration;estimatedSeconds+=estimate;
    }
    songs.push({...track,plays:count,seconds:time});
    const credited=artistsOf(track);
    const namesSeen=new Set();
    for (const credit of credited) {
      const name=typeof credit==='string'?credit:credit?.name;
      if (!normalize(name) || name==='Local audio' || namesSeen.has(normalize(name))) continue;
      namesSeen.add(normalize(name));
      add(artists,credit?.id || artistIds.get(normalize(name)) || normalize(name),name,'',track.artwork,count,time,estimate);
    }
    if (normalize(track.album)) {
      const id=track.albumId || albumIds.get(albumKey(track)) || albumKey(track);
      const credit=track.albumArtist || track.artist || '';
      const existing=albums.get(id);
      if (existing && normalize(existing.artist)!==normalize(credit)) delete existing.artist;
      add(albums,id,track.album,credit,track.artwork,count,time,estimate);
    }
  }
  const rank=rows=>rows.sort((a,b)=>b.plays-a.plays || b.seconds-a.seconds || (a.name||a.title||'').localeCompare(b.name||b.title||'') || a.id.localeCompare(b.id));
  const round=rows=>rows.map(row=>({...row,seconds:Math.round(row.seconds)}));
  const scope=[periods[period]];
  const uncertain=untimedPlays+crossingWindow;
  if (uncertain) scope.push(uncertain.toLocaleString()+(uncertain===1?' entry has':' entries have')+' no confirmed date in this period.');
  return {
    period,totals:{plays,seconds:Math.round(seconds),artists:artists.size,songs:songs.length,albums:albums.size},
    time:{measuredSeconds:Math.round(seconds),measuredPlays,estimatedSeconds:Math.round(estimatedSeconds),estimatedPlays,
      unknownPlays:plays-measuredPlays-estimatedPlays},
    artists:round([...artists.values()].sort((a,b)=>b.listeningSeconds-a.listeningSeconds||b.plays-a.plays)),songs:round(rank(songs)),albums:round([...albums.values()].sort((a,b)=>b.listeningSeconds-a.listeningSeconds||b.plays-a.plays)),
    coverage:{from:lower.toISOString(),to:now.toISOString(),scope:scope.join(' '),untimedPlays},
  };
}

module.exports={computeStats};

