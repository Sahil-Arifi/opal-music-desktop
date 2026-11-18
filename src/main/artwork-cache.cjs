const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const validType=type=>/^image\/(jpeg|png|webp|avif)(;|$)/.test(type||'');
function createArtworkStore({dir,fetchImpl=fetch,budget=24*1024*1024}={}){
 const memory=new Map(),pending=new Map();let used=0,writes=0;
 function keep(key,image){if(memory.has(key))used-=memory.get(key).body.length;memory.delete(key);memory.set(key,image);used+=image.body.length;while(used>budget&&memory.size>1){const first=memory.keys().next().value;used-=memory.get(first).body.length;memory.delete(first);}return image;}
 async function disk(file){try{const info=await fs.stat(file);if(info.size>5*1024*1024+200||Date.now()-info.mtimeMs>7*86400000)return null;const bytes=await fs.readFile(file),split=bytes.indexOf(10);if(split<1||split>150)return null;const type=bytes.subarray(0,split).toString();return validType(type)?{type,body:bytes.subarray(split+1)}:null;}catch{return null;}}
 async function prune(){if(!dir)return;try{const names=(await fs.readdir(dir)).filter(n=>/^[a-f0-9]{64}\.img$/.test(n));const rows=await Promise.all(names.map(async name=>({name,...await fs.stat(path.join(dir,name))})));rows.sort((a,b)=>b.mtimeMs-a.mtimeMs);let bytes=0;const excess=rows.filter((row,index)=>{bytes+=row.size;return index>=1000||bytes>80*1024*1024;});await Promise.all(excess.map(row=>fs.unlink(path.join(dir,row.name)).catch(()=>{})));}catch{}}
 async function load(key){
  const file=dir?path.join(dir,createHash('sha256').update(key).digest('hex')+'.img'):null,cached=file?await disk(file):null;
  if(cached)return keep(key,cached);
  const response=await fetchImpl(key,{redirect:'error',signal:AbortSignal.timeout(12000)}),type=response.headers.get('content-type')||'';
  if(!response.ok||!validType(type))throw Error('Artwork unavailable');if(Number(response.headers.get('content-length'))>5*1024*1024)throw Error('Artwork too large');
  const reader=response.body.getReader(),parts=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>5*1024*1024){await reader.cancel();throw Error('Artwork too large');}parts.push(Buffer.from(value));}
  const image={type,body:Buffer.concat(parts)};
  if(file){try{await fs.mkdir(dir,{recursive:true});await fs.writeFile(file+'.tmp',Buffer.concat([Buffer.from(type+'\n'),image.body]),{mode:0o600});await fs.rename(file+'.tmp',file);if(++writes%24===0)void prune();}catch{}}
  return keep(key,image);
 }
 return async key=>{if(memory.has(key))return keep(key,memory.get(key));if(pending.has(key))return pending.get(key);const task=load(key).finally(()=>pending.delete(key));pending.set(key,task);return task;};
}
module.exports={createArtworkStore};

