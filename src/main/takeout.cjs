// Takeout's history is an activity log. A generic YouTube watch URL on its own
// does not identify a music listen. Keep its provenance for callers that opt in.
const videoIdPattern = /^[\w-]{11}$/;
function checkedWatch(raw) {
  let url;
  try {url=new URL(raw);} catch{return null;}
  if(!['http:','https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
  let id;
  if(url.hostname==='youtu.be') id=url.pathname.slice(1);
  else if(['music.youtube.com','www.youtube.com','m.youtube.com','youtube.com'].includes(url.hostname) && url.pathname==='/watch') id=url.searchParams.get('v');
  return id && videoIdPattern.test(id)?{id,music:url.hostname==='music.youtube.com'}:null;
}
function entities(value) {
  const named={amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' ',emsp:' '};
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|emsp);/gi,(raw,key)=>{
    if(key[0]!=='#')return named[key.toLowerCase()]||raw;
    const n=key[1].toLowerCase()==='x'?parseInt(key.slice(2),16):Number(key.slice(1));
    return n>0 && n<=0x10ffff?String.fromCodePoint(n):'';
  });
}
const text = value => entities((value||'').replace(/<[^>]+>/g,'')).trim();

function htmlRows(html) {
  const blocks=html.split(/<div\b[^>]*\bclass=["'][^"']*\bouter-cell\b[^"']*["'][^>]*>/i).slice(1);
  if(!blocks.length)throw Error('Choose the watch-history.html or watch-history.json file from Google Takeout.');
  return blocks.map(block=>{
    const header=text(block.match(/<div\b[^>]*\bheader-cell\b[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const content=block.match(/<div\b[^>]*\bcontent-cell\b[^>]*>([\s\S]*?)<\/div>/i)?.[1]||'';
    const anchors=[...content.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi)];
    if(!anchors.length)return {};
    const lines=content.split(/<br\s*\/?\s*>/i).map(text).filter(Boolean);
    const time=lines.at(-1);
    return {header, title:lines[0], titleUrl:entities(anchors[0][1]), time,
      subtitles:anchors.slice(1,2).map(a=>({name:text(a[2]),url:entities(a[1])})),
      details:/\bfrom google ads\b/i.test(text(block))?[{name:'From Google Ads'}]:[]};
  });
}
function importTakeout(content,name='watch-history.json',{includeGeneral=false}={}) {
  let rows;
  if (Array.isArray(content)) rows=content;
  else {
    const body=String(content).replace(/^\uFEFF/,'').trimStart();
    if (/\.html?$/i.test(name) || body.startsWith('<')) rows=htmlRows(body);
    else {
      try { rows=JSON.parse(body); } catch { throw Error('This file is not valid Takeout history JSON. Choose watch-history.json or watch-history.html.'); }
    }
  }
  if(!Array.isArray(rows))throw Error('Takeout history must contain a list of watch events.');
  const history=[],seen=new Set();
  let ambiguous=0, invalid=0, duplicates=0, recognizedMusic=0;
  for (const row of rows) {
    const ref=checkedWatch(row?.titleUrl);
    const time=typeof row?.time==='string'?Date.parse(row.time):NaN;
    if(!ref || !Number.isFinite(time) || typeof row?.title!=='string' || /^\s*(?:searched for|visited|liked|disliked|subscribed to|commented on|viewed)\b/i.test(row.title) ||
      (Array.isArray(row.details) && row.details.some(d=>/from google ads/i.test(d?.name||'')))) {invalid++;continue;}
    const title=row.title.replace(/^\s*(?:watched|listened to)\s+/i,'').trim();
    if(!title){invalid++;continue;}
    const key=ref.id+'|'+time;
    if(seen.has(key)){duplicates++;continue;}
    const music=ref.music || /^youtube music$/i.test(row.header||'') ||
      (Array.isArray(row.products) && row.products.some(p=>/^youtube music$/i.test(p))) ||
      (Array.isArray(row.subtitles) && row.subtitles.some(s=>/^youtube music$/i.test(s?.name||'')));
    if(!music){ambiguous++;if(!includeGeneral)continue;} else recognizedMusic++;
    seen.add(key);
    let channelId='';
    const artist=(Array.isArray(row.subtitles) ? row.subtitles : []).find(s=>typeof s.name==='string' && !/^youtube music$/i.test(s.name));
    try {
      const url=new URL(artist?.url);
      if(['music.youtube.com','www.youtube.com','youtube.com'].includes(url.hostname))channelId=url.pathname.match(/^\/channel\/(UC[\w-]{22})\/?$/)?.[1]||'';
    }catch{}
    history.push({track:{source:'youtube',id:ref.id,title,artist:artist?.name||'',channelId,duration:0,artwork:'https://i.ytimg.com/vi/'+ref.id+'/hqdefault.jpg'},
      playedAt:new Date(time).toISOString(),origin:'import',product:music?'youtube-music':'youtube'});
  }
  history.sort((a,b)=>Date.parse(b.playedAt)-Date.parse(a.playedAt));
  return {history,recognizedMusic,ambiguous,duplicates,skipped:rows.length-history.length,invalid};
}
module.exports={importTakeout};

