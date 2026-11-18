import {releaseLabel} from './types'
import {Fragment,useEffect,useMemo,useRef,useState,type RefObject} from 'react'
import {AnimatePresence,motion} from 'motion/react'
import {History,Search,X} from 'lucide-react'
import type {CatalogCard,Desktop,Home,Playlist,SearchRecent,SearchResults,Track} from './types'
import {ArtworkPlayback,Cover} from './ui'
import {SongMenu,useTrackActions} from './TrackMenu'
import './search-results.css'
const normalize=(text:string)=>text.toLocaleLowerCase().normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim()
export function matchesTrack(track:Track,query:string){const terms=normalize(query).split(' ').filter(Boolean),haystack=normalize([track.title,track.artist,track.album].filter(Boolean).join(' '));return terms.every(term=>haystack.includes(term))}
type Props={api?:Desktop;home:Home;library:Track[];playlistTracks:Track[];input:RefObject<HTMLInputElement|null>;play:(t:Track)=>void;queue:(t:Track)=>void;choosePlaylist:(p:Playlist)=>void;seed:{id:number;query:string};reduce:boolean;context:string;playlistContext?:boolean;onPlaylistQuery?:(query:string)=>void;pickCatalog?:(kind:'artist'|'album'|'song',ref:CatalogCard)=>void}
type Choice={item:SearchRecent;group:string}
const empty:SearchResults={songs:[],artists:[],albums:[],playlists:[]}
export function GlobalSearch({api,home,library,playlistTracks,input,play,choosePlaylist,seed,reduce,context,playlistContext=false,onPlaylistQuery,pickCatalog}:Props){
 const actions=useTrackActions()
 const [query,setQuery]=useState(''),[opened,setOpened]=useState(false),[selected,setSelected]=useState(0),[recents,setRecents]=useState<SearchRecent[]>([])
 const [remote,setRemote]=useState<{key:string;results:SearchResults;error?:string}|null>(null)
 const cache=useRef(new Map<string,SearchResults>()),host=useRef<HTMLDivElement>(null),menu=useRef<HTMLDivElement>(null),key=query.trim(),normalized=normalize(key),settled=remote?.key===normalized
 useEffect(()=>{setOpened(false);setQuery('');setSelected(0);onPlaylistQuery?.('')},[context,playlistContext])
 useEffect(()=>{cache.current.clear();setRecents([]);setRemote(null)},[home.account.id,home.account.connected])
 useEffect(()=>{if(!seed.id)return;setQuery(seed.query);if(playlistContext)onPlaylistQuery?.(seed.query);else setOpened(true);setSelected(0);input.current?.focus()},[seed])
 useEffect(()=>{if(playlistContext||!opened||!api?.recentSearches)return;let alive=true;api.recentSearches().then(v=>{if(alive)setRecents(v)}).catch(()=>{});return()=>{alive=false}},[playlistContext,opened,api,home.account.id])
 useEffect(()=>{
  if(playlistContext||!opened||!key||!api)return
  let alive=true;const cached=cache.current.get(normalized);if(cached){setRemote({key:normalized,results:cached});return}
  const timer=setTimeout(()=>{const request=api.searchCatalog?api.searchCatalog(key):api.search(key).then(songs=>({...empty,songs}));request.then(results=>{if(!alive)return;cache.current.set(normalized,results);if(cache.current.size>48)cache.current.delete(cache.current.keys().next().value!);setRemote({key:normalized,results})}).catch(()=>{if(alive)setRemote({key:normalized,results:empty,error:'Online search is unavailable.'})})},80)
  return()=>{alive=false;clearTimeout(timer)}
 },[normalized,api,opened,playlistContext])
 useEffect(()=>{if(!opened)return;const outside=(e:PointerEvent)=>{if(!host.current?.contains(e.target as Node)&&!(e.target as Element).closest('.song-menu'))setOpened(false)};document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside)},[opened])
 const choices=useMemo(()=>{
  if(playlistContext||!opened)return []
  const all:Choice[]=[],seen=new Set<string>()
  const add=(item:SearchRecent,group:string)=>{const id=item.kind==='track'?'song:'+item.track.id:item.kind==='playlist'?'playlist:'+item.playlist.id:item.kind==='catalog'?item.card.kind+':'+item.card.id:'query:'+item.query;if(!seen.has(id)){seen.add(id);all.push({item,group})}}
  if(!key){for(const item of recents.slice(0,8))add(item,'Recent searches');for(const playlist of home.playlists.slice(0,4))add({kind:'playlist',playlist},'Your playlists');return all}
  const results=settled?remote.results:empty
  for(const card of results.artists.slice(0,4))add({kind:'catalog',card:{...card,kind:'artist'}},'Artists')
  let count=0
  for(const batch of [library,home.liked,playlistTracks,home.recent,home.discover,results.songs])for(const track of batch){if(count<12&&matchesTrack(track,key)&&!seen.has('song:'+track.id)){add({kind:'track',track},'Songs');count++}}
  // The provider may return recordings matching an alternate spelling.
  for(const track of results.songs){if(count<12&&!seen.has('song:'+track.id)){add({kind:'track',track},'Songs');count++}}
  for(const card of results.albums.slice(0,5))add({kind:'catalog',card:{...card,kind:'album'}},'Albums')
  for(const playlist of home.playlists.filter(p=>normalize(p.title+' '+(p.artist||'')).includes(normalized)).slice(0,4))add({kind:'playlist',playlist},'Playlists')
  for(const playlist of results.playlists.slice(0,4))add({kind:'playlist',playlist},'Playlists')
  return all
 },[playlistContext,opened,normalized,recents,remote,home.playlists,library,playlistTracks,home.liked,home.recent,home.discover])
 const chosen=Math.min(selected,choices.length-1),popup=opened&&(!!key||choices.length>0)
 useEffect(()=>{if(!popup||playlistContext)return;actions?.suspendVideo?.(true);return()=>actions?.suspendVideo?.(false)},[popup,playlistContext,actions?.suspendVideo])
 const close=()=>{setQuery('');setOpened(false);setSelected(0)}
 function pick(item:SearchRecent){
  if(api?.rememberSearch)void api.rememberSearch(item).catch(()=>{})
  if(item.kind==='query'){setQuery(item.query);setSelected(0);input.current?.focus();return}
  close();if(item.kind==='track')play(item.track);else if(item.kind==='playlist')choosePlaylist(item.playlist);else pickCatalog?.(item.card.kind,item.card)
 }
 const filter=(value:string)=>{setQuery(value);onPlaylistQuery?.(value)}
 return <div className={'global-search'+(popup&&!playlistContext?' searching':'')} ref={host} onBlur={e=>{if(e.relatedTarget&&!host.current?.contains(e.relatedTarget as Node)&&!(e.relatedTarget as Element).closest?.('.song-menu'))setOpened(false)}}>
 <div className="global-search-field"><Search size={16} aria-hidden="true"/><input ref={input} role={playlistContext?'searchbox':'combobox'} aria-label={playlistContext?'Search playlist':'Search music'} aria-autocomplete={playlistContext?undefined:'list'} aria-expanded={playlistContext?undefined:popup} aria-controls={!playlistContext&&popup?'global-search-results':undefined} aria-activedescendant={!playlistContext&&popup&&chosen>=0?'search-track-'+chosen:undefined} placeholder={playlistContext?'Search playlist':'Search music'} value={query} onFocus={()=>{if(!playlistContext)setOpened(true)}} onClick={()=>{if(!playlistContext)setOpened(true)}} onChange={e=>{if(playlistContext)filter(e.target.value);else{setQuery(e.target.value);setSelected(0);setOpened(true)}}} onKeyDown={e=>{
  if(e.key==='Escape'){e.stopPropagation();if(playlistContext)filter('');else close();input.current?.blur();return}
  if(playlistContext||!popup||!choices.length)return
  if(e.key==='Enter'){e.preventDefault();pick(choices[Math.max(0,chosen)].item)}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const next=Math.max(0,Math.min(choices.length-1,chosen+(e.key==='ArrowDown'?1:-1)));setSelected(next);menu.current?.querySelector('#search-match-'+next)?.scrollIntoView({block:'nearest'})}
 }}/>{query?<button className="search-clear" title="Clear search" aria-label="Clear search" onClick={()=>{if(playlistContext)filter('');else close();input.current?.focus()}}><X size={13}/></button>:<kbd>⌘ K</kbd>}</div>
 <AnimatePresence>{!playlistContext&&popup&&<motion.div className="suggest-popover" key="suggestions" initial={{opacity:0,y:reduce?0:-5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduce?0:-4}} transition={{duration:reduce?0:.18}}><div ref={menu} id="global-search-results" role="listbox" aria-label="Music results" className="suggest-list">
 {choices.map(({item,group},index)=>{
  const track=item.kind==='track'?item.track:null,playlist=item.kind==='playlist'?item.playlist:null,card=item.kind==='catalog'?item.card:null
  const title=track?.title||playlist?.title||card?.title||(item.kind==='query'?item.query:''),kind=track?'Song':playlist?'Playlist':card?.kind==='artist'?'Artist':card?releaseLabel(card.releaseType):'Search'
  const credit=track?.artist||playlist?.artist||card?.artist,sub=[kind,credit&&credit!==title?credit:''].filter(Boolean).join(' · ')
  const art=track||{id:playlist?.id||card?.id||'',title,artist:'',artwork:playlist?.artwork||card?.artwork}
  return <Fragment key={item.kind+kind+art.id+title}>{choices[index-1]?.group!==group&&<h3 className="suggest-label">{group}</h3>}<div id={'search-match-'+index} className={'suggest-row'+(index===chosen?' highlighted':'')} onPointerMove={()=>setSelected(index)}><button type="button" role="option" id={'search-track-'+index} aria-selected={chosen===index} aria-label={track?'Play '+title+' by '+(credit||'unknown artist'):'Open '+kind.toLowerCase()+' '+title} className="suggest-pick" onClick={()=>pick(item)}><span className={'suggest-art '+(kind==='Artist'?'artist-portrait':'')}>{item.kind==='query'?<History size={17}/>:track?<ArtworkPlayback track={track} decorative/>:<Cover track={art}/>}</span><span><b>{title}</b><small>{sub}</small></span></button>{group==='Recent searches'&&<button className="search-clear" aria-label={'Remove '+title+' from search history'} onClick={()=>{const previous=recents;setRecents(rows=>rows.filter(row=>row!==item));void api?.removeSearch?.(item).catch(()=>setRecents(previous))}}><X size={15}/></button>}{track&&<SongMenu track={track}/>}</div></Fragment>
 })}</div>{key&&settled&&remote.error?<p className="suggest-status" role="status">{remote.error}</p>:key&&!choices.length?<p className="suggest-status" role="status">{settled?'No matching music.':'Searching YouTube Music…'}</p>:null}</motion.div>}</AnimatePresence></div>
}

