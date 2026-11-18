const {DOMParser}=require('@xmldom/xmldom');
const fs=require('node:fs/promises');
const path=require('node:path');
const root='https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/';
const ttml='http://www.w3.org/ns/ttml';
const meta=ttml+'#metadata';
const normalize=value=>typeof value==='string'?value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim():'';

function seconds(input) {
  const value=String(input||'').trim();
  if (/^\d+(?:\.\d+)?(?:s|ms)?$/.test(value)) return parseFloat(value)/(value.endsWith('ms')?1000:1);
  const match=value.match(/^(?:(\d{1,2}):)?(\d{1,3}):([0-5]\d(?:\.\d+)?)$/);
  if (!match || (match[1] && +match[2]>=60)) return NaN;
  return Number(match[1]||0)*3600+Number(match[2])*60+Number(match[3]);
}

function phrase(element,backing,depth=0) {
  const parts=[];
  function walk(parent,clock,level) {
    if (level>40) throw Error('Nested lyric markup');
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType===3 || node.nodeType===4) {
        const text=node.data.replace(/\s+/g,' ');
        if(text) parts.push({text,...clock});
        continue;
      }
      if (node.nodeType!==1 || (node.namespaceURI && node.namespaceURI!==ttml) || node.localName!=='span') continue;
      const role=node.getAttributeNS(meta,'role');
      if (role==='x-bg') {if(backing)backing.push(phrase(node,null,level+1));continue;}
      if (role || node.getAttributeNS(ttml+'#styling','ruby')==='text') continue;
      const start=seconds(node.getAttribute('begin')),end=seconds(node.getAttribute('end'));
      const interval=Number.isFinite(start)?{start,...(end>=start?{end}:{})}:clock;
      walk(node,interval,level+1);
    }
  }
  walk(element,null,depth);
  const text=parts.map(p=>p.text).join('').trim();
  const words=[];
  let complete=true;
  for (const part of parts) {
    if (!Number.isFinite(part.start)) {
      if (!part.text.trim() && words.length) words.at(-1).text+=part.text;
      else if (part.text.trim()) complete=false;
      continue;
    }
    if (words.length && part.start<words.at(-1).start) complete=false;
    const prev=words.at(-1);
    if (prev && prev.start===part.start && prev.end===part.end) prev.text+=part.text;
    else words.push({...part});
  }
  if(words.length){words[0].text=words[0].text.trimStart();words.at(-1).text=words.at(-1).text.trimEnd();}
  return {text,...(words.length && complete?{words}:{}),start:seconds(element.getAttribute('begin')),end:seconds(element.getAttribute('end'))};
}

function parseTTML(xml,duration) {
  if(typeof xml!=='string' || xml.length>550000 || /<!(?:DOCTYPE|ENTITY)\b/i.test(xml) || !(duration>0))return null;
  try {
    const doc=new DOMParser({onError:()=>{throw Error('Invalid TTML');}}).parseFromString(xml,'application/xml');
    const body=doc.getElementsByTagNameNS(ttml,'body').item(0);
    if(!body || !(Math.abs(seconds(body.getAttribute('dur'))-duration)<=2))return null;
    const lines=[];
    const fits=word=>word.start>=0 && word.start<=duration+2 && (word.end===undefined || word.end<=duration+2);
    for (const p of Array.from(body.getElementsByTagNameNS('*','p'))) {
      if (p.namespaceURI && p.namespaceURI!==ttml) continue;
      const time=seconds(p.getAttribute('begin'));
      if (!Number.isFinite(time)||time<0||time>duration+2)continue;
      const voices=[],lead=phrase(p,voices);
      if (lead.words && !lead.words.every(fits))delete lead.words;
      const cue={time,text:lead.text,...(lead.words?{words:lead.words}:{})};
      for (const voice of voices) {
        if (!voice.text)continue;
        if (voice.words && !voice.words.every(fits)) delete voice.words;
        const start=Number.isFinite(voice.start)?voice.start:voice.words?.[0]?.start??time;
        const end=Number.isFinite(voice.end)?voice.end:voice.words?.at(-1)?.end;
        const entry={text:voice.text,start,...(end>=start?{end}:{}),...(voice.words?{words:voice.words}:{})};
        if(fits(entry))(cue.backing||=[]).push(entry);
      }
      if(cue.text||cue.backing?.length)lines.push(cue);
    }
    if(!lines.some(l=>l.words?.length||l.backing?.some(v=>v.words?.length)))return null;
    return {lines:lines.sort((a,b)=>a.time-b.time),synced:true,source:'AMLL TTML Database'};
  }catch{return null;}
}

