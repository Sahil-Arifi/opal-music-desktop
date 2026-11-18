import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight,Play,RefreshCw} from 'lucide-react'
import {artURL,type Playlist,type Track} from './types'
import {ArtworkPlayback,Btn,Cover,Empty} from './ui'
import {SongMenu} from './TrackMenu'

export type MusicShelf={id:string;title:string;tracks:Track[];playlists?:Playlist[];subtitle?:string}
type Props={section:MusicShelf;anchor?:string;play:(t:Track)=>void;pickPlaylist:(p:Playlist)=>void;reload:(id:string)=>Promise<void>;loading?:boolean}
export function DiscoveryShelf({section,anchor,play,pickPlaylist,reload,loading}:Props){
 const scroll=useRef<HTMLDivElement>(null),[cols,setCols]=useState(3),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const limit=cols*2,items=[...section.tracks.map(track=>({track,playlist:null as Playlist|null})),...(section.playlists||[]).map(playlist=>({track:null as Track|null,playlist}))].slice(0,limit*3),pages=Math.ceil(items.length/limit)
 useLayoutEffect(()=>{
   const node=scroll.current;if(!node)return
   const measure=()=>setCols(node.clientWidth<690?2:3)
   measure();const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect()
 },[!!items.length])
 useEffect(()=>{scroll.current?.scrollTo({left:0});setPage(0)},[section.id,section.tracks[0]?.id,cols])
 function jump(p:number){const node=scroll.current;if(node)node.scrollTo({left:p*(node.clientWidth+12),behavior:'smooth'})}
 async function refresh(){setBusy(true);setError('');try{await reload(section.id);jump(0)}catch(e){setError(e instanceof Error?e.message:'Could not refresh this section.')}finally{setBusy(false)}}
 return <section className="music-shelf" id={anchor} aria-label={section.title}>
 <div className="music-shelf-head"><div><h2>{section.title}</h2>{section.subtitle&&<p>{section.subtitle}</p>}</div><div className="shelf-controls">
 <Btn title={'Refresh '+section.title} onClick={()=>void refresh()} disabled={busy||loading}><RefreshCw size={14} className={busy?'player-spin':''}/></Btn>
 {pages>1&&<><Btn title={'Previous '+section.title+' page'} disabled={!page} onClick={()=>jump(page-1)}><ChevronLeft size={16}/></Btn><Btn title={'Next '+section.title+' page'} disabled={page>=pages-1} onClick={()=>jump(page+1)}><ChevronRight size={16}/></Btn></>}</div></div>
 {items.length?<div className="shelf-pages" ref={scroll} onScroll={e=>{const n=e.currentTarget;setPage(Math.round(n.scrollLeft/(n.clientWidth+12)))}}><div className="shelf-pages-inner">{Array.from({length:pages},(_,p)=><div className="song-page" key={p} style={{gridTemplateColumns:'repeat('+cols+',minmax(0,1fr))'}} aria-label={'Page '+(p+1)+' of '+pages}>
 {items.slice(p*limit,(p+1)*limit).map(({track,playlist},i)=>track?<article key={track.id+i} className="landscape-song"><button className="landscape-listen" title={'Play '+track.title+' by '+track.artist} onClick={()=>play(track)}><ArtworkPlayback decorative track={track} className="discovery-play-art"/><span className="shelf-song-text"><b>{track.title}</b><small>{track.artist}</small></span></button><SongMenu track={track}/></article>:playlist?<article key={'playlist'+playlist.id+i} className="landscape-song"><button className="landscape-listen" onClick={()=>pickPlaylist(playlist)} title={'Open playlist '+playlist.title}><span className="shelf-song-art"><Cover track={{id:playlist.id,title:playlist.title,artist:playlist.artist||'',artwork:playlist.artwork}}/></span><span className="shelf-song-text"><b>{playlist.title}</b><small>{playlist.artist||'Playlist'}</small></span></button></article>:null)}</div>)}</div></div>:
 <Empty title={loading?'Finding music…':'No tracks available'}>{loading?'Loading this section from YouTube Music.':'Refresh to check this section again.'}</Empty>}
 {error&&<p className="playlist-error" role="status">{error}</p>}</section>
}

