import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight,Disc3,ListMusic,Music2,UserRound} from 'lucide-react'
import {artURL,type Track} from './types'
import {ArtworkPlayback,Btn} from './ui'
import './home-history.css'

export type HistoryCard={key:string;title:string;subtitle?:string;kind:'artist'|'album'|'playlist'|'song';artwork?:string;track?:Track;open:()=>void}
function HistoryCover({item}:{item:HistoryCard}){
 const src=artURL(item.artwork,400),[failed,fail]=useState(''),Icon=item.kind==='artist'?UserRound:item.kind==='album'?Disc3:item.kind==='playlist'?ListMusic:Music2
 if(item.track)return <ArtworkPlayback decorative track={item.track} size={500} className="history-card-art"/>
 return <span className={'history-card-art '+item.kind}>{src&&failed!==src?<img src={src} alt="" draggable="false" onError={()=>fail(src)}/>:<Icon size={34} strokeWidth={1.2}/>}</span>
}
export function HistoryShelf({title,id,cards,empty}:{title:string;id:string;cards:HistoryCard[];empty:string}){
 const viewport=useRef<HTMLDivElement>(null),[page,setPage]=useState(0),items=cards.slice(0,18),pages=Math.ceil(items.length/6)
 useEffect(()=>{viewport.current?.scrollTo({left:0});setPage(0)},[cards[0]?.key])
 useLayoutEffect(()=>{const node=viewport.current;if(!node)return;const resize=new ResizeObserver(()=>{setPage(Math.round(node.scrollLeft/(node.clientWidth+12)))});resize.observe(node);return()=>resize.disconnect()},[pages])
 const go=(p:number)=>{const node=viewport.current;if(node)node.scrollTo({left:Math.max(0,p)*(node.clientWidth+12),behavior:'smooth'})}
 return <section id={id} className="history-shelf" aria-label={title}><div className="history-heading"><h2>{title}</h2>{pages>1&&<div className="shelf-controls"><Btn title={'Previous '+title+' page'} disabled={page===0} onClick={()=>go(page-1)}><ChevronLeft size={16}/></Btn><Btn title={'Next '+title+' page'} disabled={page===pages-1} onClick={()=>go(page+1)}><ChevronRight size={16}/></Btn></div>}</div>
 {items.length?<div className="history-pages" ref={viewport} onScroll={e=>{const node=e.currentTarget;setPage(Math.round(node.scrollLeft/(node.clientWidth+12)))}}>{Array.from({length:pages},(_,i)=><div className="history-page" key={i} aria-label={'Page '+(i+1)+' of '+pages}>{items.slice(i*6,(i+1)*6).map(item=><button key={item.key} className={'history-card '+item.kind} title={item.title} onClick={item.open}><HistoryCover item={item}/><b>{item.title}</b>{item.subtitle&&<small>{item.subtitle}</small>}</button>)}</div>)}</div>:<p className="empty-history-shelf">{empty}</p>}</section>
}

