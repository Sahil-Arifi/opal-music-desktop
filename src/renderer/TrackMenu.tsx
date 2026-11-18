import {createContext,useContext,useEffect,useLayoutEffect,useRef,useState,useMemo,useCallback,memo,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {AnimatePresence,motion} from 'motion/react'
import {Check,Disc3,Heart,Link,ListMusic,ListPlus,MoreHorizontal,Play,Radio,SkipForward,Trash2,ThumbsDown,ThumbsUp,UserRound,X,Plus} from 'lucide-react'
import {RatingState,type Rating} from './rating-state'
import {artURL,type CatalogKind,type CatalogRef,type Desktop,type Home,type State,type Track} from './types'

type Actions={videoOccluded?:boolean;suspendVideo?:(value:boolean)=>void;onPlaylistRemove?:(id:string,track:Track)=>()=>void;rating?:(track:Track)=>Rating;rate?:(track:Track,value:Rating)=>Promise<void>;ratingPending?:(track:Track)=>boolean;api?:Desktop;state:State;home:Home;notify:(message:string)=>void;navigateSearch:(query:string)=>void;openTrack:(track:Track)=>void;navigateCatalog?:(kind:CatalogKind,ref:CatalogRef)=>void;pickPlaylist:(track:Track)=>void;onPlaylistChanged?:(id:string)=>void}
const Context=createContext<Actions|null>(null)
export const useTrackActions=()=>useContext(Context)
const message=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):String(error)
export function TrackActionsProvider({api,state,home,notify,navigateSearch,openTrack,navigateCatalog,onPlaylistChanged,onPlaylistRemove,children}:Omit<Actions,'pickPlaylist'|'rating'|'rate'|'ratingPending'|'videoOccluded'|'suspendVideo'>&{children:ReactNode}){
 const [videoLayers,setVideoLayers]=useState(0)
 const suspendVideo=useMemo(()=>(blocked:boolean)=>setVideoLayers(count=>Math.max(0,count+(blocked?1:-1))),[])
 const [ratingVersion,revision]=useState(0)
 const latest=useRef({home,state});latest.current={home,state}
 const handlers=useRef({navigateSearch,openTrack,navigateCatalog,onPlaylistChanged,onPlaylistRemove});handlers.current={navigateSearch,openTrack,navigateCatalog,onPlaylistChanged,onPlaylistRemove}
 const stableHandlers=useMemo(()=>({navigateSearch:(q:string)=>handlers.current.navigateSearch(q),openTrack:(t:Track)=>handlers.current.openTrack(t),navigateCatalog:(kind:CatalogKind,ref:CatalogRef)=>handlers.current.navigateCatalog?.(kind,ref),onPlaylistChanged:(id:string)=>handlers.current.onPlaylistChanged?.(id),onPlaylistRemove:(id:string,t:Track)=>handlers.current.onPlaylistRemove?.(id,t)||(()=>{})}),[])
 const actionState=useMemo(()=>state,[state.current,state.playing,state.loading,state.library,state.queue,state.serviceQueue,state.disliked,state.currentRating])
 const accountKey=home.account.id||home.account.handle||home.account.email||home.account.name
 const ledger=useMemo(()=>new RatingState<Track>(async(track,rating)=>{
   if(!api)throw Error('Open the desktop app to rate music.')
   if(latest.current.home.radioActive&&latest.current.state.current?.id===track.id&&rating!=='none')await api.radio(rating)
   else await api.command('rateTrack',{track,rating})
 },()=>revision(value=>value+1)),[api,accountKey])
 useEffect(()=>()=>ledger.close(),[ledger])
 const sourceRating=useCallback((track:Track):Rating=>{const {home,state}=latest.current;return state.current?.id===track.id&&state.currentRating?state.currentRating:state.disliked?.includes(track.id)?'dislike':(track.source==='youtube'?home.liked:state.library).some(t=>t.source===track.source&&t.id===track.id)?'like':'none'},[])
 const rating=useCallback((track:Track)=>ledger.value(track.source+':'+track.id,sourceRating(track)),[ledger,sourceRating])
 const rate=useCallback(async(track:Track,value:Rating)=>{await ledger.set(track.source+':'+track.id,track,value,sourceRating(track))},[ledger,sourceRating])
 const ratingPending=useCallback((track:Track)=>ledger.pending(track.source+':'+track.id),[ledger])
 const [pick,setPick]=useState<Track|null>(null),[busy,setBusy]=useState('')
 async function add(id:string){
  if(!api||!pick)return
  const selected=pick;setBusy(id);setPick(null);notify('Adding to playlist…')
  try{await api.playlistAction('add',{id,videoIds:[selected.id],tracks:[selected]});onPlaylistChanged?.(id);notify('Added to playlist')}catch(error){notify(message(error))}finally{setBusy('')}
 }
 useEffect(()=>{if(!pick)return;suspendVideo(true);return()=>suspendVideo(false)},[pick,suspendVideo])
 useEffect(()=>{if(!pick)return;const key=(event:KeyboardEvent)=>{if(event.key==='Escape')setPick(null)};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[pick])
 const contextValue=useMemo(()=>({api,state:actionState,home,notify,...stableHandlers,videoOccluded:videoLayers>0,suspendVideo,rating,rate,ratingPending,pickPlaylist:setPick}),[api,actionState,home,notify,stableHandlers,videoLayers,suspendVideo,rating,rate,ratingPending,ratingVersion])
 return <Context.Provider value={contextValue}>{children}
 <AnimatePresence>{pick&&<motion.div className="song-picker-shade" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onPointerDown={event=>{if(event.target===event.currentTarget&&!busy)setPick(null)}}>
  <motion.section role="dialog" aria-modal="true" aria-label="Add to playlist" className="song-picker" initial={{y:16,scale:.98}} animate={{y:0,scale:1}} exit={{y:10,opacity:0}} transition={{duration:.24}}>
   <header><div><small>Your library</small><h2>Add to playlist</h2><p>{pick.title}</p></div><button aria-label="Close playlist picker" onClick={()=>setPick(null)}><X size={19}/></button></header>
   <div className="song-picker-list">{home.playlists.length?home.playlists.map(playlist=><button key={playlist.id} disabled={!!busy} onClick={()=>void add(playlist.id)}>{playlist.artwork?<img src={artURL(playlist.artwork,80)} alt=""/>:<span className="picker-playlist-icon"><ListMusic size={19}/></span>}<span><b>{playlist.title}</b><small>{busy===playlist.id?'Adding…':playlist.artist||'Playlist'}</small></span><ListPlus size={18}/></button>):<p>Your playlists will appear when library sync finishes.</p>}</div>
  </motion.section></motion.div>}</AnimatePresence></Context.Provider>
}

export const SongMenu=memo(function SongMenu({track,queueIndex}:{track:Track;queueIndex?:number}){
 const actions=useContext(Context),[open,setOpen]=useState(false),[point,setPoint]=useState({left:0,top:0})
 const trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null)
 const saved=actions?.rating?.(track)==='like'
 useLayoutEffect(()=>{if(!open||!menu.current)return;const triggerRect=trigger.current?.getBoundingClientRect();if(!triggerRect)return;const height=Math.min(menu.current.offsetHeight,innerHeight-16),width=menu.current.offsetWidth,below=triggerRect.bottom+7,top=below+height<=innerHeight-8?below:Math.max(8,triggerRect.top-height-7);setPoint({left:Math.max(8,Math.min(innerWidth-width-8,triggerRect.right-width)),top})},[open])
 useEffect(()=>{if(!open)return;actions?.suspendVideo?.(true);return()=>actions?.suspendVideo?.(false)},[open,actions?.suspendVideo])
 const close=()=>{setOpen(false);trigger.current?.focus({preventScroll:true})}
 function show(){const box=trigger.current?.getBoundingClientRect();if(!box)return;setPoint({left:Math.max(8,Math.min(innerWidth-258,box.right-250)),top:Math.max(8,Math.min(innerHeight-180,box.bottom+7))});setOpen(true)}
 useEffect(()=>{
  if(!open)return
  menu.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
  const outside=(event:PointerEvent)=>{if(!menu.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false)}
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();close()}}
  const reposition=()=>setOpen(false)
  document.addEventListener('pointerdown',outside,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',reposition)
  return()=>{document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',reposition)}
 },[open])
 if(!actions)return null
 const remote=track.source==='youtube'
 function run(fn:()=>Promise<unknown>|undefined,success?:string){close();Promise.resolve().then(fn).then(()=>{if(success)actions?.notify(success)}).catch(error=>actions?.notify(message(error)))}
 const items=[
  {title:'Play next',icon:SkipForward,click:()=>run(()=>{
    if(queueIndex===undefined)return actions!.api?.command('playNext',track)
    const tracks=[...actions!.state.queue,...(actions!.state.serviceQueue||[])];
    return actions!.api?.orderQueue([queueIndex,...tracks.map((_,i)=>i).filter(i=>i!==queueIndex)],tracks.map(t=>t.source+':'+t.id))
  },'Playing next')},
  {title:'Add to queue',icon:ListPlus,click:()=>run(()=>actions!.api?.command('queueTrack',track),'Added to queue')},
  {title:'Start radio',icon:Radio,disabled:!remote,click:()=>run(()=>actions!.api?.radioFromTrack(track))},
  {title:saved?'Remove from liked songs':'Add to liked songs',icon:ThumbsUp,click:()=>run(()=>actions!.rate?.(track,saved?'none':'like'),saved?'Removed from liked songs':'Added to liked songs')},
  {title:actions.rating?.(track)==='dislike'?'Remove dislike':'Dislike song',icon:ThumbsDown,click:()=>run(()=>actions!.rate?.(track,actions.rating?.(track)==='dislike'?'none':'dislike'),'Song rating saved')},
  {title:'Add to playlist',icon:ListMusic,disabled:!remote||!actions.home.account.connected,click:()=>{close();actions.pickPlaylist(track)}},
  {title:'More from '+track.artist,icon:UserRound,disabled:!track.artist,click:()=>{close();actions.navigateCatalog?actions.navigateCatalog('artist',{id:track.channelId,title:track.artist}):actions.navigateSearch(track.artist)}},
  ...(track.album?[{title:'More from '+track.album,icon:Disc3,click:()=>{close();actions.navigateCatalog?actions.navigateCatalog('album',{id:track.albumId,title:track.album,artist:track.artist,artwork:track.artwork}):actions.navigateSearch(track.album+' '+track.artist)}}]:[]),
  {title:'Song details',icon:Disc3,disabled:!remote,click:()=>{close();actions.navigateCatalog?.('song',{id:track.id,title:track.title,artist:track.artist,artwork:track.artwork})}},
  {title:'Share song',icon:Link,disabled:!remote,click:()=>run(async()=>{await navigator.clipboard.writeText('https://music.youtube.com/watch?v='+encodeURIComponent(track.id));actions.notify('Song link copied')})},
  ...(track.playlistId&&track.playlistId!=='LM'?[{title:'Remove from this playlist',icon:Trash2,click:()=>run(async()=>{const undo=actions!.onPlaylistRemove?.(track.playlistId!,track);actions!.notify('Removing from playlist…');try{await actions!.api?.playlistAction('remove',{id:track.playlistId,videoIds:[track.id],tracks:[track]});actions!.onPlaylistChanged?.(track.playlistId!)}catch(error){undo?.();throw error}},'Removed from playlist')}]:[]),
  ...(queueIndex!==undefined?[{title:'Remove from queue',icon:Trash2,click:()=>run(()=>actions!.api?.command('removeQueue',queueIndex),'Removed from queue')}]:[]),
 ]
 return <><button ref={trigger} className="song-menu-trigger" aria-label={'More options for '+track.title} title="More options" aria-haspopup="menu" aria-expanded={open} onClick={event=>{event.stopPropagation();open?close():show()}} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();show()}}}><MoreHorizontal size={18}/></button>
 {createPortal(<AnimatePresence>{open&&<motion.div ref={menu} role="menu" aria-label={track.title+' options'} className="song-menu" style={point} initial={{opacity:0,y:5,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:3,scale:.98}} transition={{duration:.17}} onKeyDown={event=>{
   if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return
   event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)')],index=buttons.indexOf(document.activeElement as HTMLButtonElement)
   buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus()
 }}>{items.map(item=><button role="menuitem" key={item.title} disabled={item.disabled} onClick={item.click}><item.icon size={16}/><span>{item.title}</span></button>)}</motion.div>}</AnimatePresence>,document.body)}</>
})

