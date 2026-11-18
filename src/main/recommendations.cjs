// Feedback and listening history stay local. Authentication and the playable
// music catalog belong to the account provider. MusicBrainz supplies discography dates.
const clean = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ').trim();
const artistName = value => clean(value).replace(/\s*-\s*topic$/, '').replace(/vevo$/, '').trim();
const unbox = value => value?.track || value;
const tracks = values => (Array.isArray(values) ? values : []).map(unbox).filter(t => t?.id && t.title && (!t.categoryId || String(t.categoryId) === '10'));
const keyOf = t => t?.id ? (t.source || 'youtube') + ':' + t.id : '';
const genresOf = t => (Array.isArray(t?.genres) ? t.genres : []).map(g => clean(typeof g === 'string' ? g : g?.name)).filter(Boolean);
const validArtist = name => name && !['local file','unknown artist','youtube music','various artists','unknown','local audio','youtube'].includes(artistName(name));
const artistOf = t => validArtist(t?.artist) ? artistName(t.artist) : '';
const artistID = t => t?.artistId || t?.channelId || '';
function artistMatches(a, b) {
  const first = artistID(a), second = artistID(b);
  if (first && second) return first === second;
  return Boolean(artistOf(a) && artistOf(a) === artistOf(b));
}
const unique = list => [...new Map(list.map(t => [keyOf(t), t])).values()];
const intersect = (a, b) => a.some(item => b.includes(item));
const titleKey = t => clean(t?.title).replace(/\s*[(\[](official (music )?(video|audio)|lyric video|audio|visuali[sz]er)[)\]]\s*$/i, '').trim();

function recordVote(feedback, vote, current) {
  const prior = Array.isArray(feedback?.votes) ? feedback.votes.filter(v => keyOf(v?.track)) : [];
  const sign = {like:1, up:1, more:1, dislike:-1, down:-1, different:-1, less:-1}[vote];
  if (!sign || !keyOf(current)) return {votes:prior.slice(-500)};
  const {id,source,title,artist,artistId,channelId,genres} = current;
  const other = prior.filter(entry => keyOf(entry.track) !== keyOf(current));
  return {votes:[...other, {sign, track:{id,source,title,artist,artistId,channelId,genres}}].slice(-500)};
}

function rankCandidates(candidates, {liked=[],played=[],current=null,feedback={},different=false} = {}) {
  const likes = tracks(liked);
  const recent = tracks(played).slice(0, 25);
  const votes = Array.isArray(feedback.votes) ? feedback.votes : [];
  const blocked = new Set([...recent, current, ...votes.filter(v => v.sign === -1).map(v => v.track)].map(keyOf));
  const recentNames = new Set([current,...recent].filter(t => artistOf(t)).map(t => artistOf(t) + '|' + titleKey(t)));
  const scores = unique(tracks(candidates)).filter(t => {
    if (blocked.has(keyOf(t)) || recentNames.has(artistOf(t) + '|' + titleKey(t))) return false;
    return !different || !artistMatches(t,current);
  }).map((track, index) => {
    let score = 0;
    const genre = genresOf(track);
    const related = (seed, weight) => {
      if (artistMatches(track, seed)) score += weight;
      else if (intersect(genre, genresOf(seed))) score += weight * 0.35;
    };
    for (const t of likes.slice(0,60)) related(t, 1);
    for (const [i,t] of recent.slice(0,12).entries()) related(t, .7 / (1 + i/4));
    if (current && !different) related(current, 2.5);
    for (const vote of votes.slice(-60)) related(vote.track, vote.sign > 0 ? 4 : -7);
    return {track, score, index};
  });
  const result = [], seen = new Set(), artistCounts = new Map();
  // Re-rank after each choice so a long catalog by one artist cannot drown out the rest.
  while (scores.length && result.length < 24) {
    const adjusted = row => row.score - 4 * (artistCounts.get(artistOf(row.track)) || 0);
    scores.sort((a,b) => adjusted(b) - adjusted(a) || a.index - b.index);
    const {track} = scores.shift();
    const artist = artistOf(track);
    const identity = artist ? artist + '|' + titleKey(track) : keyOf(track);
    if (seen.has(identity)) continue;
    seen.add(identity);
    artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    result.push(track);
  }
  return result;
}

