import {memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react'
import {Reorder,useDragControls} from 'motion/react'
import {createPortal} from 'react-dom'
import {ArrowDownWideNarrow,Check,GripVertical,Play,Plus,Search,X} from 'lucide-react'
import type {Account,Desktop,Playlist,Track} from './types'
import {stamp} from './types'
import {ArtworkPlayback,Btn,type Act} from './ui'
import {CollectionEmpty} from './account-ui'
import {matchesTrack} from './Search'
import {PlaylistDialog,PlaylistSettings,type PlaylistDialogState} from './PlaylistActions'
import {SongMenu} from './TrackMenu'
import {GlassSelect} from './Select'
import {PlaylistArtwork} from './PlaylistArtwork'

type PlaylistDetail=Playlist&{mosaic?:string[];owner?:string;editable?:boolean}
const collator=new Intl.Collator(undefined,{sensitivity:'base',numeric:true})
function Filter({query,set,label}:{query:string;set:(s:string)=>void;label:string}){
 const ref=useRef<HTMLInputElement>(null)
 return <label className="collection-filter"><Search size={15}/><input ref={ref} type="text" placeholder={label} aria-label={label} value={query} onChange={e=>set(e.target.value)} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();set('');ref.current?.blur()}}}/>{query&&<button type="button" aria-label={label==='Find in playlist'?'Clear playlist filter':'Clear library filter'} title="Clear filter" onClick={()=>{set('');ref.current?.focus()}}><X size={13}/></button>}</label>
}
export function PlaylistLibrary({playlists,account,pick,refresh,api,notify}:{playlists:Playlist[];account:Account;pick:(p:Playlist)=>void;refresh:()=>void;api?:Desktop;notify?:(message:string)=>void}){
 const [dialog,setDialog]=useState<PlaylistDialogState|null>(null)
 const [enriched,setEnriched]=useState<Record<string,PlaylistDetail>>({}),grid=useRef<HTMLDivElement>(null),cached=useRef(new Map<string,PlaylistDetail>())
 function updatePlaylist(p:Playlist){
   cached.current.set(p.id,p);setEnriched(old=>({...old,[p.id]:p}));refresh()
 }

 const [query,setQuery]=useState(''),[sort,setSort]=useState('default')
 const filtered=useMemo(()=>{
   const key=query.trim().toLocaleLowerCase()
   const list=playlists.map(p=>({...p,...enriched[p.id]})).filter(p=>(p.title+' '+(p.artist||p.owner||'')).toLocaleLowerCase().includes(key))
   if(sort==='title')list.sort((a,b)=>collator.compare(a.title,b.title))
   if(sort==='count')list.sort((a,b)=>(b.count??-1)-(a.count??-1))
   return list
 },[playlists,query,sort,enriched])
 useEffect(()=>{
   if(!api?.playlistDetails||!grid.current)return
   let live=true,working=false
   const queue=new Set<string>(),tried=new Set<string>()
   const run=async()=>{
     if(working)return
     working=true
     while(live&&queue.size){
       const id=queue.values().next().value!;queue.delete(id)
       if(cached.current.has(id)||tried.has(id))continue
       tried.add(id)
       try{const meta=await api.playlistDetails(id);if(live){cached.current.set(id,meta);setEnriched(s=>({...s,[id]:meta}))}}catch{}
     }
     working=false
   }
   const observer=new IntersectionObserver(entries=>{for(const e of entries){const id=(e.target as HTMLElement).dataset.missing;if(!id)continue;if(e.isIntersecting)queue.add(id);else queue.delete(id)}void run()},{root:grid.current.closest('.canvas'),rootMargin:'90px'})
   grid.current.querySelectorAll('[data-missing]').forEach(el=>observer.observe(el))
   return()=>{live=false;observer.disconnect()}
 },[api,playlists,query,sort])

 return <><div className="view-intro">Your music</div><div className="page-heading"><h1>Library</h1>{account.connected&&<Btn title="Create playlist" className="ink-button" onClick={()=>setDialog({mode:'create'})}><Plus size={15}/>Create playlist</Btn>}</div>{!playlists.length?<CollectionEmpty account={account} collection="Playlists" title="No playlists yet" retry={refresh}>Your YouTube Music playlists appear here.</CollectionEmpty>:<>
 <div className="collection-toolbar"><Filter query={query} set={setQuery} label="Find playlists"/><GlassSelect label="Sort playlists" icon={<ArrowDownWideNarrow size={15}/>} value={sort} onChange={setSort} options={[{value:'default',label:'Library order'},{value:'title',label:'Playlist title'},{value:'count',label:'Most tracks'}]}/></div>
 <div className="collection-caption">{filtered.length} {filtered.length===1?'playlist':'playlists'}</div>
 {filtered.length?<div ref={grid} className="collection-grid">{filtered.map(p=><article key={p.id} className="library-tile" data-missing={!p.artwork||p.count==null?p.id:undefined}><button className="collection-card" onClick={()=>pick(p)}>
 <PlaylistArtwork playlist={p}/>
 <strong>{p.title}</strong><small>{[p.artist||p.owner,p.count!=null?p.count+' '+(p.countSource==='youtube'?(p.count===1?'video':'videos'):(p.count===1?'track':'tracks')):null].filter(Boolean).join(' · ')||'Playlist'}</small></button>
 <div className="playlist-card-tools"><PlaylistSettings playlist={p} api={api} onChange={updatePlaylist} notify={notify}/></div></article>)}</div>:<p className="playlist-search-empty">No matching playlists.</p>}</>}
 {dialog&&createPortal(<PlaylistDialog dialog={dialog} api={api} close={()=>setDialog(null)} notify={notify} done={p=>{if(p)updatePlaylist(p);else refresh();setDialog(null)}}/>,document.body)}</>

}

