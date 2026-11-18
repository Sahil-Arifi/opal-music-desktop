import {useEffect,useId,useRef,useState,type KeyboardEvent,type ReactNode} from 'react'
import {createPortal} from 'react-dom'
import {Check,ChevronDown} from 'lucide-react'
import './select.css'

type Option<T extends string>={value:T;label:string}
export function GlassSelect<T extends string>({label,value,options,onChange,disabled=false,icon}:{label:string;value:T;options:readonly Option<T>[];onChange:(value:T)=>void;disabled?:boolean;icon?:ReactNode}){
 const trigger=useRef<HTMLButtonElement>(null),list=useRef<HTMLDivElement>(null),id=useId()
 const [open,setOpen]=useState(false),[current,highlight]=useState(0)
 const [position,setPosition]=useState({left:0,top:0,width:158,maxHeight:280})
 const typed=useRef({text:'',time:0}),chosen=options.findIndex(option=>option.value===value)
 function measure(){
   const anchor=trigger.current?.getBoundingClientRect();if(!anchor)return
   const width=Math.min(innerWidth-20,Math.max(164,anchor.width)),height=Math.min(280,options.length*35+12),below=innerHeight-anchor.bottom-12
   const above=below<height&&anchor.top>below,maxHeight=Math.min(height,above?anchor.top-13:below)
   setPosition({left:Math.max(10,Math.min(anchor.right-width,innerWidth-width-10)),top:above?anchor.top-maxHeight-5:anchor.bottom+5,width,maxHeight})
 }
 function show(){if(disabled||!options.length)return;measure();highlight(Math.max(0,chosen));setOpen(true)}
 function close(restore=false){setOpen(false);if(restore)trigger.current?.focus({preventScroll:true})}
 function choose(i:number){const next=options[i];if(next){close(true);if(next.value!==value)onChange(next.value)}}
 useEffect(()=>{
   if(!open)return
   const outside=(e:PointerEvent)=>{const node=e.target as Node;if(!trigger.current?.contains(node)&&!list.current?.contains(node))close()}
   const scroll=(e:Event)=>{if(!list.current?.contains(e.target as Node))measure()}
   const resize=()=>measure()
   document.addEventListener('pointerdown',outside,true);document.addEventListener('scroll',scroll,true);window.addEventListener('resize',resize)
   return()=>{document.removeEventListener('pointerdown',outside,true);document.removeEventListener('scroll',scroll,true);window.removeEventListener('resize',resize)}
 },[open])
 useEffect(()=>{
   const host=list.current,node=host?.children[current] as HTMLElement|undefined
   if(!open||!host||!node)return
   const top=node.offsetTop,bottom=top+node.offsetHeight
   if(top<host.scrollTop)host.scrollTop=top
   else if(bottom>host.scrollTop+host.clientHeight)host.scrollTop=bottom-host.clientHeight
 },[open,current])
 function key(e:KeyboardEvent<HTMLButtonElement>){
   if(e.key==='Tab'){close();return}
   if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();close(true);return}
   if(e.key==='Enter'||e.key===' '){e.preventDefault();if(open)choose(current);else show();return}
   let next=open?current:Math.max(0,chosen)
   if(e.key==='ArrowDown')next=Math.min(options.length-1,next+1)
   else if(e.key==='ArrowUp')next=Math.max(0,next-1)
   else if(e.key==='Home')next=0
   else if(e.key==='End')next=options.length-1
   else if(e.key.length===1&&!e.metaKey&&!e.ctrlKey&&!e.altKey){
     const now=performance.now(),letter=e.key.toLocaleLowerCase();const prefix=now-typed.current.time<650?typed.current.text+letter:letter
     typed.current={text:prefix,time:now};const found=options.findIndex(o=>o.label.toLocaleLowerCase().startsWith(prefix));if(found<0)return;next=found
   }else return
   e.preventDefault();if(!open)show();highlight(next)
 }
 return <><button className="glass-select-trigger" ref={trigger} type="button" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" aria-controls={open?id:undefined} aria-activedescendant={open?id+'-'+current:undefined} disabled={disabled} onKeyDown={key} onClick={()=>open?close():show()}>
 {icon}<span>{options[chosen]?.label||label}</span><ChevronDown size={13}/></button>
 {open&&createPortal(<div ref={list} role="listbox" id={id} aria-label={label} style={position} className="glass-select-list">{options.map((option,i)=><div key={option.value} id={id+'-'+i} role="option" aria-selected={option.value===value} className={current===i?'active':''} onPointerMove={()=>highlight(i)} onPointerDown={e=>e.preventDefault()} onClick={()=>choose(i)}><span>{option.label}</span>{option.value===value&&<Check size={14}/>}</div>)}</div>,document.body)}</>
}