export function TrackFeedback({track,compact=false}:{track:Track;compact?:boolean}){
 const actions=useContext(Context),[pulse,setPulse]=useState<Rating>('none')
 if(!actions)return null
 const value=actions.rating?.(track)||'none',liked=value==='like',disliked=value==='dislike',pending=actions.ratingPending?.(track)
 async function vote(rating:Rating){
  if(!actions?.rate)return
  const next=value===rating?'none':rating;setPulse(rating)
  try{await actions.rate(track,next);actions.notify(next==='none'?'Song rating removed':next==='like'?'Added to liked songs':'Disliked · excluded from autoplay')}
  catch(e){actions.notify(message(e))}
 }
 return <div className={'track-feedback'+(compact?' compact':'')} data-pending={pending||undefined} onClick={e=>e.stopPropagation()}>{(['like','dislike'] as const).map(rating=>{
 const selected=rating==='like'?liked:disliked,Icon=rating==='like'?ThumbsUp:ThumbsDown
 return <motion.button key={rating} aria-label={selected?'Remove '+rating:rating==='like'?'Like song':'Dislike song'} aria-pressed={selected} title={selected?'Remove '+rating:rating==='like'?'Like song':'Dislike song'} animate={pulse===rating?{y:[0,-4,1,0],scale:[1,1.15,.96,1]}:{}} transition={{duration:.34,ease:[.22,1,.36,1]}} onAnimationComplete={()=>{if(pulse===rating)setPulse('none')}} onClick={()=>void vote(rating)}><Icon size={compact?15:18} fill={selected?'currentColor':'none'}/></motion.button>
 })}{<button title="Add to playlist" aria-label="Add to playlist" onClick={()=>actions.pickPlaylist(track)}>{compact?<Plus size={16}/>:<ListPlus size={18}/>}</button>}</div>
}