type Item={key:string;track:Track}
function identify(tracks:Track[]):Item[]{
 const seen=new Map<string,number>()
 return tracks.map(track=>{const n=seen.get(track.id)||0;seen.set(track.id,n+1);return{key:track.id+'#'+n,track}})
}
type Sort='custom'|'default'|'newest'|'oldest'|'title'|'artist'|'duration'

function SongRow({item,index,manual,saved,act,pick,commit,step}:{item:Item;index:number;manual:boolean;saved:boolean;act:Act;pick:()=>void;commit:()=>void;step:(delta:number)=>void}){
 const drag=useDragControls(),t=item.track
 return <Reorder.Item as="li" value={item} dragListener={false} drag={manual?'y':false} dragControls={drag} onDragEnd={commit} layout="position" className="playlist-track track-row" whileDrag={{zIndex:3}} transition={{type:'spring',stiffness:420,damping:36}}>
 {manual?<button type="button" className="order-grip" title="Drag to reorder, or use the up and down arrow keys" aria-label={'Move '+t.title} onPointerDown={e=>drag.start(e)} onKeyDown={e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();step(e.key==='ArrowUp'?-1:1)}}}><GripVertical size={15}/></button>:<span className="order-index">{index+1}</span>}
 <ArtworkPlayback track={t} onPlay={pick} className="order-art"/><button type="button" className="track-main" title={'Play '+t.title} onClick={pick}><span><strong>{t.title}</strong><small>{t.artist}</small></span></button>
 {t.duration>0&&<small className="duration">{stamp(t.duration)}</small>}
 <Btn title={(saved?'Remove saved ':'Save ')+t.title} onClick={()=>act(saved?'removeSaved':'saveTrack',t)}>{saved?<Check size={15}/>:<Plus size={15}/>}</Btn>
 <SongMenu track={t}/></Reorder.Item>
}

type TrackListProps={tracks:Track[];saved:Track[];act:Act;play:(tracks:Track[],index:number,partial:boolean)=>void;incomplete:boolean;id:string;subscribe?:Desktop['onPlaylistUpdate'];load:(sort:'default'|'newest'|'oldest')=>Promise<Track[]>;save:(ids:string[],ordered:Track[])=>Promise<void>;allowDates:boolean;query?:string}
// Clock updates recreate the parent's action closures. Keep those actions current
// without reconciling every draggable row when the playlist itself is unchanged.
export function PlaylistTracks({play,load,save,...data}:TrackListProps){
 const actions=useRef({play,load,save})
 useLayoutEffect(()=>{actions.current={play,load,save}},[play,load,save])
 const stable=useMemo<Pick<TrackListProps,'play'|'load'|'save'>>(()=>({
   play:(...args)=>actions.current.play(...args),
   load:sort=>actions.current.load(sort),
   save:(...args)=>actions.current.save(...args),
 }),[])
 return <OrderedPlaylist {...data} {...stable}/>
}

