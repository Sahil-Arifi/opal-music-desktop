import {useEffect,useLayoutEffect,useRef,useState} from 'react'
import {ArrowDown,LoaderCircle,MicVocal,Music2} from 'lucide-react'
import {stamp,type Desktop,type LyricsResult,type Track} from './types'
import './lyrics.css'

type Cue=LyricsResult['lines'][number]
type Word=NonNullable<Cue['words']>[number]
type Props={track:Track;position:number;duration:number;active:boolean;playing:boolean;api?:Desktop;reduce:boolean;seek:(time:number)=>void}
const empty:Cue[]=[]

function Words({words,text}:{words?:Word[];text:string}){
 return words?.length?<>{words.map((word,i)=><span key={i} className="lyric-word" data-start={word.start} data-end={word.end}>{word.text}</span>)}</>:<>{text}</>
}

function breakLabel(cue:Cue){
 if(cue.backing?.length||cue.adlibs?.length)return ''
 const line=cue.text.trim()
 if(!line||/^[♫♪♬♩\s]+$/.test(line))return 'Vocal break'
 if(/^\[(?:instrumental(?: break| interlude)?|music interlude)\]$/i.test(line))return line.slice(1,-1)
 return ''
}
function cueAt(cues:Cue[],time:number){
 let low=0,high=cues.length
 while(low<high){const mid=(low+high)>>>1;if(cues[mid].time<=time)low=mid+1;else high=mid}
 return low-1
}
export function Lyrics({track,position,duration,active,playing,api,reduce,seek}:Props){
 const [record,setRecord]=useState<{key:string;data:LyricsResult}|null>(null),[attempt,retry]=useState(0)
 const [current,setCurrent]=useState(-1),[following,follow]=useState(true)
 const scroll=useRef<HTMLDivElement>(null),anchor=useRef({time:position,wall:performance.now()}),activeIndex=useRef(-1)
 const key=[track.source,track.id,track.title,track.artist,Math.round(duration)].join('\n')
 const data=record?.key===key?record.data:null,cues=data?.synced?data.lines:empty
 useEffect(()=>{
   let valid=true
   follow(true)
   Promise.resolve(api?.lyrics({...track,duration})).then(result=>{
     if(valid)setRecord({key,data:result||{synced:false,lines:[]}})
   }).catch(()=>{if(valid)setRecord({key,data:{synced:false,lines:[],error:'Lyrics could not be loaded.'}})})
   return()=>{valid=false}
 },[api,key,attempt])
 useLayoutEffect(()=>{anchor.current={time:position,wall:performance.now()}},[position,playing,key])
 useEffect(()=>{
   let timer=0,lastIndex=-2
   type TimedNode={node:HTMLElement;start:number;end:number;value:number}
   const timed=(node:HTMLElement):TimedNode=>({node,start:Number(node.dataset.start),end:Number(node.dataset.end),value:-1})
   const words=(node:HTMLElement|null|undefined)=>[...(node?.querySelectorAll<HTMLElement>('.lyric-word')||[])].map(timed)
   const backing=[...(scroll.current?.querySelectorAll<HTMLElement>('.lyric-backing[data-start]')||[])].map(node=>{
     const item=timed(node),owner=Number(node.closest<HTMLElement>('[data-cue]')?.dataset.cue)
     return {...item,owner,words:words(node)}
   })
   let lead:TimedNode[]=[]
   function paint(){
     clearTimeout(timer)
     if(document.hidden)return
     const ref=anchor.current,time=Math.min(duration||Infinity,ref.time+(playing?(performance.now()-ref.wall)/1000:0))
     const index=active?cueAt(cues,time):-1
     if(index!==activeIndex.current){activeIndex.current=index;setCurrent(index)}
     if(index!==lastIndex){
       lastIndex=index
       lead=words(scroll.current?.querySelector<HTMLElement>('[data-cue="'+index+'"] .lyric-ink'))
     }
     let wake=cues[index+1]?.time??Infinity
     function illuminate(item:TimedNode){
       const {start,end}=item,hasEnd=Number.isFinite(end)&&end>start
       const fraction=time<start?0:hasEnd?Math.min(1,(time-start)/(end-start)):1
       const value=Math.round(fraction*1000)
       if(item.value!==value){item.value=value;item.node.style.setProperty('--word-lit',value/10+'%')}
       if(time<start)wake=Math.min(wake,start)
       else if(hasEnd&&time<end)wake=Math.min(wake,time+1/30)
     }
     for(const word of lead)illuminate(word)
     for(const part of backing){
       const show=active&&time>=part.start&&(Number.isFinite(part.end)?time<part.end:index===part.owner)
       if(part.value!==Number(show)){part.value=Number(show);part.node.dataset.active=String(show)}
       if(show){for(const word of part.words)illuminate(word);if(Number.isFinite(part.end))wake=Math.min(wake,part.end)}
       else if(time<part.start)wake=Math.min(wake,part.start)
     }
     if(playing&&active&&Number.isFinite(wake))timer=window.setTimeout(paint,Math.max(16,(wake-time)*1000))
   }
   paint();document.addEventListener('visibilitychange',paint)
   return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',paint)}
 },[active,playing,cues,duration,position])
 useLayoutEffect(()=>{
   const host=scroll.current;if(!host||!following)return
   const line=host.querySelector<HTMLElement>('[data-cue="'+current+'"]')
   const align=(animate:boolean)=>{
     const offset=line?line.getBoundingClientRect().top-host.getBoundingClientRect().top+host.scrollTop-(host.clientHeight-line.offsetHeight)/2:0
     host.scrollTo({top:offset,behavior:animate&&!reduce?'smooth':'instant'})
   }
   align(true)
   let previousHeight=host.clientHeight
   const resize=new ResizeObserver(()=>{if(host.clientHeight!==previousHeight){previousHeight=host.clientHeight;align(false)}})
   resize.observe(host);return()=>resize.disconnect()
 },[current,cues,following,reduce])
 if(!data)return <div className="player-panel-status" role="status"><LoaderCircle className="player-spin" size={24}/><p>Finding lyrics…</p></div>
 if(!cues.length&&!data.plain?.trim())return <div className="player-panel-status" role="status"><MicVocal size={27}/><h3>{data.instrumental?'Instrumental':data.error?'Couldn’t load lyrics':'Lyrics unavailable'}</h3><p>{data.instrumental?'This recording has no vocals.':data.error||'No lyrics for this recording.'}</p>{data.error&&<button onClick={()=>{setRecord(null);retry(n=>n+1)}}>Try again</button>}</div>
 const pauseFollow=()=>{if(active&&cues.length)follow(false)}
 return <><div className="lyrics-scroll" ref={scroll} onWheel={pauseFollow} onTouchMove={pauseFollow}>
 {cues.length?<div className="lyrics-lines">{cues.map((cue,i)=>{const pause=breakLabel(cue);return <button key={i} className={'lyric-line'+(i===current?' current':i<current?' past':'')} data-cue={i} data-current={i===current} aria-current={i===current?'true':undefined} aria-label={'Seek to '+stamp(cue.time)+' '+(pause||[cue.text,...(cue.backing?.map(v=>v.text)||cue.adlibs||[])].join(' '))} aria-disabled={!active} onClick={()=>{if(active){follow(true);seek(cue.time)}}}>
 {pause?<span className="lyric-break"><Music2 size={15} aria-hidden="true"/><span>{pause}</span></span>:cue.text&&<span className="lyric-ink"><Words text={cue.text} words={cue.words}/></span>}
 {cue.backing?.length?cue.backing.map((backing,j)=><small key={j} className="lyric-backing" data-start={backing.start} data-end={backing.end}><Words words={backing.words} text={backing.text}/></small>):cue.adlibs?.map((line,j)=><small className="lyric-backing" data-active={i===current} key={j}>{line}</small>)}
 </button>})}</div>:<div className="plain-lyrics">{data.plain}</div>}
 </div><div className="lyrics-credit">{data.source&&<span>{cues.some(cue=>cue.words?.length||cue.backing?.some(v=>v.words?.length))?'Word synced':cues.length?'Line synced':'Untimed lyrics'} · {data.source}</span>}{!following&&<button onClick={()=>follow(true)}><ArrowDown size={12}/>Follow lyrics</button>}</div></>
}

