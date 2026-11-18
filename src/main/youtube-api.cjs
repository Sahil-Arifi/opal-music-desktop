const YOUTUBE = 'https://www.googleapis.com/youtube/v3/';
const videoId = value => typeof value === 'string' && /^[\w-]{11}$/.test(value);

function linkedVideoId(text) {
  if (typeof text !== 'string') return null;
  let url;
  try { url = new URL(text.includes('://') ? text : 'https://' + text); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  let id;
  if (url.hostname === 'youtu.be') id = url.pathname.slice(1);
  else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','www.youtube-nocookie.com'].includes(url.hostname)) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else id = url.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]+)\/?$/)?.[1];
  }
  return videoId(id) ? id : null;
}

function cover(snippet) {
  const thumbs = snippet?.thumbnails || {};
  return (thumbs.maxres || thumbs.standard || thumbs.high || thumbs.medium || thumbs.default)?.url || '';
}
function duration(iso = '') {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (!m) return 0;
  const [, days=0, hours=0, minutes=0, seconds=0] = m;
  return Number(days)*86400 + Number(hours)*3600 + Number(minutes)*60 + Number(seconds);
}
function toTrack(item) {
  const s = item?.snippet, id = item.id;
  if (!s || !videoId(id) || !s.title || item.status?.privacyStatus === 'private') return null;
  return { id, title: s.title, artist: s.channelTitle || '', artwork: cover(s), duration: duration(item.contentDetails?.duration),
    source: 'youtube', channelId: s.channelId || '', publishedAt: s.publishedAt || '', categoryId: s.categoryId || '' };
}
class YouTubeAPI {
  constructor(authFetch) { this.authFetch = authFetch; }
  async request(resource, params, method = 'GET') {
    const url = new URL(resource, YOUTUBE);
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, value);
    const response = await this.authFetch(url, {method});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const reason = data.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw Error('The YouTube API daily quota has been reached. Try again after it resets.');
      if (reason === 'accessNotConfigured' || reason === 'serviceDisabled') throw Error('Enable YouTube Data API v3 in the Google Cloud project that owns your desktop credentials.');
      if (reason === 'youtubeSignupRequired') throw Error('Create a YouTube channel for this Google account, then sync again.');
      if (response.status === 403) throw Error('YouTube denied this request. Check the account permissions and project settings.');
      if (response.status === 404) throw Error('This item is private, unavailable, or has been removed.');
      throw Error('YouTube could not complete the request (HTTP ' + response.status + ').');
    }
    return response.status === 204 ? {} : response.json();
  }
  async list(resource, params, limit = Infinity) {
    const items = [], used = new Set();
    let pageToken;
    do {
      const data = await this.request(resource, {...params, maxResults:Math.min(50, limit - items.length), pageToken});
      items.push(...(data.items || []));
      pageToken = data.nextPageToken;
      if (used.has(pageToken)) break;
      used.add(pageToken);
    } while (pageToken && items.length < limit);
    return items.slice(0, limit);
  }
  async tracks(ids) {
    const map = new Map(), unique = [...new Set(ids.filter(videoId))];
    for (let i = 0; i < unique.length; i += 50) {
      const data = await this.request('videos', {part:'snippet,contentDetails,status', id:unique.slice(i,i+50).join(',')});
      for (const item of data.items || []) {
        const track = toTrack(item);
        if (track) map.set(track.id, track);
      }
    }
    return ids.map(id => map.get(id)).filter(Boolean);
  }
  async liked() {
    return (await this.list('videos', {part:'snippet,contentDetails,status', myRating:'like'}, 1000)).map(toTrack).filter(Boolean);
  }
  async playlists() {
    return (await this.list('playlists', {part:'snippet,contentDetails', mine:true})).map(p => ({
      id:p.id, title:p.snippet.title, artist:p.snippet.channelTitle || '', artwork:cover(p.snippet), count:p.contentDetails?.itemCount || 0, source:'youtube'
    }));
  }
  async subscriptions() {
    const rows = await this.list('subscriptions', {part:'snippet', mine:true});
    const artists = rows.filter(s => s.snippet?.resourceId?.channelId).map(s => ({
      id:s.snippet.resourceId.channelId, title:s.snippet.title, artwork:cover(s.snippet), uploadsPlaylistId:''
    }));
    for (let i=0; i<artists.length; i+=50) {
      const group = artists.slice(i, i+50);
      const {items=[]} = await this.request('channels', {part:'contentDetails', id:group.map(c=>c.id).join(',')});
      const channels = new Map(items.map(c => [c.id, c.contentDetails?.relatedPlaylists?.uploads || '']));
      for (const artist of group) artist.uploadsPlaylistId = channels.get(artist.id) || '';
    }
    return artists;
  }
  async playlist(id, limit) {
    if (typeof id !== 'string' || !/^[\w-]{2,128}$/.test(id)) throw Error('Invalid YouTube playlist.');
    const items = await this.list('playlistItems', {part:'contentDetails',playlistId:id}, limit);
    return this.tracks(items.map(p=>p.contentDetails?.videoId));
  }
  async search(input) {
    const q = String(input || '').trim().slice(0,300);
    if (!q) return [];
    const id=linkedVideoId(q);
    if(id)return this.tracks([id]);
    if(/^https?:\/\//i.test(q)) throw Error('Paste a YouTube video or song link, or search by title and artist.');
    const {items=[]} = await this.request('search',{part:'snippet', type:'video', videoCategoryId:'10', q, maxResults:25});
    return this.tracks(items.map(s=>s.id?.videoId));
  }
  async getRating(id) {
    if (!videoId(id)) throw Error('Invalid YouTube video ID.');
    const {items=[]} = await this.request('videos/getRating',{id});
    const rating = items.find(item=>item.videoId===id)?.rating;
    if (!['like','dislike','none'].includes(rating)) throw Error('YouTube could not confirm your current rating. Please try again.');
    return rating;
  }
  async rate(id, rating) {
    if (!videoId(id) || !['like','dislike','none'].includes(rating)) throw Error('Invalid YouTube rating.');
    await this.request('videos/rate',{id,rating},'POST');
  }
}
module.exports = {YouTubeAPI, toTrack, videoId, linkedVideoId};

