import {useEffect,useRef,useState} from 'react'
import {AnimatePresence,motion} from 'motion/react'
import {Album,ChartNoAxesColumnIncreasing,ArrowLeft,ArrowRight,ArrowUpRight,AudioLines,Check,ChevronDown,ChevronRight,Compass,Disc3,Expand,Heart,House,Layers3,Library,ListMusic,Music2,Maximize2,Pin,Plus,Radio,Search,Settings2,SkipBack,SkipForward,Sparkles,ThumbsDown,ThumbsUp,UserRound,Waves} from 'lucide-react'
import {DiscoveryShelf,type MusicShelf} from './Discovery'
import {HistoryShelf,type HistoryCard} from './HomeHistory'
import {Avatar,collectionStatus,syncText} from './account-ui'
import {PlaybackModeButton} from './PlaybackModes'
import type {Desktop,Home,State,Track,Mode,Playlist} from './types'
import {artURL,stamp,releaseLabel} from './types'
import {TrackFeedback} from './TrackMenu'
import {VolumeControl} from './VolumeControl'
import {ArtworkPlayback,Btn,Cover,Empty,Mark,PlayIcon,Range,SectionHead,Shelf,spring,type Act} from './ui'

export type Page='Catalog'|'Home'|'Recent artists'|'New Releases'|'Discover'|'Liked Songs'|'Playlists'|'Playlist'|'Your Radio'|'Library'|'Queue'|'Account'|'Local music'|'Stats'
export type Navigate=(page:Page)=>void
const navMain=[['Home',House],['Recent artists',UserRound],['Discover',Compass],['Your Radio',Radio]] as const
const navLib=[['Liked Songs',ThumbsUp],['Stats',ChartNoAxesColumnIncreasing]] as const
export function Rail({page,go,home,playlist,openPlaylist,preview}:{page:Page;go:Navigate;home:Home;playlist:Playlist|null;openPlaylist:(p:Playlist)=>void;preview:boolean}){
 const [expanded,setExpanded]=useState(true)
 const item=(name:Page,icon:React.ReactNode,cb=()=>go(name),isCurrent=page===name)=><button key={name} className={'rail-item '+(isCurrent?'selected':'')} onClick={cb} aria-current={isCurrent?'page':undefined}>{isCurrent&&<motion.i layoutId="rail-lens" className="rail-lens" transition={spring}/>}<span>{icon}{name}</span></button>
 return <aside className="rail"><div className="rail-sheen"/><div className="drag-strip"/><div className="rail-brand"><Mark size={26}/><b>Opal Music</b></div>
 <nav><div className="nav-label">Browse</div>{navMain.map(([name,Icon])=>item(name,<Icon/>))}
 <div className="nav-label divided">Your music</div>{navLib.map(([name,Icon])=>item(name,<Icon/>))}
 <div className={'playlist-line '+(page==='Playlist'?'linked':'')}>{item('Library',<Library/>,()=>go('Library'),page==='Library'||page==='Playlists'||page==='Playlist')}<button title={expanded?'Collapse playlists':'Expand playlists'} aria-label={expanded?'Collapse playlists':'Expand playlists'} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}><ChevronDown style={{rotate:expanded?'0deg':'-90deg'}}/></button></div>
 <AnimatePresence initial={false}>{expanded&&home.playlists.length>0&&<motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} className="playlist-tree">{home.playlists.map(p=><button key={p.id} className={p.id===playlist?.id&&page==='Playlist'?'current':''} onClick={()=>openPlaylist(p)}>{p.title}</button>)}</motion.div>}</AnimatePresence>
 </nav><button className="profile" onClick={()=>go('Account')}><Avatar account={home.account}/><span><b>{preview?'Design preview':home.account.name||'Your account'}</b><small>{preview?'Reference collection':home.account.connected?(home.account.handle||home.account.email||'Connected account'):'Account settings'}</small></span><ChevronRight size={13}/></button></aside>
}
function Hero({track,open,play}:{track:Track;open:(t:Track,shared:string)=>void;play:(t:Track)=>void}){
 return <div className="hero" style={{'--hero-url':track.artwork?'url("'+artURL(track.artwork)+'")':'none'} as React.CSSProperties}>
  <div className="hero-haze"/><div className="hero-content">
   <div className="hero-kicker"><AudioLines size={14}/> Recently played</div>
   <h2><button onClick={()=>open(track,'lead-'+track.id)}>{track.album || track.title}</button></h2><p>{track.artist}</p><button className="hero-cta" aria-label={'Play '+track.title} onClick={()=>play(track)}><PlayIcon playing={false} size={13}/>Play{track.album?' track':''}</button>
  </div><ArtworkPlayback track={track} onPlay={play} className="hero-sleeve" shared={'lead-'+track.id}/>
 </div>
}
export function RadioSection({home,radio,mini=false}:{home:Home;radio:(v:'start'|'like'|'dislike'|'undo')=>void;mini?:boolean}){
 return <div className={'radio-card '+(mini?'small':'')}><div><div className="radio-key"><Radio size={15}/> Personal station</div><h3>Your Radio</h3><p>{home.radioActive?'Your station is playing.':'Built from the music you like.'}</p></div>
 {!home.radioActive&&<div className="radio-actions"><Btn title="Start your radio" className="radio-start" onClick={()=>radio('start')}><PlayIcon playing={false} size={14}/>Start radio</Btn></div>}</div>

}
type ArtistRef={id?:string;title:string;artist?:string;artwork?:string}
type RecentItem=(Track&{kind:'song'})|(ArtistRef&{kind:'album';track?:Track;releaseType?:import('./types').ReleaseType})|(Playlist&{kind:'playlist';track?:Track})
export function HomeView({api,home,open,play,go,refresh,radio,pickPlaylist,pickCatalog}: {api?:Desktop;pickCatalog?:(kind:'artist'|'album'|'song',ref:ArtistRef)=>void;pickPlaylist:(p:Playlist)=>void;home:Home&{recentArtists?:ArtistRef[];recentItems?:RecentItem[]};open:(t:Track,shared:string)=>void;play:(t:Track)=>void;go:Navigate;refresh:()=>void;radio:(v:'start'|'like'|'dislike'|'undo')=>void}){
 const [sections,setSections]=useState<MusicShelf[]>([]),[loading,setLoading]=useState(false)
 const requests=useRef(0)
 async function load(refresh=false,id?:string){
   if(!api?.discovery)return
   const request=++requests.current;setLoading(true)
   try{const next=await api.discovery(refresh,id);if(request===requests.current)setSections(next)}
   finally{if(request===requests.current)setLoading(false)}
 }
 useEffect(()=>{setSections([]);void load().catch(()=>{});return()=>{requests.current++}},[api,home.account.connected,home.account.handle])
 const refreshShelf=(id:string)=>load(true,id)
 const discover=sections.find(s=>s.id==='discover')||{id:'discover',title:'Discover',tracks:home.discover}
 const extras=sections.filter(s=>s.id!=='releases'&&!/new release|new from/i.test(s.title)&&s.id!==discover.id&&(s.tracks.length||s.playlists?.length))
 const history=collectionStatus(home.account,'Recently played')
 const recent=home.recent.filter((t,i,a)=>a.findIndex(x=>x.id===t.id)===i)
 const artistSource=home.recentArtists?.length?home.recentArtists:[...new Map(recent.filter(t=>t.artist).map(t=>[t.channelId||t.artist,{id:t.channelId,title:t.artist} as ArtistRef])).values()]
 const artistCards:HistoryCard[]=artistSource.map(artist=>({key:'artist-'+(artist.id||artist.title),title:artist.title,artwork:artist.artwork,kind:'artist',open:()=>pickCatalog?.('artist',artist)}))
 const historySource:RecentItem[]=home.recentItems?.length?home.recentItems:recent.map(t=>({...t,kind:'song' as const}))
 const historyCards:HistoryCard[]=historySource.map(item=>({key:item.kind+'-'+(item.id||item.title),kind:item.kind,title:item.title,artwork:item.artwork,
   subtitle:[item.kind==='album'?releaseLabel(item.releaseType):item.kind==='playlist'?'Playlist':'Song',item.artist].filter(Boolean).join(' · '),
   track:item.kind==='song'?item:('track' in item?item.track:recent.find(t=>item.kind==='album'?t.albumId===item.id:t.playlistId===item.id)),
   open:()=>{const track=item.kind==='song'?item:('track' in item?item.track:recent.find(t=>item.kind==='album'?t.albumId===item.id:t.playlistId===item.id));if(track)play(track);else if(item.kind==='playlist')pickPlaylist(item);else pickCatalog?.('album',item)}
 }))
 const seedArtist=recent[0]?.artist
 const fromArtist=seedArtist&&!extras.some(s=>s.title.toLocaleLowerCase().includes(seedArtist.toLocaleLowerCase()))?
   [...new Map([...home.liked,...home.discover,...home.releases,...sections.flatMap(s=>s.tracks)].filter(t=>t.artist===seedArtist&&t.id!==recent[0].id).map(t=>[t.id,t])).values()].slice(0,18):[]

 return <><div className="home-head"><div className="view-intro">Listen now</div><h1>Home</h1></div>
 {recent.length?<div className={'top-grid '+(recent.length<2?'solo':'')}><Hero track={recent[0]} open={open} play={play}/>
 {recent.length>1&&<section className="recent"><div className="recent-head"><span>In rotation</span><AudioLines size={14}/></div>{recent.slice(1,4).map(t=><div key={t.id} className="recent-item"><ArtworkPlayback track={t} onPlay={play} shared={'recent-'+t.id}/><button className="recent-detail" onClick={()=>play(t)}><span><strong>{t.title}</strong><small>{t.artist}</small></span><ChevronRight size={13}/></button></div>)}</section>}</div>:<div className="no-history"><div className="no-history-art"><Layers3 size={49} strokeWidth={1}/></div><div><span className="view-intro">Recently played</span><h2>{history==='syncing'?'Loading recent music…':history==='error'?'Could not load recent music':'No recent music yet'}</h2>
 <p role="status">{history==='syncing'?syncText(home.account):history==='error'?'Refresh your library to try again.':'Songs you play appear here.'}</p>
 <div className="action-row">{history!=='syncing'&&<><Btn title="Choose from liked songs" className="ink-button" onClick={()=>go('Liked Songs')}>Liked songs</Btn>{home.account.connected&&<Btn title="Refresh account library" className="soft-button" disabled={home.account.syncing} onClick={refresh}>Refresh library</Btn>}</>}</div></div></div>}
 <HistoryShelf id="home-recent-artists" title="Recently listened artists" cards={artistCards} empty="Artists you listen to appear here."/>
 <HistoryShelf id="home-recent-music" title="Recently listened" cards={historyCards} empty="Your recently played songs, albums, and playlists appear here."/>
 <DiscoveryShelf section={discover} anchor="home-discover" play={play} pickPlaylist={pickPlaylist} reload={refreshShelf} loading={loading}/>
 {fromArtist.length>0&&<DiscoveryShelf section={{id:'artist-'+seedArtist,title:'More from '+seedArtist,tracks:fromArtist}} play={play} pickPlaylist={pickPlaylist} reload={refreshShelf} loading={loading}/>}
 {extras.map(section=><DiscoveryShelf key={section.id} section={section} play={play} pickPlaylist={pickPlaylist} reload={refreshShelf} loading={loading}/>)}
 <section id="home-radio" className="shelf-section"><RadioSection home={home} radio={radio}/></section>
 </>
}
export function Mini({state,act,mode,search,open,preview}: {state:State;act:Act;mode:(m:Mode)=>void;search:()=>void;open:()=>void;preview:boolean}){
 const t=state.current
 return <main className={'mini-shell '+(state.playing?'is-playing':'')}>
 <div className="mini-bar"><div><Mark size={19}/><b>Music</b>{preview&&<small>Design preview</small>}</div><span/><Btn title="Search" onClick={search}><Search size={14}/></Btn><Btn title={state.pinned?'Unpin window':'Pin mini player'} pressed={!!state.pinned} onClick={()=>act('pin',!state.pinned)}><Pin size={14}/></Btn><Btn title="Open full player" onClick={open}><Expand size={14}/></Btn></div>
 <div className="mini-art-slot"><button className="mini-art" aria-label="Open now playing" onClick={open}><div className="mini-art-bleed" style={{backgroundImage:t?.artwork?'url("'+artURL(t.artwork)+'")':undefined}}/><Cover track={t} size={800} shared="playing-art"/><div className="mini-glint"/><i className="mini-rim"/>{state.playing&&<span className="live-bars"><i/><i/><i/><i/></span>}</button>
 </div><div className="mini-meta"><motion.b layoutId="playing-title" transition={spring}>{t?.title||'Nothing playing'}</motion.b><small>{t?.artist||'Choose music from your library'}</small>{t&&<TrackFeedback track={t} compact/>}</div>
 <div className="mini-progress"><Range key={state.current?.id} label="Seek" value={state.position} max={state.duration} change={n=>act('seek',n)} commit disabled={!state.duration}/><span>{stamp(state.position)}</span><span>{stamp(state.duration)}</span></div>
 <motion.div className="mini-transport" layoutId="playing-transport" transition={spring}><PlaybackModeButton mode="shuffle" state={state} act={act} size={15}/><Btn title="Previous track" disabled={!t} onClick={()=>act('previous')}><SkipBack size={17}/></Btn><Btn title={state.playing?'Pause':'Play'} disabled={!t} className="ink-circle" onClick={()=>act('toggle')}><PlayIcon playing={state.playing}/></Btn><Btn title="Next track" disabled={!t} onClick={()=>act('next')}><SkipForward size={17}/></Btn><PlaybackModeButton mode="repeat" state={state} act={act} size={15}/></motion.div>
 <div className="mini-volume"><VolumeControl value={state.volume} act={act} size={14}/></div></main>
}
export function Dock({state,act,go,mode,pick,openQueue,fullscreen,feedback}:{state:State;act:Act;go:Navigate;mode:(m:Mode)=>void;pick:()=>void;openQueue:()=>void;fullscreen:()=>void;feedback?:React.ReactNode}){
 const t=state.current
 return <footer className="dock" onClick={event=>{if(!(event.target as HTMLElement).closest('button,input,a,[role="button"]')){if(t)pick();else go('Library')}}}><div className="dock-glass"/><div className="dock-track-group"><button className="dock-track" onClick={t?pick:()=>go('Library')} aria-label="Open now playing"><Cover track={t} shared="playing-art"/><span><motion.b layoutId="playing-title" transition={spring}>{t?.title||'Nothing playing'}</motion.b><small>{t?.artist||'Choose a track'}</small></span></button>{t&&feedback}</div>
 <div className="dock-center"><motion.div className="dock-actions" layoutId="playing-transport" transition={spring}><PlaybackModeButton mode="shuffle" state={state} act={act} size={15}/><Btn title="Previous track" disabled={!t} onClick={()=>act('previous')}><SkipBack size={17} fill="currentColor"/></Btn><Btn title={state.playing?'Pause':'Play'} disabled={!t} onClick={()=>act('toggle')} className="dock-play"><PlayIcon playing={state.playing} size={16}/></Btn><Btn title="Next track" disabled={!t} onClick={()=>act('next')}><SkipForward size={17} fill="currentColor"/></Btn><PlaybackModeButton mode="repeat" state={state} act={act} size={15}/></motion.div>
 <div className="dock-progress"><small>{stamp(state.position)}</small><Range key={state.current?.id} label="Seek" value={state.position} max={state.duration} disabled={!state.duration} commit change={n=>act('seek',n)}/><small>{stamp(state.duration)}</small></div></div>
 <div className="dock-right"><VolumeControl value={state.volume} act={act} size={15}/><i/><Btn title="Open queue" onClick={openQueue}><ListMusic size={17}/></Btn><Btn title="Enter immersive player" disabled={!t} onClick={fullscreen}><Maximize2 size={17}/></Btn></div></footer>
}

