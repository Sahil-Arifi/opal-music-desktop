import {blankHome,blankState,type Desktop,type SearchRecent,type Home,type State,type Track,type Mode} from './types'

const tracks:Track[]=[
  {
    "source": "youtube",
    "id": "preview-track-1",
    "title": "First Light",
    "artist": "Demo Artist",
    "album": "Horizon",
    "artwork": "/reference/currents.svg",
    "duration": 180
  },
  {
    "source": "youtube",
    "id": "preview-track-2",
    "title": "Night Drive",
    "artist": "Demo Artist",
    "album": "Midnight",
    "artwork": "/reference/red.svg",
    "duration": 195
  },
  {
    "source": "youtube",
    "id": "preview-track-3",
    "title": "Soft Focus",
    "artist": "Demo Artist",
    "album": "Daydream",
    "artwork": "/reference/blonde.svg",
    "duration": 210
  },
  {
    "source": "youtube",
    "id": "preview-track-4",
    "title": "Afterglow",
    "artist": "Demo Artist",
    "album": "Spectrum",
    "artwork": "/reference/igor.svg",
    "duration": 225
  },
  {
    "source": "youtube",
    "id": "preview-track-5",
    "title": "Open Sky",
    "artist": "Demo Artist",
    "album": "Cloudline",
    "artwork": "/reference/melodrama.svg",
    "duration": 240
  },
  {
    "source": "youtube",
    "id": "preview-track-6",
    "title": "Quiet Hours",
    "artist": "Demo Artist",
    "album": "Stillness",
    "artwork": "/reference/weeknd.svg",
    "duration": 255
  }
]
// A separate, in-memory design preview. It never reads or modifies a connected account.
export function createPreview():Desktop{
 let home:Home={...blankHome,account:{configured:true,connected:false,name:'Design preview'},recent:tracks.slice(0,4),liked:[tracks[1],tracks[2],tracks[4]],releases:[tracks[4],tracks[2],tracks[5],tracks[3],tracks[1],tracks[0]],discover:[tracks[1],tracks[3],tracks[4],tracks[2]],playlists:[{id:'rotate',title:'In rotation',count:4,owned:true,privacy:'private',artwork:tracks[0].artwork},{id:'late',title:'After hours',count:3,owned:true,privacy:'unlisted',artwork:tracks[1].artwork}],releaseLabel:'From your artists',historyAvailable:true}
 let state:State={...blankState,effects:'full',current:tracks[0],duration:tracks[0].duration}
 let mode:Mode='full',index=0
 const originalPlaylists=new Map<string,Track[]>([['rotate',tracks.slice(0,4)],['late',[tracks[1],tracks[5],tracks[3]]]])
 const customPlaylists=new Map<string,Track[]>()
 let searches:SearchRecent[]=[],previewId=0,shelfOffset=0
 let sequence:Track[]=[];let sequenceIndex=0;let lastVolume=.7
 let elapsed:ReturnType<typeof setInterval>|undefined
 const hs=new Set<(v:Home)=>void>(),ss=new Set<(v:State)=>void>(),ms=new Set<(v:Mode)=>void>()
 const set=(values:Partial<State>)=>{state={...state,...values};ss.forEach(cb=>cb(state))
   if(state.playing&&ss.size&&!elapsed){elapsed=setInterval(()=>{if(state.position+1>=state.duration)set({position:state.duration,playing:false});else set({position:state.position+1})},1000)}
   if((!state.playing||!ss.size)&&elapsed){clearInterval(elapsed);elapsed=undefined}}
 const change=(values:Partial<Home>)=>{home={...home,...values};hs.forEach(cb=>cb(home))}
 const listen=<T,>(set:Set<(v:T)=>void>,cb:(v:T)=>void)=>{set.add(cb);return()=>{set.delete(cb)}}
 const select=(t:Track)=>{set({current:t,duration:t.duration,position:0,playing:true});index=tracks.findIndex(x=>x.id===t.id)}
 const noFile=async()=>{throw Error('File imports are available in the Mac app.')}
 return {
  discovery:async(refresh)=>{if(refresh)shelfOffset=(shelfOffset+1)%tracks.length;const shifted=[...tracks.slice(shelfOffset),...tracks.slice(0,shelfOffset)];return [{id:'discover',title:'Discover',tracks:shifted},{id:'releases',title:home.releaseLabel,tracks:home.releases}]},
  onStats:()=>()=>{},
  stats:async period=>({period,totals:{plays:0,seconds:0,artists:0,songs:0,albums:0},artists:[],songs:[],albums:[],coverage:{scope:'Design preview has no recorded listening history.',untimedPlays:0}}),
  recentSearches:async()=>searches,rememberSearch:async item=>{const same=(r:SearchRecent)=>item.kind==='track'&&r.kind==='track'?item.track.id===r.track.id:item.kind==='playlist'&&r.kind==='playlist'?item.playlist.id===r.playlist.id:item.kind==='query'&&r.kind==='query'&&r.query===item.query;searches=[item,...searches.filter(r=>!same(r))].slice(0,12)},
  playlistDetails:async id=>{const p=home.playlists.find(p=>p.id===id);if(!p)throw Error('Playlist unavailable.');return p},
  playlistAction:async(action,payload)=>{
   if(action==='create'){const playlist={id:'preview-'+(++previewId),title:payload.title||'Playlist',count:0,owned:true,privacy:payload.privacy};originalPlaylists.set(playlist.id,[]);change({playlists:[playlist,...home.playlists]});return{ok:true,playlist}}
   const existing=home.playlists.find(p=>p.id===payload.id);if(!existing)throw Error('Playlist unavailable.')
   if(action==='share')throw Error('Design-preview playlists do not have public links.')
   let songs=customPlaylists.get(existing.id)||originalPlaylists.get(existing.id)||[]
   if(action==='add')songs=[...songs,...tracks.filter(t=>payload.videoIds?.includes(t.id))]
   if(action==='remove')songs=songs.filter(t=>!payload.videoIds?.includes(t.id))
   customPlaylists.set(existing.id,songs)
   const playlist={...existing,count:songs.length,...(payload.title?{title:payload.title}:{}),...(payload.privacy?{privacy:payload.privacy}:{})}
   change({playlists:home.playlists.map(p=>p.id===existing.id?playlist:p)});return{ok:true,playlist}
  },
  orderQueue:async indices=>{const all=[...state.queue,...(state.serviceQueue||[])];set({queue:indices.map(i=>all[i]).filter(Boolean),serviceQueue:[]})},queueCategory:async()=>{},setPlaybackMode:async()=>({mode:'song',videoAvailable:false}),setVideoBounds:async()=>{},radioFromTrack:async t=>{change({radioActive:true});select(t)},
  getHome:async()=>home,getState:async()=>state,getMode:async()=>mode,onHome:cb=>listen(hs,cb),onState:cb=>{const off=listen(ss,cb);return()=>{off();if(!ss.size && elapsed){clearInterval(elapsed);elapsed=undefined}}},onMode:cb=>{const off=listen(ms,cb);const native=window.music?.onMode(v=>{mode=v;cb(v)});return()=>{off();native?.()}},
  onFocusSearch:()=>()=>{},onEnergy:()=>()=>{},setMode:async(v)=>{if(window.music)await window.music.setMode(v);mode=v;ms.forEach(cb=>cb(v))},
  startPasskeySignIn:async()=>{change({account:{...home.account,browserSignIn:{active:true,phase:'waiting'}}});return home.account},
  completePasskeySignIn:async()=>{change({account:{...home.account,connected:true,browserSignIn:{active:false,phase:'complete'}}});return home.account},
  cancelPasskeySignIn:async()=>{change({account:{...home.account,browserSignIn:{active:false,phase:'idle'}}});return home.account},
  signIn:async()=>{change({account:{...home.account,connected:true}})},signOut:async()=>{change({account:{...home.account,connected:false}})},refreshHome:async()=>{},importHistory:noFile,importFiles:noFile,
  search:async q=>tracks.filter(t=>[t.title,t.artist,t.album].join(' ').toLowerCase().includes(q.toLowerCase())),
  lyrics:async()=>({lines:[],synced:false}),
  onPlaylistUpdate:()=>()=>{},
  getPlaylist:async(id,sort)=>{if(sort&&sort!=='default')throw Error('The design preview has no dates for this playlist.');return (!sort&&customPlaylists.get(id))||originalPlaylists.get(id)||[]},
  orderPlaylist:async(id,ids)=>{customPlaylists.set(id,ids.flatMap(id=>tracks.filter(t=>t.id===id)))},
  playPlaylist:async(id,ids,i)=>{sequence=ids.flatMap(id=>tracks.filter(t=>t.id===id));sequenceIndex=i;if(sequence[i]){select(sequence[i]);set({serviceQueue:sequence.slice(i+1)})}},
  radio:async action=>{change({radioActive:true});if(action==='start'||action==='dislike')select(tracks[(index+1)%tracks.length])},
  command:async(name,v)=>{
   if(name==='playTrack'){sequence=[];select(v as Track);set({serviceQueue:[]})}
   if(name==='toggle')set({playing:!state.playing})
   if(name==='next'||name==='previous'){const step=name==='next'?1:-1;if(sequence.length){sequenceIndex=Math.max(0,Math.min(sequence.length-1,sequenceIndex+step));select(sequence[sequenceIndex]);set({serviceQueue:sequence.slice(sequenceIndex+1)})}else select(tracks[(index+tracks.length+step)%tracks.length])}
   if(name==='seek')set({position:Number(v)})
   if(name==='mute'){if(state.volume>0){lastVolume=state.volume;set({volume:0})}else set({volume:lastVolume})}
   if(name==='volume'){if(Number(v)>0)lastVolume=Number(v);set({volume:Number(v)})}
   if(name==='shuffle'&&typeof v==='boolean')set({shuffle:v})
   if(name==='repeat'&&(v==='off'||v==='all'||v==='one'))set({repeat:v})
   if(name==='pin')set({pinned:!!v})
   if(name==='effects'&&(v==='system'||v==='full'))set({effects:v})
   if(name==='queueTrack')set({queue:[...state.queue,v as Track]})
   if(name==='playNext')set({queue:[v as Track,...state.queue]})
   if(name==='playQueue'){const item=[...state.queue,...(state.serviceQueue||[])][Number(v)];if(item)select(item)}
   if(name==='removeQueue'){const n=Number(v),all=[...state.queue,...(state.serviceQueue||[])];set({queue:all.filter((_,i)=>i!==n),serviceQueue:[]})}
   if(name==='removeQueued')set({queue:state.queue.filter((_,i)=>i!==v)})
   if(name==='saveTrack'&&!state.library.some(t=>t.id===(v as Track).id))set({library:[...state.library,v as Track]})
   if(name==='removeSaved')set({library:state.library.filter(t=>t.id!==(v as Track).id)})
  }
 }
}

