import {memo,useEffect,useLayoutEffect,useRef,useState} from 'react'
import {AnimatePresence,motion,Reorder,useDragControls} from 'motion/react'
import {ChevronDown,GripVertical,ListMusic,LoaderCircle,Maximize2,MicVocal,Minimize2,SkipBack,SkipForward,X} from 'lucide-react'
import type {CatalogKind,CatalogRef,Desktop,State,Track} from './types'
import {artURL,stamp} from './types'
import {ArtworkPlayback,Btn,Cover,PlayIcon,Range,spring,type Act} from './ui'
import {SongMenu,TrackFeedback,useTrackActions} from './TrackMenu'
import './player-refinements.css'
import {Lyrics} from './Lyrics'
import {VolumeControl} from './VolumeControl'
import {PlaybackModeButton} from './PlaybackModes'
import {usePlayerActivity} from './PlayerActivity'

export type PlayerPanel='queue'|'lyrics'|null
type Props={
 track:Track;state:State;api?:Desktop;shared:string;panel:PlayerPanel;reduce:boolean
 immersiveRequested?:boolean;onImmersive?:(value:boolean)=>void;navigateCatalog?:(kind:CatalogKind,ref:CatalogRef)=>void
 close:()=>void;onPanel:(p:PlayerPanel)=>void;act:Act;play:(track:Track)=>void
}

