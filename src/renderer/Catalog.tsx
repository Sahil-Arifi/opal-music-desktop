import {useEffect,useRef,useState} from 'react'
import {ArrowLeft,Check,Disc3,LoaderCircle,Play,ThumbsUp,UserRound} from 'lucide-react'
import type {Artist,CatalogCard,CatalogKind,CatalogPage,CatalogRef,Desktop,Track} from './types'
import {stamp,releaseLabel} from './types'
import {ArtworkPlayback,Btn,Cover} from './ui'
import {SongMenu} from './TrackMenu'
import './catalog.css'

function Cards({title,cards,pick}:{title:string;cards:CatalogCard[];pick:(kind:CatalogKind,ref:CatalogRef)=>void}){
 const [all,show]=useState(false)
 if(!cards?.length)return null
 return <section className="catalog-section"><header><h2>{title}</h2>{cards.length>6&&<button onClick={()=>show(!all)}>{all?'Show less':'See all'}</button>}</header><div className="catalog-cards">{cards.slice(0,all?undefined:6).map(card=><button key={card.id} onClick={()=>pick(card.kind,card)}><Cover track={{...card,artist:card.artist||''}} size={500}/><strong>{card.title}</strong><small>{[card.kind==='album'?releaseLabel(card.releaseType):undefined,card.year,card.artist].filter(Boolean).join(' · ')}</small></button>)}</div></section>
}
export function FollowedArtists({api,pick}:{api?:Desktop;pick:(kind:CatalogKind,ref:CatalogRef)=>void}){
 const [artists,setArtists]=useState<Artist[]>([]),[error,setError]=useState('')
 useEffect(()=>{let alive=true;api?.followedArtists?.().then(rows=>{if(alive)setArtists(rows)}).catch(()=>{if(alive)setError('Could not load followed artists.')});return()=>{alive=false}},[api])
 return <section className="catalog-section"><header><h2>Artists you follow</h2></header>{artists.length?<div className="catalog-cards followed-artists">{artists.map(artist=><button key={artist.id} onClick={()=>pick('artist',artist)}><Cover track={{...artist,artist:''}} size={400}/><strong>{artist.title}</strong></button>)}</div>:<p>{error||'Artists you follow in YouTube Music appear here after sync.'}</p>}</section>
}
export function Catalog({api,kind,reference,pick,play,back,notify,onArtwork}:{api?:Desktop;kind:CatalogKind;reference:CatalogRef;pick:(kind:CatalogKind,ref:CatalogRef)=>void;play:(track:Track)=>void;back:()=>void;notify:(message:string)=>void;onArtwork:(art?:string)=>void}){
 const topRequest=useRef(0)
 const [page,setPage]=useState<CatalogPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0),[topCount,setTopCount]=useState(5),[topLoading,setTopLoading]=useState(false),[topComplete,setTopComplete]=useState(false)
 useEffect(()=>{let alive=true;topRequest.current++;setPage(null);setError('');setTopCount(5);setTopComplete(false);setTopLoading(false);onArtwork(reference.artwork)
  Promise.resolve(api?.catalog?.(kind,reference)).then(result=>{if(!alive)return;if(!result)throw Error('Catalog pages are unavailable in this preview.');setPage(result);onArtwork(result.artwork)}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'Could not load this page.')});return()=>{alive=false}
 },[api,kind,reference,retry])
 async function follow(){
   if(!api?.artistFollow||!page||busy)return
   const previous=page,desired=!page.followed
   setBusy(true);setPage({...page,followed:desired})
   try{const result=await api.artistFollow(page.id,desired);setPage({...previous,...result});notify(result.followed?'Following '+page.title:'Unfollowed '+page.title)}
   catch(e){setPage(previous);notify(e instanceof Error?e.message:String(e))}
   finally{setBusy(false)}
 }
 const albumTracks=kind==='album'?page?.tracks:undefined
 const totalSeconds=albumTracks?.length&&albumTracks.every(t=>t.duration>0)?albumTracks.reduce((seconds,t)=>seconds+t.duration,0):undefined
 const albumDetails=albumTracks?[page?.year,albumTracks.length+' '+(albumTracks.length===1?'song':'songs'),totalSeconds?stamp(totalSeconds):undefined].filter(Boolean).join(' · '):null
 const tracks=page?.tracks.map(track=>kind==='album'?{...track,playContext:{kind:'album' as const,id:page.id,title:page.title,artist:page.artist,artwork:page.artwork,releaseType:page.releaseType}}:track)||[]
 const playItem=(track:Track)=>{
   const index=tracks.findIndex(item=>item.id===track.id)
   if(api?.playSequence&&index>=0)void api.playSequence(tracks,index).catch(error=>notify(error instanceof Error?error.message:'Playback failed.'))
   else play(track)
 }
 async function moreTopSongs(){
   if(!page||topLoading)return
   if(topCount<page.tracks.length){setTopCount(n=>n+10);return}
   if(!api?.artistTopSongs||topComplete)return
   const selected=page,request=++topRequest.current;setTopLoading(true)
   try{const tracks=await api.artistTopSongs({id:page.id,title:page.title});if(request!==topRequest.current)return;setPage(current=>current?.id===selected.id?{...current,tracks}:current);setTopCount(n=>n+10);setTopComplete(true)}
   catch(error){if(request===topRequest.current)notify(error instanceof Error?error.message:'Could not load more top songs.')}
   finally{if(request===topRequest.current)setTopLoading(false)}
 }
 return <><Btn className="back-button" title="Back to Home" onClick={back}><ArrowLeft size={16}/>Home</Btn><div className={'catalog-header '+kind}>
 <Cover track={{id:page?.id||reference.id||kind,title:page?.title||reference.title||'',artist:page?.artist||'',artwork:page?.artwork||reference.artwork}} size={1000}/><div><span className="view-intro">{kind==='artist'?'Artist':kind==='album'?releaseLabel(page?.releaseType||reference.releaseType):'Song'}</span><h1>{page?.title||reference.title||'Your music'}</h1>{page?.artist&&<p>{page.artist}</p>}{albumDetails&&<p className="catalog-album-details">{albumDetails}</p>}{page?.audience&&<p className="catalog-audience">{page.audience}</p>}<div className="action-row">{page?.tracks?.[0]&&<Btn className="ink-button" title={'Play '+page.title} onClick={()=>playItem(page.tracks[0])}><Play size={15} fill="currentColor"/>Play</Btn>}{kind==='artist'&&page&&<Btn disabled={busy} title={page.followed?'Unfollow artist':'Follow artist'} pressed={page.followed} onClick={()=>void follow()}>{page.followed?<Check size={16}/>:<UserRound size={16}/>} {page.followed?'Following':'Follow'}</Btn>}</div></div></div>
 {!page&&!error&&<p className="catalog-loading" role="status"><LoaderCircle className="player-spin" size={18}/>Opening {kind}…</p>}{error&&<div className="catalog-error" role="alert"><p>{error.replace(/^Error invoking remote method '[^']+': Error: /,'')}</p><Btn title="Retry music page" onClick={()=>setRetry(n=>n+1)}>Try again</Btn></div>}
 {page&&<><section className="catalog-section"><header><h2>{kind==='artist'?'Top songs':kind==='album'?'Tracks':'Recording'}</h2></header><ol className="catalog-tracks">{tracks.slice(0,kind==='artist'?topCount:undefined).map((track,i)=><li className="track-row" key={track.id+'-'+i}><span className="catalog-track-number">{i+1}</span><ArtworkPlayback track={track} onPlay={playItem}/><button className="track-main" onClick={()=>playItem(track)}><span><strong>{track.title}</strong><small>{track.artist}</small></span></button>{track.playCountLabel&&<small className="catalog-plays">{track.playCountLabel}</small>}<SongMenu track={track}/></li>)}</ol>{kind==='artist'&&(topCount<page.tracks.length||(!topComplete&&api?.artistTopSongs))&&<Btn className="catalog-show-more" title="Show more top songs" disabled={topLoading} onClick={()=>void moreTopSongs()}>{topLoading?'Loading…':'Show more'}</Btn>}{kind==='artist'&&topCount>5&&<Btn title="Show fewer top songs" onClick={()=>setTopCount(5)}>Show less</Btn>}</section>
 <Cards title="Albums" cards={page.albums} pick={pick}/><Cards title="Singles & EPs" cards={page.singles} pick={pick}/><Cards title="Related artists" cards={page.artists} pick={pick}/>{page.description&&<section className="catalog-section catalog-about"><h2>About</h2><p>{page.description}</p></section>}</>}
 </>
}

