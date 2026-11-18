// A display identity for alternate uploads of the same recording, not playlist entries.
function recordingKey(track){
  if(!track)return '';
  const clean=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const artist=[...new Set(clean(track.artist).replace(/\s*-\s*topic$/,'').split(/\s*(?:,|&|\bfeaturing\b|\bfeat\b\.?)\s*/).map(name=>name.replace(/[^a-z0-9\p{L}\p{N}]+/gu,' ').trim()).filter(Boolean))].sort().join(' & ');
  let title=clean(track.title).replace(/\s*[\[(](?:official\s+)?(?:music\s+video|video|audio|visuali[sz]er|lyrics?|lyric\s+video)(?:\s+[^\])]+)?[\])]/g,'');
  const artistPrefix=clean(track.artist).replace(/\s*-\s*topic$/,'');
  if(title.startsWith(artistPrefix+' - '))title=title.slice(artistPrefix.length+3);
  title=title.replace(/\s*(?:[-–—:]\s*)?(?:official\s+)?(?:music\s+video|official\s+(?:video|audio)|lyric\s+video|visuali[sz]er)\s*$/,'').trim();
  title=title.replace(/\b(?:ft|featuring|feat)\.?\s*/g,'feat ').replace(/[^a-z0-9\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim();
  return artist&&title?artist+'|'+title:track.source+':'+track.id;
}
// Keep deliberate repeats of the same source ID, but merge alternate uploads.
function mergeRecordingVariants(tracks,current,allowLeadingRepeat=false){
  const known=new Map(),currentKey=current?recordingKey(current):'';let leading=true;
  if(current)known.set(currentKey,current.source+':'+current.id);
  return tracks.filter(track=>{
    if(track?.source!=='youtube')return !!track;
    const key=recordingKey(track),id=track.source+':'+track.id,previous=known.get(key);
    if(current&&!allowLeadingRepeat&&leading&&key===currentKey)return false;
    leading=false;
    if(previous && previous!==id)return false;
    known.set(key,id);return true;
  });
}
module.exports={recordingKey,mergeRecordingVariants};