function cacheLoader(maxSize) {
  const entries = new Map();
  return async (key, ttl, load) => {
    const old = entries.get(key);
    if (old && old.expires > Date.now()) return old.promise;
    if (entries.size >= maxSize) entries.delete(entries.keys().next().value);
    const promise = Promise.resolve().then(load);
    entries.set(key, {expires:Date.now()+ttl, promise});
    try {return await promise;} catch (err) {if (entries.get(key)?.promise === promise) entries.delete(key); throw err;}
  };
}

const escapeTerm = s => String(s).replace(/[\\"]/g, '\\$&');
const isMbid = s => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(s || '');
function localDate(date) {
  const pad = n => String(n).padStart(2,'0');
  return date.getFullYear() + '-' + pad(date.getMonth()+1) + '-' + pad(date.getDate());
}
function makeMusicBrainz(fetcher) {
  const cache = cacheLoader(400);
  let chain = Promise.resolve(), nextRequest = 0;
  return (resource, params) => {
    const url = new URL(resource, 'https://musicbrainz.org/ws/2/');
    url.search = new URLSearchParams({...params,fmt:'json'}).toString();
    return cache(url.href, 12*3600000, () => {
      const run = chain.then(async () => {
        const delay = nextRequest - Date.now();
        if (delay > 0) await new Promise(resolve => setTimeout(resolve,delay));
        nextRequest = Date.now()+1050;
        const response = await fetcher(url, {signal:AbortSignal.timeout(6000),headers:{
          'User-Agent':'YouTubeMusicMac/0.1 (independent macOS player)',
          Accept:'application/json',
        }});
        if (!response.ok) {
          if (response.status === 429 || response.status === 503) nextRequest = Date.now()+Math.max(5000, Math.min(60000, (Number(response.headers?.get('retry-after')) || 5)*1000));
          throw new Error('Discography temporarily unavailable');
        }
        return response.json();
      });
      chain = run.catch(() => {});
      return run;
    });
  };
}

function subscriptionArtist(s) {
  return {name: (s?.artist || s?.name || s?.title || '').replace(/\s*-\s*Topic$/i,'').replace(/VEVO$/, '').trim(),
    id:s?.channelId || s?.id, mbid:s?.mbid };
}

async function datedReleases(subscriptions, search, mb, now) {
  const subs = [...new Map((subscriptions || []).map(subscriptionArtist)
    .filter(s => validArtist(s.name)).map(s => [artistName(s.name), s])).values()];
  if (!subs.length) return [];
  const artists = [];
  // Resolve names in batches. Homonyms and unverified partial names never qualify.
  for (let offset=0; offset<subs.length; offset+=12) {
    const group = subs.slice(offset,offset+12);
    const missing = group.filter(s => !isMbid(s.mbid));
    let matches=[];
    if (missing.length) {
      const response = await mb('artist/',{query:missing.map(a=>'artist:"'+escapeTerm(a.name)+'"').join(' OR '),limit:100});
      matches = Array.isArray(response.artists) ? response.artists : [];
      if (response.count > matches.length && missing.length > 1) {
        // Ambiguous truncated results cannot establish unique identity.
        matches = [];
      }
    }
    for (const artist of group) {
      if (isMbid(artist.mbid)) {artists.push(artist); continue;}
      const exact = matches.filter(m => clean(m.name) === clean(artist.name) && isMbid(m.id));
      if (exact.length === 1) artists.push({...artist, mbid:exact[0].id});
    }
  }
  if (!artists.length) return [];
  const today = localDate(now);
  const from = new Date(now); from.setDate(from.getDate()-29);
  const earliest = localDate(from);
  const groups = [];
  for (let offset=0; offset<artists.length; offset+=25) {
    const group = artists.slice(offset,offset+25);
    const query = '('+group.map(a=>'arid:'+a.mbid).join(' OR ')+') AND status:official AND firstreleasedate:['+earliest+' TO '+today+']';
    const response = await mb('release-group/', {query,limit:100});
    for (const release of response['release-groups'] || []) {
      const date = release['first-release-date'];
      const artist = group.find(a => release['artist-credit']?.some(c => c.artist?.id === a.mbid));
      if (!artist || !/^\d{4}-\d\d-\d\d$/.test(date) || date<earliest || date>today ||
          !isMbid(release.id) || !['album','single','ep'].includes(clean(release['primary-type']))) continue;
      groups.push({release, artist, date});
    }
  }
  groups.sort((a,b)=> b.date.localeCompare(a.date));
  const seen = new Set(), result=[];
  for (const {release,artist,date} of groups.slice(0,10)) {
    let recordingTitle = release.title;
    if (clean(release['primary-type']) !== 'single') {
      if (!isMbid(release.id)) continue;
      const recordings = await mb('recording/', {query:'rgid:'+release.id+' AND arid:'+artist.mbid, limit:6});
      const recording = (recordings.recordings || []).find(r=>r.title && r['artist-credit']?.some(c=>c.artist?.id === artist.mbid));
      if (!recording) continue;
      recordingTitle = recording.title;
    }
    let hits;
    try { hits = await search(artist.name+' '+recordingTitle); } catch { continue; }
    // Only display an actual playable track matched to the dated release. A
    // similarly named YouTube upload is insufficient evidence of an album match.
    const track = tracks(hits).find(t => {
      const sameArtist = artistMatches(t,{artist:artist.name,channelId:artist.id});
      if (!sameArtist) return false;
      if (clean(t.album) === clean(release.title)) return true;
      const title = titleKey(t);
      return title === clean(recordingTitle) || title === clean(artist.name+' - '+recordingTitle);
    });
    if (track && !seen.has(keyOf(track))) {
      seen.add(keyOf(track));
      result.push({...track, releaseTitle:release.title,releaseDate:date,releaseGroupId:release.id,releaseSource:'MusicBrainz'});
    }
    if (result.length >= 6) break;
  }
  return result;
}

function createRecommendations({account,store,musicBrainz,fetcher=globalThis.fetch,now=()=>new Date()}) {
  const mb = musicBrainz || makeMusicBrainz(fetcher);
  const cachedSearch = cacheLoader(80);
  const cachedReleases = cacheLoader(10);
  const search = async query => {
    if (!account?.search) return [];
    return cachedSearch(query, 30*60000, async () => {
      const result = await account.search(query);
      return tracks(Array.isArray(result) ? result : result?.tracks);
    });
  };
  function inputs(opts={}) {
    const db = store?.data || {};
    const a = account?.snapshot?.() || db.account || {};
    return {
      history: tracks(opts.history ?? db.history ?? []),
      liked: tracks(opts.liked ?? a.liked ?? db.liked ?? []),
      subscriptions:opts.subscriptions ?? a.subscriptions ?? db.subscriptions ?? [],
      library:tracks(opts.library ?? db.library ?? []),
      playlists:opts.playlists ?? a.playlists ?? [],
    };
  }
  const cachedGenres = cacheLoader(200);
  async function artistGenres(track) {
    const supplied = genresOf(track);
    if (supplied.length) return supplied;
    const name = artistOf(track);
    if (!name) return [];
    // MusicBrainz distinguishes official genres from arbitrary user tags.
    // For an ambiguous artist, leave genre unknown; guesses would steer radio.
    try {
      return await cachedGenres(name, 12*3600000, async()=>{
        const response = await mb('artist/', {query:'artist:"'+escapeTerm(name)+'"',limit:10});
        const exact = (response.artists || []).filter(a=>artistName(a.name) === name && isMbid(a.id));
        if (exact.length !== 1 || response.count > 10) return [];
        const profile = await mb('artist/'+exact[0].id, {inc:'genres'});
        return (profile.genres || []).filter(g => g.count > 0 && g.name)
          .sort((a,b) => b.count - a.count).slice(0,4).map(g=>clean(g.name));
      });
    } catch { return []; }
  }
  async function verifiedPivot(current, data, feedback) {
    if (!artistOf(current)) return null;
    const baseline = await artistGenres(current);
    if (!baseline.length) return null;
    const pool = [ ...feedback.votes.filter(v=>v.sign===1).reverse().map(v=>v.track),
      ...data.liked, ...data.history, ...data.library,
      ...data.subscriptions.map(subscriptionArtist).map(s=>({artist:s.name,channelId:s.id})) ];
    const seeds = [], seen = new Set();
    for (const entry of pool) {
      const artist = artistOf(entry);
      if (!artist || artistMatches(entry,current) || seen.has(artist)) continue;
      seen.add(artist);
      seeds.push(entry);
      if (seeds.length >= 5) break;
    }
    // Candidate genre is attributable only when its artist matches the verified
    // seed artist. Query text and the YouTube 'Music' category do not prove genre.
    for (const seed of seeds) {
      const genres = await artistGenres(seed);
      if (!genres.length || intersect(baseline,genres)) continue;
      let hits=[];
      try { hits = await search(seed.artist); } catch { /* try known tracks */ }
      const exact = unique([...hits,...data.liked,...data.library]).filter(t=>artistMatches(t,seed))
        .map(t=>({...t, genres, radioReason:'Alternative artist: '+seed.artist+' · '+genres[0]}));
      const result = rankCandidates(exact,{current,liked:data.liked,played:data.history,feedback,different:true});
      if (result.length) return result[0];
    }
    return null;
  }
  async function candidates({current, liked, history, library, subscriptions, playlists, feedback, different}) {
    const voted = feedback?.votes || [];
    const saved = tracks(playlists.flatMap(p=>p.tracks || []));
    const following = subscriptions.map(subscriptionArtist).map(s=>({artist:s.name,channelId:s.id}));
    const pool = [current,...voted.filter(v=>v.sign===1).reverse().map(v=>v.track),...liked,...history,...library,...saved,...following];
    const ordered = different ? [...pool.filter(t=>!artistMatches(t,current)), ...pool.filter(t=>artistMatches(t,current))] : pool;
    const names = [...new Set(ordered.filter(t=>artistOf(t) && (!different || !artistMatches(t,current))).map(t=>t.artist))].slice(0,3);
    const queries = names.slice();
    // A genre query is supported only by supplied genre metadata on a real seed.
    const genreSeed = ordered.find(t=>genresOf(t).length && (!different || !artistMatches(t,current)));
    const lead = ordered.find(t=>artistOf(t));
    const genre = genresOf(genreSeed)[0] || (!different && lead && names.length === 1 ? (await artistGenres(lead))[0] : null);
    if (genre) queries.push(genre+' music');
    const found = await Promise.allSettled(queries.map(search));
    return unique([...found.filter(v=>v.status==='fulfilled').flatMap(v=>v.value),...liked,...library,...saved]);
  }
  return {
    async home(options) {
      const data = inputs(options);
      const feedback = options?.feedback || store?.data?.feedback || {};
      const subsKey = localDate(now()) + JSON.stringify(data.subscriptions.map(subscriptionArtist));
      const [hits,releases] = await Promise.all([
        candidates({...data,feedback}),
        cachedReleases(subsKey, 6*3600000,()=>datedReleases(data.subscriptions,search,mb,now())).catch(()=>[]),
      ]);
      const known = new Set([...data.liked,...data.library,...data.history].map(keyOf));
      const discover = rankCandidates(hits.filter(t => !known.has(keyOf(t))),{liked:data.liked,played:data.history,feedback}).slice(0,12);
      return {releases,discover,releaseLabel:'New from artists you follow'};
    },
    async pick({vote,current,played,liked,feedback,...options}={}) {
      const data = inputs({...options,history:played,liked});
      const updated = recordVote(feedback || {},vote,current);
      const different = ['different','dislike','down','less'].includes(vote);
      if (different) {
        const alternate = await verifiedPivot(current,data,updated);
        if (alternate) return {track:alternate,feedback:updated};
      }
      const hits = await candidates({...data,current,feedback:updated,different});
      const ranked = rankCandidates([...hits,...tracks(options.discover)],{current,played:data.history,liked:data.liked,feedback:updated,different});
      return {track:ranked[0] || null,feedback:updated};
    },
  };
}
module.exports = {createRecommendations,rankCandidates,datedReleases,recordVote};

