import {createContext,useContext,useState,useRef,memo,type ReactNode,type CSSProperties} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import {Music2,Play,Pause,ArrowUpRight,ChevronRight,Plus,ListPlus,X,Check,Disc3} from 'lucide-react'
import {artURL,stamp,type Track,type Command} from './types'
import {SongMenu,useTrackActions} from './TrackMenu'
import {recordingKey} from '../main/recording.cjs'
import './artwork-playback.css'
export const FullEffects=createContext(false)
export const spring={type:'spring' as const,stiffness:360,damping:32,mass:.74}
export type Act=(name:Command,value?:unknown)=>void
export function Mark({size=32}: {size?:number}){
 return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><rect x="3" y="3" width="34" height="34" rx="9" fill="#344d70"/><path d="M12 15v10m8-17v24m8-20v16" stroke="#ddf4f8" strokeWidth="4" strokeLinecap="round"/></svg>
}
export function Google(){return <span aria-hidden="true">G</span>}
export function OpticalDefs(){return <svg className="defs" aria-hidden="true"><defs><filter id="optical-rim" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence baseFrequency=".015 .024" numOctaves="1" seed="11" result="grain"/><feGaussianBlur in="grain" stdDeviation="1.2" result="map"/><feDisplacementMap in="SourceGraphic" in2="map" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter></defs></svg>}
export function Btn({title,onClick,children,className='',disabled=false,pressed}: {title:string;onClick:()=>void;children:ReactNode;className?:string;disabled?:boolean;pressed?:boolean}){
 const osReduce=useReducedMotion(),full=useContext(FullEffects),reduce=osReduce&&!full
 return <motion.button type="button" aria-label={title} title={title} aria-pressed={pressed} className={'btn '+className} disabled={disabled} onClick={onClick} whileTap={reduce||disabled?undefined:{scale:.94}} transition={spring}>{children}</motion.button>
}
function SleeveImage({artwork,size,reduced}:{artwork:string;size:number;reduced:boolean}){
 const [fallback,setFallback]=useState(false),[broken,setBroken]=useState(false)
 const original=artURL(artwork),large=artURL(artwork,size)
 const upgraded=!fallback && large!==original
 // Chrome's auto sizes use the rendered sleeve width and actual display density.
 // Most list thumbnails therefore need only one small request, even on Retina.
 const candidates=new Map<string,number>()
 if(upgraded){
  const videoThumbnail=artwork.match(/\/(default|mqdefault|hqdefault|sddefault)\.(?:jpg|webp)$/)
  if(videoThumbnail){
   const widths:Record<string,number>={default:120,mqdefault:320,hqdefault:480,sddefault:640}
   candidates.set(original,widths[videoThumbnail[1]])
  }
  for(const width of [96,192,320,480,640,800,1000,size].filter(width=>width<=size)){
   const candidate=artURL(artwork,width)
   if(candidate!==original && !candidates.has(candidate))candidates.set(candidate,videoThumbnail?1280:width)
  }
 }
 const srcSet=upgraded && candidates.size>1 ? [...candidates].map(([url,width])=>url+' '+width+'w').join(', ') : undefined
 if(broken)return <div className="cover-fallback" aria-hidden="true"><Disc3/></div>
 return <img src={upgraded?large:original} srcSet={srcSet} sizes={srcSet?'auto':undefined} loading="lazy" decoding="async" alt="" draggable={false}
  onLoad={event=>{if(!reduced)event.currentTarget.animate([{opacity:.35},{opacity:1}],{duration:150,easing:'ease-out'})}}
  onError={()=>{if(upgraded)setFallback(true);else setBroken(true)}}/>
}
export function Cover({track,shared='',className='',size=640}:{track?:Pick<Track,'id'|'artwork'|'artist'|'album'|'title'>|null;shared?:string;className?:string;size?:number}){
 const reduce=useReducedMotion(),full=useContext(FullEffects)
 return <motion.div className={'cover '+className} layoutId={shared||undefined} transition={spring}>{track?.artwork
  ?<SleeveImage key={track.artwork} artwork={track.artwork} size={size} reduced={!!reduce&&!full}/>
  :<div className="cover-fallback" aria-hidden="true"><Disc3/></div>}</motion.div>
}
type PlaybackArtworkProps={track:Track;onPlay?:(track:Track)=>void;decorative?:boolean;shared?:string;size?:number;className?:string}
export const ArtworkPlayback=memo(function ArtworkPlayback({track,onPlay,decorative=false,shared,size,className=''}:PlaybackArtworkProps){
 const actions=useTrackActions()
 const current=actions?.state.current
 const selected=!!current&&track.source===current.source&&(track.id===current.id||(track.source==='youtube'&&recordingKey(track)===recordingKey(current)))
 const playing=selected&&!!actions?.state.playing
 const content=<><Cover track={track} shared={shared} size={size}/><span className="artwork-status" aria-hidden="true">
 {selected&&<span className="artwork-eq"><i/><i/><i/><i/></span>}
 <span className="artwork-action">{playing?<Pause size={16} fill="currentColor"/>:<Play size={16} fill="currentColor"/>}</span></span></>
 const classes='playback-art '+className+(selected?' selected':'')+(playing?' playing':'')
 function click(){
   if(!selected&&onPlay){onPlay(track);return}
   void actions?.api?.command(selected?'toggle':'playTrack',selected?undefined:track).catch(error=>actions.notify(error instanceof Error?error.message:'Playback failed.'))
 }
 if(decorative)return <span className={classes}>{content}</span>
 return <button className={classes} type="button" aria-label={(playing?'Pause ':'Play ')+track.title} onClick={click}>{content}</button>
})