async function readText(fetchImpl,path,maxBytes,timeout) {
  const response=await fetchImpl(root+path,{redirect:'error',signal:AbortSignal.timeout(timeout)});
  if (!response.ok || Number(response.headers.get('content-length'))>maxBytes || !response.body) throw Error('Word timings unavailable');
  const chunks=[];let size=0;
  for await(const chunk of response.body) {
    size+=chunk.byteLength;
    if(size>maxBytes)throw Error('Lyric source exceeds permitted size');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function titleIndex(input) {
  const updated=new Map();
  for (const line of input.split('\n')) {
    if (!line.trim())continue;
    const row=JSON.parse(line);
    if(!/^\d{10,16}-\d{1,18}-[A-Za-z0-9]{8}\.ttml$/i.test(row.rawLyricFile) || !Array.isArray(row.metadata))continue;
    const data=Object.fromEntries(row.metadata);
    if(!Array.isArray(data.musicName)||!Array.isArray(data.artists))continue;
    const entry={path:row.rawLyricFile,artists:data.artists.map(normalize),albums:(Array.isArray(data.album)?data.album:[]).map(normalize)};
    for(const name of data.musicName.map(normalize).filter(Boolean)){
      const entries=updated.get(name)||[];entries.push(entry);updated.set(name,entries);
    }
  }
  if (!updated.size)throw Error('Empty word-timing catalog');
  return updated;
}

function createWordLyrics({fetchImpl=fetch,timeout=4000,cacheDir}={}) {
  let index=new Map(),validUntil=0,loading;
  const cache=cacheDir?path.join(cacheDir,'amll-lyrics-index-v1.jsonl'):null;
  const maxIndexBytes=5*1024*1024,day=86400000;
  let triedDisk=false;
  async function titles() {
    if (Date.now()<validUntil)return index;
    if (loading)return loading;
    loading=(async()=>{
      try {
        if(cache && !triedDisk){
          triedDisk=true;
          try{
            const stat=await fs.stat(cache);
            if(stat.isFile() && stat.size<=maxIndexBytes){
              index=titleIndex(await fs.readFile(cache,'utf8'));
              const now=Date.now(),modified=Math.floor(stat.mtimeMs);
              if(modified<=now+1000 && modified+day>now){validUntil=Math.min(modified,now)+day;return index;}
            }
          }catch{}
        }
        const input=await readText(fetchImpl,'metadata/raw-lyrics-index.jsonl',maxIndexBytes,timeout);
        index=titleIndex(input);validUntil=Date.now()+day;
        if(cache){
          const tmp=cache+'.'+process.pid+'.tmp';
          try{
            await fs.mkdir(cacheDir,{recursive:true});
            await fs.writeFile(tmp,input,{mode:0o600});await fs.rename(tmp,cache);
          }catch{await fs.rm(tmp,{force:true}).catch(()=>{});}
        }
      }catch{validUntil=Date.now()+60000;}
      finally{loading=null;}
      return index;
    })();
    return loading;
  }
  async function wordLyrics(track) {
    if(!track.duration)return null;
    const index=await titles();
    const rows=index.get(normalize(track.credit.base))||[];
    const matches=rows.filter(row=>(!track.album||row.albums.includes(normalize(track.album)))&&
      track.credit.names.every(name=>row.artists.includes(name)||row.artists.includes(normalize(track.artist))));
    for(const row of matches.slice(-3).reverse()){
      try {
        const xml=await readText(fetchImpl,'raw-lyrics/'+row.path,550000,timeout);
        const result=parseTTML(xml,track.duration);
        if(result)return result;
      }catch{}
    }
    return null;
  }
  wordLyrics.preload=titles;
  return wordLyrics;
}
module.exports={createWordLyrics,parseTTML};

