import {useContext,useEffect,useRef,useState} from 'react'
import {motion,useReducedMotion} from 'motion/react'
import {Album,Disc3,Headphones,Music2,RefreshCw,UserRound} from 'lucide-react'
import {artURL,type CatalogKind,type CatalogRef,type Desktop,type Track} from './types'
import {ArtworkPlayback,Btn,Empty,FullEffects} from './ui'
import {SongMenu} from './TrackMenu'
import './stats-motion.css'

const periods=[['week','Past week'],['month','Past month']] as const
type Period=typeof periods[number][0]
const plays=(n:number)=>n.toLocaleString()+' '+(n===1?'play':'plays')
const interval=(s:number)=>{const min=Math.floor(s/60);return s>0&&min<1?'<1 min':min<60?min+' min':Math.floor(min/60)+'h '+(min%60)+'m'}
const date=(value?:string)=>{if(!value)return '';const d=new Date(value);return Number.isNaN(+d)?'':d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}
type Rank={id:string;name:string;artist?:string;artwork?:string;plays:number;seconds:number;listeningSeconds?:number;estimatedSeconds?:number}
type NavigateCatalog=(kind:CatalogKind,ref:CatalogRef)=>void
function openRank(navigate:NavigateCatalog,kind:'artist'|'album',item:Rank){
 const direct=kind==='artist'?/^UC[\w-]{22}$/:/^MPRE[\w-]{5,120}$/
 navigate(kind,{id:direct.test(item.id)?item.id:undefined,title:item.name,artist:item.artist,artwork:item.artwork})
}
const listened=(item:Rank)=>(item.listeningSeconds??item.seconds)>0?(item.estimatedSeconds?'≈ ':'')+interval(item.listeningSeconds??item.seconds):'—'
function RankList({items,type,navigateCatalog}:{items:Rank[];type:'artists'|'albums';navigateCatalog:NavigateCatalog}){
 const Icon=type==='artists'?UserRound:Album
 return <section className="stats-list"><h2>Top {type}</h2>{items.length?<ol>{items.slice(0,12).map((item,i)=><li key={item.id}><button className="stats-rank-open" type="button" aria-label={'Open '+(type==='artists'?'artist ':'album ')+item.name} onClick={()=>openRank(navigateCatalog,type==='artists'?'artist':'album',item)}><span className="rank-number">{i+1}</span><span className={'rank-art '+type}>{item.artwork?<img src={artURL(item.artwork,150)} alt=""/>:<Icon size={18}/>}</span><span className="rank-names"><b>{item.name}</b>{item.artist&&<small>{item.artist}</small>}</span><small className="rank-count">{listened(item)}</small></button></li>)}</ol>:<p className="stats-nodata">No {type} in this period.</p>}</section>
}
export function Stats({api,play,navigateCatalog}:{api?:Desktop;play:(t:Track)=>void;navigateCatalog:NavigateCatalog}){
 type Report=Awaited<ReturnType<Desktop['stats']>>
 const [period,setPeriod]=useState<Period>('month'),[retry,setRetry]=useState(0)
 const [reports,setReports]=useState<Partial<Record<Period,Report>>>({}),[latest,setLatest]=useState<Period|null>(null),[error,setError]=useState('')
 const full=useContext(FullEffects),reduce=useReducedMotion()&&!full,lastRefresh=useRef(0)
 const report=reports[period]??(latest?reports[latest]:undefined),changing=!!report&&report.period!==period
 useEffect(()=>{
   let valid=true,received=false
   setError('')
   if(!api)return
   const accept=(data:Report)=>{
     if(!valid||data.period!==period)return
     setReports(current=>({...current,[period]:data}));setLatest(period);setError('')
   }
   const stop=api.onStats?.(data=>{if(valid&&data.period===period){received=true;accept(data)}})
   const refresh=retry!==lastRefresh.current;lastRefresh.current=retry
   api.stats(period,refresh).then(data=>{if(!received)accept(data)}).catch(()=>{if(valid&&!received)setError('Listening stats could not be loaded.')})
   return()=>{valid=false;stop?.()}
 },[period,retry,api])
 const artist=report?.artists[0],art=artURL(artist?.artwork,600),coverage=report?.coverage,start=date(coverage?.from),end=date(coverage?.to)
 const name=(p:Period)=>periods.find(([value])=>value===p)![1]
 const shown=report?.period??period,periodName=name(shown)
 const dateRange=[start,end!==start?end:''].filter(Boolean).join(' – ')
 const time=report?.time,measured=time?.measuredSeconds??report?.totals.seconds??0,estimated=time?.estimatedSeconds??0
 const amount=measured+estimated,clockLabel=estimated?'Estimated listening time':'Measured in this app'
 return <><div className="view-intro">Your music</div><div className="stats-heading" style={{flexWrap:'wrap'}}><h1>Listening stats</h1><div className="stats-periods" role="group" aria-label="Listening period">{periods.map(([value,label])=><button type="button" key={value} aria-pressed={period===value} onClick={()=>setPeriod(value)}>{period===value&&<motion.i className="stats-period-lens" layoutId="stats-period-lens" transition={{type:'spring',stiffness:420,damping:34,duration:reduce?0:undefined}}/>}<span>{label}</span></button>)}<Btn title="Refresh listening history" disabled={coverage?.loading} onClick={()=>setRetry(n=>n+1)}><RefreshCw size={13}/></Btn></div></div>
 {coverage&&<div className="stats-date-range">{periodName}{dateRange&&' · '+dateRange}{(changing||coverage.loading)&&<span role="status"> · Updating…</span>}</div>}
 {error&&<Empty title="Stats unavailable" action={()=>setRetry(n=>n+1)} label="Try again">{error}</Empty>}
 {!report&&!error?<p className="quiet" role="status">Loading {periodName.toLowerCase()}…</p>:report&&<motion.div key={shown} aria-busy={changing}
 initial={reduce?false:{opacity:.65,y:12}} animate={{opacity:changing ? .65 : 1,y:0}} transition={{duration:reduce?0:.28,ease:[.22,1,.36,1]}}>
 <div className="stats-overview">{artist&&<button type="button" className="stats-feature" aria-label={'Open top artist '+artist.name} onClick={()=>openRank(navigateCatalog,'artist',artist)} style={art?{backgroundImage:'linear-gradient(180deg,#1510190a,#17111ce6),url('+JSON.stringify(art)+')'}:undefined}><small><Headphones size={14}/> Most listened artist</small><div><h2>{artist.name}</h2><p>{listened(artist)}</p></div></button>}
 <div className="stats-totals">{[[Disc3,report.totals.plays.toLocaleString(),'Plays'],[Headphones,amount?(estimated?'≈ ':'')+interval(amount):'—',clockLabel],[UserRound,report.totals.artists.toLocaleString(),'Artists'],[Music2,report.totals.songs.toLocaleString(),'Songs']].map(([Icon,val,label])=>{const Glyph=Icon as typeof Disc3;return <div key={String(label)}><Glyph size={16}/><b>{String(val)}</b><small>{String(label)}</small></div>})}</div></div>
 {report.totals.plays>0?<><section className="stats-list stats-songs"><h2>Top songs</h2><ol>{report.songs.slice(0,12).map((song,i)=><li key={song.id}><span className="rank-number">{i+1}</span><div className="rank-song"><ArtworkPlayback track={song} onPlay={play} size={150} className="rank-art"/><button className="rank-names" onClick={()=>play(song)}><b>{song.title}</b><small>{song.artist}</small></button></div><small className="rank-count">{plays(song.plays)}</small><SongMenu track={song}/></li>)}</ol></section>
 <div className="stats-columns"><RankList items={report.artists} type="artists" navigateCatalog={navigateCatalog}/><RankList items={report.albums} type="albums" navigateCatalog={navigateCatalog}/></div></>:<Empty title="No plays in this period">Dated plays will appear here as your listening history updates.</Empty>}
 </motion.div>}</>
}

