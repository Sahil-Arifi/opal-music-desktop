const fs=require('node:fs'),path=require('node:path');
const ownerKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function readBootLibrary(dir,owner){
 if(!ownerKey(owner))return null;
 try{
  const file=path.join(dir,'service-library.json');if(fs.statSync(file).size>30*1024*1024)return null;
  const cached=JSON.parse(fs.readFileSync(file,'utf8'));
  if(cached.version!==1||cached.id!==owner||!cached.profile||!cached.collections)return null;
  for(const key of ['liked','songs','playlists','subscriptions','recent','history'])if(!Array.isArray(cached.collections[key]))return null;
  for(const key of ['liked','songs','recent','discover','releases'])cached.collections[key]=(cached.collections[key]||[]).map(track=>!track.channelId&&/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(track.artist||'')?{...track,artist:''}:track);
  return cached;
 }catch{return null;}
}
class MetadataCache{
 constructor(dir,owner){this.file=path.join(dir,'catalog-cache.json');this.owner=owner;this.rows=new Map();this.timer=null;
  try{const data=JSON.parse(fs.readFileSync(this.file,'utf8'));if(data.version===1&&data.owner===owner&&Array.isArray(data.rows))this.rows=new Map(data.rows.filter(([key,row])=>typeof key==='string'&&row?.expires>Date.now()).slice(-100));}catch{}
 }
 get(key){const row=this.rows.get(key);if(!row||row.expires<Date.now()){this.rows.delete(key);return null;}this.rows.delete(key);this.rows.set(key,row);return row.value;}
 set(key,value,ttl=86400000){this.rows.delete(key);this.rows.set(key,{value,updatedAt:Date.now(),expires:Date.now()+ttl});while(this.rows.size>100)this.rows.delete(this.rows.keys().next().value);if(!this.timer)this.timer=setTimeout(()=>this.flush(),350);return value;}
 delete(key){this.rows.delete(key);this.flush();}
 clear(owner=this.owner){this.owner=owner;this.rows.clear();this.flush();}
 flush(){clearTimeout(this.timer);this.timer=null;try{fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({version:1,owner:this.owner,rows:[...this.rows]}),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}catch{}}
 close(){this.flush();}
}
module.exports={MetadataCache,readBootLibrary};

