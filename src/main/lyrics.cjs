const {setTimeout: delay} = require('node:timers/promises');
const {version} = require('../../package.json');
const {createWordLyrics} = require('./word-lyrics.cjs');

const CLIENT = 'YouTubeMusicMac/' + version + ' (standalone desktop music player)';
const PROVIDER = 'https://lrclib.net/api/';
const unavailable = () => ({lines: [], synced: false});
const timestamp = /^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]\s*/;

const wordStamp=/<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>/g;
const milliseconds=parts=>(Number(parts[1])*60+Number(parts[2]))*1000+Number((parts[3]||'').padEnd(3,'0'));

function timedText(value,offset,lineStart) {
  const text=value.replace(wordStamp,'').trim();
  const stamps=[...value.matchAll(wordStamp)];
  if (!text || !stamps.length || value.slice(0,stamps[0].index).trim()) return {text};
  const positions=stamps.map(m=>Math.max(0,milliseconds(m)-offset));
  if (positions[0]<lineStart || positions.some((at,i)=>i>0 && at<positions[i-1])) return {text};
  const words=[];
  for (let i=0;i<stamps.length;i++) {
    const segment=value.slice(stamps[i].index+stamps[i][0].length,stamps[i+1]?.index);
    if (!segment) continue;
    words.push({text:segment,start:positions[i]/1000,...(i+1<positions.length?{end:positions[i+1]/1000}:{})});
  }
  if (!words.length) return {text};
  words[0].text=words[0].text.trimStart();
  words.at(-1).text=words.at(-1).text.trimEnd();
  return {text,words};
}

