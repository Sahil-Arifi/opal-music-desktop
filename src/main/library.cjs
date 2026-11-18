const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const formats = {'.mp3':'audio/mpeg','.m4a':'audio/mp4','.mp4':'audio/mp4','.aac':'audio/aac','.wav':'audio/wav','.aif':'audio/aiff','.aiff':'audio/aiff','.ogg':'audio/ogg','.opus':'audio/ogg','.flac':'audio/flac'};
const same = (a,b) => Boolean(a && b && a.source === b.source && a.id === b.id);
const defaults = () => ({library:[],queue:[],current:null,volume:.7,lastAudibleVolume:.7,resume:null,shuffle:false,repeat:'off',pinned:false,mode:'full',bounds:{},history:[],feedback:{},radioActive:false,effects:'full'});

class Library {
  constructor(dir) {
    this.dir=dir;
    this.files={};
    this.data=defaults();
    const file=path.join(dir,'collection.json');
    if(fs.existsSync(file)){
      try {
        const saved=JSON.parse(fs.readFileSync(file,'utf8'));
        this.files=saved.files||{};
        Object.assign(this.data,saved.data);
      } catch {
        fs.copyFileSync(file,file+'.unreadable-'+Date.now());
      }
    }
    for(const name of ['library','queue','history'])if(!Array.isArray(this.data[name]))this.data[name]=[];
    this.data.shuffle=this.data.shuffle===true;
    if(!Number.isFinite(this.data.lastAudibleVolume)||this.data.lastAudibleVolume<=0||this.data.lastAudibleVolume>1)this.data.lastAudibleVolume=this.data.volume>0?this.data.volume:.7;
    if(!['off','all','one'].includes(this.data.repeat))this.data.repeat='off';
    // Remove bundled demonstration material from older local builds.
    this.data.library=this.data.library.filter(t=>!['afterimage','glass-tide','night-signal'].includes(t.id));
    const clean=track=>track?.source==='youtube'&&!track.channelId&&/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(track.artist||'')?{...track,artist:''}:track;
    this.data.history=this.data.history.map(entry=>({...entry,track:clean(entry.track)}));
    this.data.library=this.data.library.map(clean);this.data.queue=this.data.queue.map(clean);
    this.data.current=this.normalize(this.data.current);
    this.data.radioActive=false;
  }
  write() {
    fs.mkdirSync(this.dir,{recursive:true});
    const dest=path.join(this.dir,'collection.json');
    fs.writeFileSync(dest+'.tmp',JSON.stringify({version:2,data:this.data,files:this.files}),{mode:0o600});
    fs.renameSync(dest+'.tmp',dest);
  }
  normalize(track) {
    if(!track || typeof track.id!=='string')return null;
    if(track.source==='local')return this.files[track.id]?.track||null;
    if(track.source!=='youtube'||!/^[\w-]{11}$/.test(track.id))return null;
    const text=s=>typeof s==='string'?s.slice(0,500):'';
    const artists=[];
    for (const value of Array.isArray(track.artists)?track.artists.slice(0,32):[]) {
      const name=text(typeof value==='string'?value:value?.name).trim();
      if (!name) continue;
      const id=text(value?.id).trim();
      artists.push(id?{name,id}:{name});
    }
    let artwork='';
    try {
      const url=new URL(track.artwork);
      if(url.protocol==='https:'&&/(^|\.)(ytimg\.com|googleusercontent\.com|ggpht\.com)$/.test(url.hostname))artwork=url.href;
    }catch{}
    return {id:track.id,source:'youtube',title:text(track.title)||'YouTube recording',artist:!track.channelId&&/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(text(track.artist))?'':text(track.artist),album:text(track.album),artwork,
      ...(artists.length?{artists}:{}),
      ...(track.playContext&&['album','playlist'].includes(track.playContext.kind)&&/^[-\w]{2,128}$/.test(track.playContext.id)?{playContext:{kind:track.playContext.kind,id:track.playContext.id,title:text(track.playContext.title),artist:text(track.playContext.artist),artwork:text(track.playContext.artwork),...(['album','single','ep'].includes(track.playContext.releaseType)?{releaseType:track.playContext.releaseType}:{})}}:{}),
      playlistId:typeof track.playlistId==='string'&&/^[\w-]{2,128}$/.test(track.playlistId)?track.playlistId:undefined,
      mediaType:['song','video'].includes(track.mediaType)?track.mediaType:undefined,albumId:text(track.albumId),
      ...(['album','single','ep'].includes(track.releaseType)?{releaseType:track.releaseType}:{}),
      duration:Number.isFinite(track.duration)?Math.max(0,track.duration):0,channelId:text(track.channelId),categoryId:text(track.categoryId),
      genres:Array.isArray(track.genres)?track.genres.filter(g=>typeof g==='string').slice(0,12):[]};
  }
  reconcileMetadata(candidates) {
    const clock=/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/;
    const known=new Map((Array.isArray(candidates)?candidates:[]).filter(t=>t?.source==='youtube'&&t.id&&t.artist&&!clock.test(t.artist)).map(t=>[t.id,t]));
    let changed=false;
    const repair=track=>{
      const source=track?.source==='youtube'?known.get(track.id):null;
      if(!source || (track.artist&&!clock.test(track.artist)))return track;
      const value=this.normalize({...track,artist:source.artist,artists:source.artists,channelId:source.channelId||track.channelId,album:track.album||source.album,albumId:track.albumId||source.albumId,artwork:track.artwork||source.artwork,duration:track.duration||source.duration});
      if(!value)return track;changed=true;return value;
    };
    this.data.current=repair(this.data.current);this.data.library=this.data.library.map(repair);this.data.queue=this.data.queue.map(repair);
    this.data.history=this.data.history.map(entry=>{const track=repair(entry.track);return track===entry.track?entry:{...entry,track}});
    if(changed)this.write();return changed;
  }
  addFiles(paths) {
    const tracks=[];
    for(const file of paths){
      if(!formats[path.extname(file).toLowerCase()]||!fs.statSync(file).isFile())continue;
      const id=crypto.createHash('sha256').update(file).digest('hex').slice(0,32);
      const track={id,source:'local',title:path.basename(file,path.extname(file)),artist:'Local audio',album:'',duration:0,artwork:'',url:'music-media://track/'+id};
      this.files[id]={path:file,track};
      this.save(track);tracks.push(track);
    }
    this.write();return tracks;
  }
  save(track) {if(!this.data.library.some(t=>same(t,track)))this.data.library.unshift(track);}
  record(track,details={}) {
    this.data.history.unshift({track,playedAt:new Date().toISOString(),origin:'local',product:'youtube-music',
      ...(typeof details.playId==='string'?{playId:details.playId.slice(0,100)}:{}),
      ...(Number.isFinite(details.listenSeconds)?{listenSeconds:Math.max(0,details.listenSeconds)}:{})});
    this.data.history=this.data.history.slice(0,10000);
    this.write();
  }
  importHistory(entries) {
    const existing=new Set(this.data.history.map(e=>e.track.id+'|'+e.playedAt));
    for(const entry of entries){
      const track=this.normalize(entry.track);
      if(!track || entry.product!=='youtube-music' || !Number.isFinite(Date.parse(entry.playedAt)))continue;
      const key=track.id+'|'+entry.playedAt;
      if(!existing.has(key)){this.data.history.push({...entry,track});existing.add(key);}
    }
    this.data.history.sort((a,b)=>Date.parse(b.playedAt)-Date.parse(a.playedAt));
    this.data.history=this.data.history.slice(0,10000);
    this.write();
  }
}
module.exports={Library,formats,same};