export function Range({label,value,max,step=.1,change,disabled=false,commit=false}: {label:string;value:number;max:number;step?:number;change:(n:number)=>void;disabled?:boolean;commit?:boolean}){
 const [preview,set]=useState<number|null>(null),dragging=useRef(false)
 const v=preview??value,validMax=Math.max(.1,max||0)
 return <label className="range" style={{'--fill':Math.max(0,Math.min(100,100*v/validMax))+'%'} as CSSProperties}>
  <input type="range" min={0} max={validMax} step={step} value={Math.min(v,validMax)} aria-label={label} disabled={disabled} onPointerDown={e=>{if(commit){e.currentTarget.setPointerCapture(e.pointerId);dragging.current=true;set(Number(e.currentTarget.value))}}} onPointerCancel={()=>{dragging.current=false;set(null)}}
    onChange={e=>{const n=Number(e.currentTarget.value);if(commit && dragging.current)set(n);else change(n)}}
    onPointerUp={e=>{if(commit&&dragging.current){dragging.current=false;change(Number(e.currentTarget.value));set(null)}}}/>
  {preview!==null&&<output>{stamp(preview)}</output>}
 </label>
}
export function SectionHead({title,onAll,count}:{title:string;onAll?:()=>void;count?:number}){return <div className="section-head"><h2>{title}</h2>{count!==undefined&&<small>{count}</small>}{onAll&&<Btn title={'See all '+title} className="see-all" onClick={onAll}>See all <ChevronRight size={13}/></Btn>}</div>}
export function TrackRows({tracks,open,play,act,saved,queue=false}: {tracks:Track[];open:(t:Track)=>void;play:(t:Track)=>void;act:Act;saved:Track[];queue?:boolean}){
 return <div className="track-list">{tracks.map((t,i)=>{const has=saved.some(x=>x.id===t.id);return <div key={t.id+i} className="track-row">
 <ArtworkPlayback track={t} onPlay={play}/><button className="track-main" onClick={()=>open(t)}><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>
 <small className="duration">{t.duration?stamp(t.duration):''}</small>
 <Btn title={(has?'Remove saved ':'Save ')+t.title} onClick={()=>act(has?'removeSaved':'saveTrack',t)}>{has?<Check size={15}/>:<Plus size={15}/>}</Btn>
 <Btn title={(queue?'Remove from queue ':'Add to queue ')+t.title} onClick={()=>act(queue?'removeQueued':'queueTrack',queue?i:t)}>{queue?<X size={15}/>:<ListPlus size={16}/>}</Btn><SongMenu track={t} queueIndex={queue?i:undefined}/></div>})}</div>
}
export function Shelf({tracks,open,prefix}:{tracks:Track[];open:(t:Track,shared:string)=>void;prefix:string}){
 return <div className="shelf">{tracks.map((t,i)=><motion.div className="album" key={t.id+i} whileHover={{y:-3}} transition={spring}><ArtworkPlayback track={t} shared={prefix+t.id}/><button className="album-open" onClick={()=>open(t,prefix+t.id)}><strong>{t.album||t.title}</strong><small>{t.artist}</small></button><SongMenu track={t}/></motion.div>)}</div>
}
export function Empty({title,children,action,label}:{title:string;children?:ReactNode;action?:()=>void;label?:string}){
 return <div className="empty"><div className="empty-icon"><Music2 size={18}/></div><div><strong>{title}</strong>{children&&<p>{children}</p>}</div>{action&&<Btn title={label||title} className="soft-button" onClick={action}>{label||title}</Btn>}</div>
}
export const PlayIcon=({playing,size=17}:{playing:boolean;size?:number})=>playing?<Pause size={size} fill="currentColor"/>:<Play size={size} fill="currentColor"/>