const OrderedPlaylist=memo(function OrderedPlaylist({tracks,saved,act,play,load,save,allowDates,incomplete,id,subscribe,query:controlledQuery}:TrackListProps){
 const [items,setItems]=useState(()=>identify(tracks)),[sort,setSort]=useState<Sort>('custom'),[localQuery,setLocalQuery]=useState(''),[busy,wait]=useState(false),[error,setError]=useState(''),[limit,setLimit]=useState(40)
 const sentinel=useRef<HTMLDivElement>(null)
 const query=controlledQuery??localQuery
 const latest=useRef(items),custom=useRef(items),before=useRef(items),version=useRef(0),alive=useRef(true),pendingSort=useRef<Sort|null>(null)
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;version.current++}},[])
 const show=(next:Item[])=>{latest.current=next;setItems(next)}
 useEffect(()=>{const next=identify(tracks);custom.current=next;before.current=next;show(next)},[tracks])
 useEffect(()=>subscribe?.(event=>{if(event.id===id&&pendingSort.current===event.sort)show(identify(event.tracks))}),[id,subscribe])
 const visible=useMemo(()=>query.trim()?items.filter(v=>matchesTrack(v.track,query)):items,[items,query])
 useEffect(()=>{setLimit(40)},[id,query,sort])
 useEffect(()=>{const node=sentinel.current;if(!node)return;const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))setLimit(value=>Math.min(visible.length,value+40))},{root:node.closest('.canvas'),rootMargin:'600px'});observer.observe(node);return()=>observer.disconnect()},[visible.length,limit])
 const savedIds=useMemo(()=>new Set(saved.map(t=>t.id)),[saved])
 const manual=sort==='custom'&&!query.trim()&&!busy&&!incomplete
 async function changeSort(next:Sort){
   const request=++version.current
   setError('');wait(false)
   if(next==='custom'){show(custom.current);setSort(next);return}
   if(next==='title'||next==='artist'||next==='duration'){
     const ordered=[...custom.current].sort((a,b)=>next==='duration'?a.track.duration-b.track.duration:collator.compare(a.track[next],b.track[next]))
     show(ordered);setSort(next);return
   }
   const previous=latest.current;pendingSort.current=next;wait(true)
   try{const list=await load(next);if(alive.current&&version.current===request){show(identify(list));setSort(next)}}
   catch(e){if(alive.current&&version.current===request){show(previous);setError(e instanceof Error?e.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'Could not sort this playlist.')}}
   finally{if(alive.current&&version.current===request){pendingSort.current=null;wait(false)}}
 }
 async function commit(next=latest.current){
   if(!manual||before.current.every((item,index)=>item.key===next[index]?.key))return
   const request=++version.current,prior=custom.current
   custom.current=next;before.current=next;wait(true);setError('')
   try{await save(next.map(i=>i.track.id),next.map(i=>i.track))}
   catch(e){if(alive.current&&request===version.current){custom.current=prior;before.current=prior;show(prior);setError(e instanceof Error?e.message:'Could not save the playlist order.')}}
   finally{if(alive.current&&request===version.current)wait(false)}
 }
 function step(item:Item,delta:number){
   if(!manual)return
   const current=latest.current,index=current.indexOf(item),target=index+delta
   if(index<0||target<0||target>=current.length)return
   const next=[...current];next.splice(index,1);next.splice(target,0,item);if(target>=limit)setLimit(target+1);show(next);void commit(next)
 }
 return <><div className="collection-toolbar">{controlledQuery===undefined&&<Filter query={query} set={setLocalQuery} label="Find in playlist"/>}<GlassSelect<Sort> label="Sort tracks" value={sort} icon={<ArrowDownWideNarrow size={15}/>} onChange={changeSort} disabled={busy||incomplete} options={[{value:'custom',label:'Custom order'},{value:'default',label:'Playlist order'},...(allowDates?[{value:'newest' as const,label:'Recently added'},{value:'oldest' as const,label:'First added'}]:[]),{value:'title',label:'Song title'},{value:'artist',label:'Artist'},{value:'duration',label:'Duration'}]}/></div>
 {query&&<p className="collection-caption" role="status">{visible.length} of {items.length} tracks</p>}{error&&<p className="playlist-error" role="alert">{error}</p>}
 {visible.length?<Reorder.Group axis="y" as="ul" values={visible.slice(0,limit)} onReorder={head=>{if(manual)show([...head,...latest.current.slice(limit)])}} className="ordered-tracks">
 {visible.slice(0,limit).map((item,index)=><SongRow key={item.key} item={item} index={index} manual={manual} saved={savedIds.has(item.track.id)} act={act} pick={()=>play(items.map(i=>i.track),items.indexOf(item),incomplete||!!pendingSort.current)} commit={()=>void commit()} step={delta=>step(item,delta)}/>)}</Reorder.Group>:<p className="playlist-search-empty">No matching tracks in this playlist.</p>}{limit<visible.length&&<div ref={sentinel} className="playlist-more"><button onClick={()=>setLimit(value=>Math.min(visible.length,value+40))}>Show more songs</button><small>{Math.min(limit,visible.length)} of {visible.length}</small></div>}</>
})

