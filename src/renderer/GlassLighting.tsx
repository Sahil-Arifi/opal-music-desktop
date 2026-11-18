import {useEffect,useRef} from 'react'
import {createPortal} from 'react-dom'
import './glass-lighting.css'

const surfaces=[
 '.rail-item','.global-search-field','.collection-filter','.glass-select-trigger',
 '.google-button','.passkey-button','.ink-button','.ink-circle','.player-main-play',
 '.player-source-toggle button','.player-tabs button','.stats-periods button','.privacy-choices button'
].join(',')
const variables=['--glass-x','--glass-y','--glass-angle','--glass-strength'] as const

/**
 * One transparent reflection plane follows the hovered control, including controls
 * rendered in portals. Its bounds and rounded corners come from the actual hit target.
 */
export function GlassLighting({enabled}:{enabled:boolean}){
 const plane=useRef<HTMLDivElement>(null)
 useEffect(()=>{
   const layer=plane.current
   if(!enabled||!layer)return
   let target:HTMLElement|null=null,source:Element|null=null,frame=0,x=0,y=0
   function release(){
     if(target){target.classList.remove('glass-pointed');for(const key of variables)target.style.removeProperty(key)}
     target=null;source=null;layer!.classList.remove('lit')
     if(frame)cancelAnimationFrame(frame);frame=0
   }
   function render(){
     frame=0
     const node=source?.closest<HTMLElement>(surfaces)
     if(!node?.isConnected||node.closest('[inert]')||node.matches(':disabled')){release();return}
     const box=node.getBoundingClientRect()
     if(!box.width||!box.height||x<box.left||x>box.right||y<box.top||y>box.bottom){release();return}
     const style=layer!.style
     if(target!==node){
       if(target){target.classList.remove('glass-pointed');for(const key of variables)target.style.removeProperty(key)}
       target=node;node.classList.add('glass-pointed')
       const corners=getComputedStyle(node).borderRadius
       style.borderRadius=corners==='0px'?'5px':corners
     }
     const u=(x-box.left)/box.width,v=(y-box.top)/box.height
     const angle=Math.atan2(u-.5,.5-v)*180/Math.PI
     const edge=Math.min(1,Math.hypot((u-.5)*2,(v-.5)*2))
     const values=[(u*100).toFixed(1)+'%',(v*100).toFixed(1)+'%',angle.toFixed(1)+'deg',(.12+.06*edge).toFixed(2)]
     for(let i=0;i<variables.length;i++){style.setProperty(variables[i],values[i]);node.style.setProperty(variables[i],values[i])}
     style.width=box.width+'px';style.height=box.height+'px';style.transform='translate3d('+box.left+'px,'+box.top+'px,0)'
     layer!.classList.add('lit')
   }
   function onPointer(event:PointerEvent){
     if(event.pointerType==='touch'){release();return}
     source=event.target instanceof Element?event.target:null;x=event.clientX;y=event.clientY
     if(!frame)frame=requestAnimationFrame(render)
   }
   function onOut(event:PointerEvent){if(!event.relatedTarget)release()}
   function onKey(event:KeyboardEvent){if(event.key==='Tab'||event.key==='Escape')release()}
   document.addEventListener('pointermove',onPointer,{passive:true,capture:true})
   document.addEventListener('pointerover',onPointer,{passive:true,capture:true})
   document.addEventListener('pointerout',onOut,true)
   document.addEventListener('pointercancel',release,true)
   document.addEventListener('scroll',release,true)
   document.addEventListener('focusout',release,true)
   document.addEventListener('keydown',onKey,true)
   window.addEventListener('blur',release);window.addEventListener('resize',release)
   return()=>{release();document.removeEventListener('pointermove',onPointer,true);document.removeEventListener('pointerover',onPointer,true);document.removeEventListener('pointerout',onOut,true);document.removeEventListener('pointercancel',release,true);document.removeEventListener('scroll',release,true);document.removeEventListener('focusout',release,true);document.removeEventListener('keydown',onKey,true);window.removeEventListener('blur',release);window.removeEventListener('resize',release)}
 },[enabled])
 return enabled?createPortal(<div ref={plane} aria-hidden="true" className="glass-light-plane"/>,document.body):null
}