type QueueEntry={key:string;track:Track}
function queueEntries(tracks:Track[]):QueueEntry[]{const counts=new Map<string,number>();return tracks.map(track=>{const id=track.source+':'+track.id,n=counts.get(id)||0;counts.set(id,n+1);return {key:id+':'+n,track}})}
function QueueRow({entry,index,act,commit,step,busy}:{entry:QueueEntry;index:number;act:Act;commit:()=>void;step:(delta:number)=>void;busy:boolean}){
 const drag=useDragControls(),t=entry.track
 return <Reorder.Item as="li" value={entry} dragListener={false} dragControls={drag} onDragEnd={commit} layout="position" className="player-queue-row" whileDrag={{zIndex:3,backgroundColor:'#ffffff18'}} transition={{type:'spring',stiffness:420,damping:36}}>
  <button className="queue-grip" disabled={busy} aria-label={'Move '+t.title+' in queue'} title="Drag to reorder, or use the arrow keys" onPointerDown={event=>drag.start(event)} onKeyDown={event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();step(event.key==='ArrowUp'?-1:1)}}}><GripVertical size={14}/></button>
  <button disabled={busy} className="player-queue-pick" onClick={()=>act('playQueue',index)} aria-label={'Play '+t.title}><ArtworkPlayback decorative track={t}/><span><b>{t.title}</b><small>{t.artist}</small></span></button>
  {t.duration>0&&<small className="queue-time">{stamp(t.duration)}</small>}<SongMenu track={t} queueIndex={index}/>
 </Reorder.Item>
}
const Queue=memo(function Queue({state,act,api}:{state:State;act:Act;api?:Desktop}){
 const tracks=[...state.queue,...(state.serviceQueue||[])],signature=tracks.map(t=>t.source+':'+t.id).join('|')
 const [items,setItems]=useState(()=>queueEntries(tracks)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[category,setCategory]=useState(''),[limit,setLimit]=useState(32)
 const latest=useRef(items);latest.current=items
 useEffect(()=>{const next=queueEntries(tracks);latest.current=next;setItems(next);setLimit(32)},[signature])
 async function save(next=latest.current){
  if(!api)return
  const original=queueEntries(tracks),indices=next.map(item=>original.findIndex(old=>old.key===item.key));setBusy(true);setError('')
  try{await api.orderQueue(indices,tracks.map(t=>t.source+':'+t.id))}catch(e){setError(e instanceof Error?e.message:'The queue changed. Try again.');setItems(original)}finally{setBusy(false)}
 }
 function step(item:QueueEntry,delta:number){const i=items.indexOf(item),target=i+delta;if(target<0||target>=items.length)return;const next=items.slice();[next[i],next[target]]=[next[target],next[i]];latest.current=next;setItems(next);void save(next)}
 async function choose(id:string){if(!api)return;setCategory(id);setError('');try{await api.queueCategory(id)}catch(e){setError(e instanceof Error?e.message:'Could not change the queue.')}finally{setCategory('')}}
 return <div className={'player-queue-scroll'+(busy?' queue-busy':'')} onScroll={event=>{const node=event.currentTarget;if(node.scrollHeight-node.scrollTop-node.clientHeight<400)setLimit(value=>Math.min(items.length,value+32))}}>
 {(state.queueCategories?.length||0)>0&&<div className="queue-category-chips" aria-label="Queue recommendations">{state.queueCategories!.map(item=><button key={item.id} disabled={!!category} aria-pressed={item.selected} onClick={()=>void choose(item.id)}>{category===item.id?<LoaderCircle size={12} className="player-spin"/>:null}{item.title}</button>)}</div>}
 {state.current&&<><h3>Now playing</h3><motion.div key={state.current.id} className="player-queue-row playing-row" initial={{opacity:.4,y:7}} animate={{opacity:1,y:0}} transition={{duration:.25}}><ArtworkPlayback track={state.current}/><span><b>{state.current.title}</b><small>{state.current.artist}</small></span><SongMenu track={state.current}/></motion.div></>}
 <h3>Up next</h3>{error&&<p className="queue-action-error" role="alert">{error}</p>}{items.length?<Reorder.Group as="ol" axis="y" values={items.slice(0,limit)} onReorder={head=>{const next=[...head,...latest.current.slice(limit)];latest.current=next;setItems(next)}} className="editable-queue">{items.slice(0,limit).map((entry,index)=><QueueRow key={entry.key} entry={entry} index={index} act={act} busy={busy} commit={()=>void save()} step={delta=>step(entry,delta)}/>)}</Reorder.Group>:<p className="queue-empty">Your queue is empty.</p>}{limit<items.length&&<button className="queue-load-more" onClick={()=>setLimit(value=>Math.min(items.length,value+32))}>Show more queued songs</button>}</div>
},(previous,next)=>previous.api===next.api&&previous.act===next.act&&previous.state.current===next.state.current&&previous.state.playing===next.state.playing&&previous.state.queue===next.state.queue&&previous.state.serviceQueue===next.state.serviceQueue&&previous.state.queueCategories===next.state.queueCategories)

export function ExpandedPlayer({track,state,api,shared,panel,reduce,close,onPanel,act,play,onImmersive,navigateCatalog,immersiveRequested=false}:Props){
 const trackActions=useTrackActions(),goCatalog=navigateCatalog||trackActions?.navigateCatalog
 const [immersive,setImmersive]=useState(immersiveRequested)
 const wash=useRef<HTMLDivElement>(null),transport=useRef<HTMLDivElement>(null)
 useLayoutEffect(()=>{const node=transport.current;if(!node)return;const update=(width:number)=>node.classList.toggle('transport-stacked',width<440);update(node.clientWidth);const observer=new ResizeObserver(entries=>update(entries[0].contentRect.width));observer.observe(node);return()=>observer.disconnect()},[])
 const stage=useRef<HTMLElement>(null),drag=useDragControls(),header=useRef<HTMLButtonElement>(null)
 useEffect(()=>{setImmersive(immersiveRequested)},[immersiveRequested])
 useEffect(()=>{let fade:Animation|undefined;const change=()=>{if(!stage.current||!wash.current||reduce)return;const background=getComputedStyle(stage.current).backgroundImage;fade?.cancel();wash.current.style.backgroundImage=background;fade=wash.current.animate([{opacity:1},{opacity:0}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'})};window.addEventListener('music-palette-will-change',change);return()=>{window.removeEventListener('music-palette-will-change',change);fade?.cancel()}},[reduce])
 const notifyImmersive=useRef(onImmersive);notifyImmersive.current=onImmersive
 useEffect(()=>()=>notifyImmersive.current?.(false),[])
 function setStage(value:boolean){setImmersive(value);notifyImmersive.current?.(value);if(value)requestAnimationFrame(()=>stage.current?.focus({preventScroll:true}))}
 useEffect(()=>{
   if(!immersive)return
   const key=(event:KeyboardEvent)=>{if(event.key!=='Escape'||event.defaultPrevented||document.querySelector('[role=menu],[role=dialog],.song-picker-shade'))return;event.preventDefault();event.stopImmediatePropagation();setStage(false)}
   window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true)
 },[immersive])
 const videoSlot=useRef<HTMLDivElement>(null),[modeBusy,setModeBusy]=useState(false),[modeError,setModeError]=useState('')
 useEffect(()=>{header.current?.focus({preventScroll:true})},[])
 const active=state.current?.id===track.id,playing=active&&state.playing,busy=active&&state.loading
 const video=active&&state.playbackMode==='video'
 usePlayerActivity(stage,immersive&&!video,playing,busy,!!trackActions?.videoOccluded,track.id)
 useLayoutEffect(()=>{act('videoOnly',immersive&&video)},[immersive,video,act])
 useEffect(()=>()=>act('videoOnly',false),[act])
 useEffect(()=>api?.onExitCinema?.(()=>setStage(false)),[api])
 useEffect(()=>{setModeError('')},[track.id])
 useLayoutEffect(()=>{
   const slot=videoSlot.current;if(!api)return;if(!video||!slot){void api.setVideoBounds(null).catch(()=>{});return}
   if(trackActions?.videoOccluded){void api.setVideoBounds(null).catch(()=>{});return}
   let frame=0,previous='',lastChange=performance.now()
   function measure(){
     const r=slot!.getBoundingClientRect(),rect=immersive?{x:0,y:0,width:window.innerWidth,height:window.innerHeight,presentation:'cinema' as const}:{x:Math.round(r.left),y:Math.round(r.top),width:Math.round(r.width),height:Math.round(r.height),presentation:'embedded' as const}
     const key=JSON.stringify(rect)
     if(previous!==key&&rect.width>0&&rect.height>0){previous=key;void api!.setVideoBounds(rect).catch(()=>{})}
     if(!immersive&&performance.now()-lastChange<760)frame=requestAnimationFrame(measure)
   }
   function update(){lastChange=performance.now();cancelAnimationFrame(frame);frame=requestAnimationFrame(measure)}
   const observer=new ResizeObserver(update);observer.observe(slot);window.addEventListener('resize',update);measure()
   return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',update)}
 },[api,video,track.id,panel,immersive,trackActions?.videoOccluded])
 useEffect(()=>()=>{void api?.setVideoBounds(null).catch(()=>{});void api?.setPlaybackMode('song').catch(()=>{})},[api])
 async function source(mode:'song'|'video'){
   if(!api||modeBusy)return;setModeBusy(true);setModeError('')
   try{await api.setPlaybackMode(mode)}catch(error){setModeError(error instanceof Error?error.message:'The music video is unavailable.')}finally{setModeBusy(false)}
 }
 const collapse=()=>{if(immersive){setStage(false);return}void api?.setVideoBounds(null).catch(()=>{});close()}
 const duration=active?(state.duration||track.duration):track.duration,position=active?state.position:0
 const ease=[.22,1,.36,1] as const
 const art=artURL(track.artwork)
 const slide={duration:reduce?0:.42,ease:[.22,1,.36,1] as const}
 const choose=(p:PlayerPanel)=>{if(immersive){setStage(false);onPanel(p)}else onPanel(panel===p?null:p)}
 const next=state.queue[0]||state.serviceQueue?.[0]
 const showNext=immersive&&playing&&state.repeat!=='one'&&duration>0&&duration-position>0&&duration-position<=15&&!!next
 const titleLink=track.source==='youtube'&&!!goCatalog,artistLink=!!track.artist&&!!goCatalog
 const openTitle=()=>{if(immersive)setStage(false);if(track.albumId)goCatalog?.('album',{id:track.albumId,title:track.album,artist:track.artist,artwork:track.artwork});else goCatalog?.('song',{id:track.id,title:track.title,artist:track.artist,artwork:track.artwork})}
 const openArtist=()=>{if(immersive)setStage(false);goCatalog?.('artist',{id:track.channelId,title:track.artist})}
 return <motion.section ref={stage} tabIndex={-1} style={{outline:'none'}} className={'expanded-player'+(playing?' music-playing':'')+(immersive?' immersive-stage':'')+(immersive&&video?' immersive-video':'')} aria-label="Expanded player" initial={{y:reduce?0:'100%'}} animate={{y:0}} exit={{y:reduce?0:'100%'}} transition={slide}
  drag={reduce||immersive?false:'y'} dragListener={false} dragControls={drag} dragConstraints={{top:0,bottom:0}} dragElastic={{top:0,bottom:.57}} onDragEnd={(_,g)=>{if(g.offset.y>95||g.velocity.y>650)collapse()}}>
 <div className="player-atmosphere" aria-hidden="true"><AnimatePresence initial={false}>{art&&<motion.div className="atmosphere-art" key={art} style={{backgroundImage:'url('+JSON.stringify(art)+')'}} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:reduce?0:1.1}}/>}</AnimatePresence><div className="atmosphere-shade"/></div>
 <div className="stage-previous-wash" ref={wash} aria-hidden="true"/><header className="player-header">
 <button ref={header} className="player-collapse" title="Collapse player" aria-label="Collapse player" onClick={collapse}><ChevronDown size={22}/></button>
 <div className="player-center-header"><div className="player-grip" onPointerDown={e=>{if(video)void source('song');drag.start(e)}}><i/><span>Now playing</span></div>
 <div className="player-source-toggle" aria-label="Playback view">{(['song','video'] as const).map(mode=><button key={mode} disabled={modeBusy||!active||track.source==='local'||(mode==='video'&&!state.videoAvailable)} aria-pressed={(video?'video':'song')===mode} onClick={()=>void source(mode)}>{mode==='song'?'Song':'Video'}{(video?'video':'song')===mode&&<motion.i layoutId="source-selector" transition={{duration:.22}}/>}</button>)}</div></div>
 <div className="player-window-tools"><Btn title={immersive?'Exit immersive player':'Enter immersive player'} pressed={immersive} onClick={()=>setStage(!immersive)}>{immersive?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</Btn></div>
 </header>
 {modeError&&<div className="source-error" role="status">{modeError}</div>}
 <AnimatePresence>{showNext&&next&&<motion.div key={next.id} className="immersive-next" role="status" initial={{opacity:0,y:reduce?0:5}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Cover track={next}/><div><small>Up next</small><b>{next.title}</b><span>{next.artist}</span></div></motion.div>}</AnimatePresence>
 <div className={'player-stage '+(!immersive&&panel?'with-panel':'solo-stage')}>
 <motion.div className="player-column" transition={{duration:reduce?0:.3,ease}}>
 <motion.div className="player-sleeve" layout={reduce||video?false:true} layoutDependency={immersive} transition={{duration:reduce?0:.42,ease}}>{art&&<div className="sleeve-aura" aria-hidden="true" style={{backgroundImage:'url('+JSON.stringify(art)+')'}}/>}<motion.div className="player-cover-change" key={track.id} initial={reduce?false:{opacity:0,scale:.975}} animate={{opacity:1,scale:1}} transition={{duration:reduce?0:.3,ease}}><Cover track={track} size={1200} className="expanded-cover"/></motion.div>{video&&<div className="player-video-slot" ref={videoSlot} aria-label="Music video"><LoaderCircle className="player-spin" size={24}/></div>}</motion.div>
 <motion.div className="player-info" layout={reduce||video?false:"position"} layoutDependency={immersive} transition={{duration:reduce?0:.42,ease}}><motion.div key={track.id} initial={reduce?false:{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{duration:reduce?0:.27,ease}}><motion.h1  transition={spring} title={track.title}>{titleLink?<button className="music-credit-link" title={'Open '+(track.albumId?'album':'song details')} onClick={openTitle}>{track.title}</button>:track.title}</motion.h1><p title={track.artist}>{artistLink?<button className="music-credit-link" title={'Open artist '+track.artist} onClick={openArtist}>{track.artist}</button>:track.artist}</p></motion.div>
 <SongMenu track={track}/></motion.div>
 <motion.div className="player-progress" layout={reduce||video?false:"position"} layoutDependency={immersive} transition={{duration:reduce?0:.42,ease}}><Range key={track.id} label="Seek" value={position} max={duration} disabled={!active||!duration} commit change={n=>act('seek',n)}/><div><small>{stamp(position)}</small><small>{stamp(duration)}</small></div></motion.div>
 <motion.div className="player-playback" ref={transport} layout={reduce||video?false:"position"} layoutDependency={immersive} transition={{duration:reduce?0:.42,ease}}>
 <div className="player-left-tools"><TrackFeedback track={track}/></div>
 <motion.div className="player-primary"  transition={spring}><PlaybackModeButton mode="shuffle" state={state} act={act}/><Btn title="Previous track" disabled={!state.current} onClick={()=>act('previous')}><SkipBack size={22} fill="currentColor"/></Btn>
 <Btn title={playing||busy?'Pause track':'Play track'} className="player-main-play" onClick={()=>play(track)}>{busy?<LoaderCircle className="player-spin" size={23}/>:<PlayIcon playing={playing} size={23}/>}</Btn>
 <Btn title="Next track" disabled={!state.current} onClick={()=>act('next')}><SkipForward size={22} fill="currentColor"/></Btn><PlaybackModeButton mode="repeat" state={state} act={act}/></motion.div>
 <div className="player-panel-triggers"><Btn title={!immersive&&panel==='lyrics'?'Hide lyrics':'Show lyrics'} pressed={!immersive&&panel==='lyrics'} onClick={()=>choose('lyrics')}><MicVocal size={18}/></Btn>
 <Btn title={!immersive&&panel==='queue'?'Hide queue':'Show queue'} pressed={!immersive&&panel==='queue'} onClick={()=>choose('queue')}><ListMusic size={19}/></Btn></div></motion.div>
 <motion.div className="player-volume" layout={reduce||video?false:"position"} layoutDependency={immersive} transition={{duration:reduce?0:.42,ease}}><VolumeControl value={state.volume} act={act}/></motion.div>
 </motion.div>
 <AnimatePresence initial={false} mode="popLayout">{!immersive&&panel&&<motion.aside className="player-side" key="panel" aria-label="Playback panel" initial={{opacity:0,x:reduce?0:26}} animate={{opacity:1,x:0}} exit={{opacity:0,x:reduce?0:22,transition:{duration:reduce?0:.35,ease}}} transition={{duration:reduce?0:.4,ease}}>
 <div className="player-side-head"><div className="player-tabs">{(['queue','lyrics'] as const).map(p=><button key={p} aria-pressed={panel===p} onClick={()=>onPanel(p)}>{p==='lyrics'?'Lyrics':'Queue'}{panel===p&&<motion.i layoutId="player-tab-mark" transition={{duration:reduce?0:.25,ease}}/>}</button>)}</div><Btn title="Close panel" onClick={()=>choose(panel)}><X size={16}/></Btn></div>
 {panel==='queue'?<Queue state={state} act={act} api={api}/>:<Lyrics track={track} playing={playing&&!busy} active={active} duration={duration} position={position} api={api} reduce={reduce} seek={n=>act('seek',n)}/>}</motion.aside>}</AnimatePresence>
 </div></motion.section>
}

