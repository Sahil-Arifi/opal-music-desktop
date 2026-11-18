const {videoId} = require('./youtube-api.cjs');

const limit = 20000;
const changed = () => Error('The playlist changed. Refresh it before saving your order.');

function orderedTracks(tracks, ids, exact) {
  // Pop source positions in their original order, including distinct metadata
  // for two occurrences of the same recording. Leave unmatched additions in place.
  const positions = new Map();
  for (let i = tracks.length - 1; i >= 0; i--) {
    const id = tracks[i].id;
    if (!positions.has(id)) positions.set(id, []);
    positions.get(id).push(i);
  }
  const used = new Uint8Array(tracks.length);
  const ordered = [];
  for (const id of ids) {
    const index = positions.get(id)?.pop();
    if (index === undefined) {
      if (exact) throw changed();
      continue;
    }
    used[index] = 1;
    ordered.push(tracks[index]);
  }
  if (!exact) {
    for (let i = 0; i < tracks.length; i++) if (!used[i]) ordered.push(tracks[i]);
  }
  return ordered;
}

function applyOrder(tracks, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > limit) return tracks.slice();
  return orderedTracks(tracks, ids, false);
}

function validateOrder(tracks, ids) {
  if (!Array.isArray(tracks)) throw Error('Open the playlist before saving your order.');
  if (!Array.isArray(ids)) throw Error('Invalid playlist order.');
  if (ids.length > limit || tracks.length > limit) throw Error('Custom ordering supports up to 20,000 playlist entries.');
  if (ids.length !== tracks.length) throw changed();
  for (const id of ids) if (!videoId(id)) throw Error('Invalid track ID in playlist order.');
  return orderedTracks(tracks, ids, true);
}

module.exports = {applyOrder, validateOrder};

// A visible playlist can lag a background refresh or a just-confirmed Like.
// Its normalized snapshot identifies the exact clicked occurrence, while new
// source additions join the tail instead of invalidating playback.
function resolveVisibleOrder(tracks, ids, view) {
  if(view===undefined){if(!Array.isArray(tracks))throw Error('Open the playlist before playing it.');return validateOrder(tracks,ids);}
  if(!Array.isArray(ids)||ids.length>limit||ids.some(id=>!videoId(id)))throw Error('Invalid playlist order.');
  const snapshot=view;
  if(!Array.isArray(snapshot)||snapshot.length!==ids.length||snapshot.some((t,i)=>t?.id!==ids[i]))throw Error('Invalid playlist snapshot.');
  const source=Array.isArray(tracks)?tracks:[],positions=new Map(),used=new Set();
  for(let i=source.length-1;i>=0;i--){const list=positions.get(source[i].id)||[];list.push(i);positions.set(source[i].id,list);}
  const ordered=ids.map((id,i)=>{const at=positions.get(id)?.pop();if(at!==undefined){used.add(at);return source[at];}if(snapshot[i])return snapshot[i];throw Error('The selected song is no longer available.');});
  for(let i=0;i<source.length;i++)if(!used.has(i))ordered.push(source[i]);
  return ordered;
}
module.exports.resolveVisibleOrder=resolveVisibleOrder;