function parseLRC(input) {
  if (typeof input !== 'string' || input.length > 280000) return [];
  // LRC's positive offset advances the cues by this many milliseconds.
  const offset = Number(input.match(/^\s*\[offset:\s*([+-]?\d{1,7})\s*\]\s*$/im)?.[1]) || 0;
  const cues = new Map();
  for (let raw of input.split(/\r?\n/)) {
    raw = raw.trimStart();
    const times = [];
    let match;
    while ((match = raw.match(timestamp))) {
      const ms = milliseconds(match);
      times.push(Math.max(0, ms - offset));
      raw = raw.slice(match[0].length);
    }
    if (!times.length) continue;
    const background=raw.trim().match(/^\[bg:\s*(.*)\]$/i);
    const value=background?background[1]:raw;
    const firstWord=value.match(/<(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?>/);
    const firstTime=firstWord?Math.max(0,milliseconds(firstWord)-offset):-1;
    const markedRepeat=times.reduce((best,t)=>t<=firstTime?Math.max(best,t):best,-1);
    for (const ms of times) {
      // Absolute word timestamps only apply to the specifically marked repeat.
      const applicable=times.length===1 || ms===markedRepeat;
      const vocal=timedText(applicable?value:value.replace(wordStamp,''),offset,ms);
      const cue=cues.get(ms)||{time:ms/1000,text:''};
      if (background && vocal.text) {
        cue.adlibs=[...new Set([...(cue.adlibs||[]),vocal.text])];
        const words=vocal.words;
        const part={...vocal,start:words?.[0]?.start??cue.time,...(words?.at(-1)?.end!=null?{end:words.at(-1).end}:{})};
        if (!cue.backing?.some(v=>v.text===part.text && v.start===part.start)) (cue.backing||=[]).push(part);
      } else if (vocal.text && !cue.text.split('\n').includes(vocal.text)) {
        if (cue.text) {
          cue.text+='\n'+vocal.text;
          delete cue.words; // Concurrent lead voices have separate timelines.
        } else Object.assign(cue,vocal);
      }
      cues.set(ms, cue);
    }
  }
  const lines = [...cues.values()].sort((a, b) => a.time - b.time);
  // Blank timestamps can close a phrase before an instrumental break.
  return lines.some(line => line.text || line.adlibs?.length) ? lines : [];
}

function normalized(value) {
  return typeof value === 'string' ? value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() : '';
}

function credits(title, artist) {
  if (typeof title !== 'string' || typeof artist !== 'string') return null;
  const split = text => text.split(/\s+(?:feat(?:uring)?\.?|ft\.?|with|and|x|&)\s+|\s*[,;•]\s*|\s+\/\s+/i)
    .map(name => name.trim()).filter(Boolean);
  const names = split(artist);
  const base = title.replace(/\s*[(\[]\s*(?:feat(?:uring)?\.?|ft\.?|with)\s+([^()\[\]]+)[)\]]/gi, (_, guests) => {
    names.push(...split(guests));
    return '';
  }).replace(/\s+(?:feat(?:uring)?\.?|ft\.?)\s+([^()\[\]]+)$/i, (_, guests) => {
    names.push(...split(guests));
    return '';
  }).trim();
  const members = [...new Set(names.map(normalized).filter(Boolean))];
  if (!members.length || !normalized(base)) return null;
  return {base, primary: names[0], names: members, identity: JSON.stringify([normalized(base), members.sort()])};
}

function signature(track) {
  const text = value => typeof value === 'string' && value.length <= 500 ? value.trim() : '';
  const title = text(track?.title).replace(/\s*[(\[](?:official\s+)?(?:music video|video|audio|lyric video|lyrics)[)\]]\s*$/i, '').trim();
  const artist = text(track?.artist).replace(/\s+-\s+Topic$/i, '').trim();
  const album = text(track?.album);
  if (!normalized(title) || !normalized(artist) || /^(?:local audio|unknown artist)$/i.test(artist)) return null;
  if (track.duration != null && (!Number.isFinite(track.duration) || track.duration < 0 || track.duration > 3600)) return null;
  const duration = Math.round(track.duration || 0);
  const credit = credits(title, artist);
  return credit ? {title, artist, album, duration, credit} : null;
}

function sameSong(record, track) {
  return !!record && credits(record.trackName || record.name, record.artistName)?.identity === track.credit.identity;
}

function matches(record, track) {
  if (!sameSong(record, track)) return false;
  if (track.duration) return Number.isFinite(record.duration) && Math.abs(record.duration - track.duration) <= 2;
  return !!track.album && normalized(record.albumName) === normalized(track.album);
}

function fromRecord(record, track) {
  if (record.instrumental === true) return {...unavailable(), source: 'LRCLIB', instrumental: true};
  const cues = parseLRC(record.syncedLyrics);
  const plain = typeof record.plainLyrics === 'string' && record.plainLyrics.length <= 280000 ? record.plainLyrics.trim() : '';
  if (track.duration && cues.length) return {lines: cues, synced: true, source: 'LRCLIB'};
  const transcript = plain || cues.map(line => [line.text, ...(line.adlibs || []).map(text => '(' + text + ')')].filter(Boolean).join(' ')).filter(Boolean).join('\n');
  return transcript ? {...unavailable(), plain: transcript, source: 'LRCLIB'} : unavailable();
}

function untimed(records, track) {
  const transcripts = new Map();
  for (const row of records) {
    if (!sameSong(row, track)) continue;
    if (track.album && normalized(row.albumName) !== normalized(track.album)) continue;
    // An alternate recording's timestamps and instrumental annotation cannot
    // describe this playback. Retain only actual lyrics text with corroboration.
    const result = fromRecord(row, {...track, duration: 0});
    if (!result.plain) continue;
    const key = normalized(result.plain);
    if (!key) continue;
    const entry = transcripts.get(key) || {result, ids: new Set()};
    if (Number.isSafeInteger(row.id)) entry.ids.add(row.id);
    transcripts.set(key, entry);
  }
  const best = [...transcripts.values()].sort((a, b) => b.ids.size - a.ids.size)[0];
  if (!best) return unavailable();
  // An exact named release is stronger evidence than text from a single
  // unrelated release. With no album, require two independent catalog entries.
  return (track.album && transcripts.size === 1) || best.ids.size >= 2 ? best.result : unavailable();
}

function createLyrics({fetchImpl = fetch, spacing = 250, timeout = 10000, wordLyrics=createWordLyrics({fetchImpl})} = {}) {
  const cache = new Map();
  const pending = new Map();
  let nextRequest = 0, retryAfter = 0, queue = Promise.resolve();

  async function request(endpoint, params) {
    if (Date.now() < retryAfter) throw Error('throttled');
    if (Date.now() < nextRequest) await delay(nextRequest - Date.now());
    const url = new URL(endpoint, PROVIDER);
    url.search = new URLSearchParams(params);
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(timeout), redirect: 'error',
        headers: {Accept: 'application/json', 'User-Agent': CLIENT},
      });
      if (response.status === 429 || response.status === 503) {
        const header = response.headers.get('retry-after');
        const seconds = header && /^\d+$/.test(header) ? Number(header) :
          Math.max(1, (Date.parse(header) - Date.now()) / 1000) || 60;
        retryAfter = Date.now() + seconds * (1 + Math.random() * 0.1) * 1000;
        throw Error('throttled');
      }
      if (response.status === 404) return null;
      if (!response.ok || !response.headers.get('content-type')?.includes('json')) throw Error('unavailable');
      return await response.json();
    } finally {
      nextRequest = Date.now() + spacing;
    }
  }

  async function lookup(track) {
    const params = {track_name: track.title, artist_name: track.artist};
    if (track.album) params.album_name = track.album;
    if (track.duration) params.duration = String(track.duration);
    const exact = await request('get', params);
    if (matches(exact, track)) {
      const result = fromRecord(exact, track);
      if (result.source) return result;
    }
    const searches = [{track_name: track.title, artist_name: track.artist}];
    if (track.credit.base !== track.title || track.credit.primary !== track.artist) {
      searches.push({track_name: track.credit.base, artist_name: track.credit.primary});
    }
    const candidates = exact ? [exact] : [];
    for (const query of searches) {
      const rows = await request('search', query);
      if (!Array.isArray(rows)) continue;
      candidates.push(...rows);
      const score = row => (track.album && normalized(row.albumName) === normalized(track.album) ? 10 : 0) -
        (track.duration ? Math.abs(track.duration - row.duration) : 0);
      const verified = rows.filter(row => matches(row, track)).sort((a, b) => score(b) - score(a));
      for (const row of verified) {
        const result = fromRecord(row, track);
        if (result.source) return result;
      }
    }
    return untimed(candidates, track);
  }

  return function getLyrics(input) {
    const track = signature(input);
    if (!track || (!track.duration && !track.album)) return Promise.resolve(unavailable());
    const key = JSON.stringify([normalized(track.title), normalized(track.artist), normalized(track.album), track.duration]);
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) {
      cache.delete(key); cache.set(key, hit);
      return Promise.resolve(hit.result);
    }
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 8) return Promise.resolve({...unavailable(), error: 'Lyrics are busy. Try again shortly.'});
    const operation = queue.then(async () => (wordLyrics && await wordLyrics(track)) || lookup(track)).then(result => {
      cache.delete(key);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, {result, expires: Date.now() + (result.source ? 86400000 : 300000)});
      return result;
    }).catch(() => ({...unavailable(), error: 'LRCLIB is unavailable. Try again shortly.'})).finally(() => pending.delete(key));
    pending.set(key, operation);
    queue = operation;
    return operation;
  };
}

let defaultLookup=createLyrics();
function warmLyricCatalog(cacheDir) {
  const wordLyrics=createWordLyrics({cacheDir});
  defaultLookup=createLyrics({wordLyrics});
  return wordLyrics.preload().then(()=>undefined);
}
module.exports = {getLyrics: input=>defaultLookup(input), warmLyricCatalog, createLyrics, parseLRC};

