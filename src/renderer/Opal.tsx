import { useEffect, useRef, type CSSProperties } from 'react'
import type { Desktop } from './types'
import './background.css'
export type Palette = [string,string,string]
export const opal:Palette=['#f1ac98','#9686ca','#8bcbd4']
function controlColor(hex:string,bright=false){
 let rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16))
 const luminance=()=>rgb.map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)
 if(Math.max(...rgb)-Math.min(...rgb)<20)rgb=bright?[205,201,211]:[56,51,61]
 for(let i=0;i<30&&(bright?luminance()<.45:luminance()>.17);i++)rgb=rgb.map(v=>bright?v+(255-v)*.1:v*.9)
 return '#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')
}
type PaletteStyle = CSSProperties & Record<'--field-accent' | '--field-deep' | '--field-glint', string>

function fieldColor(palette: Palette): PaletteStyle {
 return {'--field-accent':palette[0], '--field-deep':palette[1], '--field-glint':palette[2]}
}

export function Opal({palette=opal, reduce=false}:{palette?:Palette; reduce?:boolean}){
 const previous = useRef(palette)
 const film = useRef<HTMLDivElement>(null)

 useEffect(()=>{
   const root=document.documentElement
   if(!reduce&&!palette.every((color,index)=>color===previous.current[index]))window.dispatchEvent(new Event('music-palette-will-change'))
   root.style.setProperty('--art-accent',palette[0]);root.style.setProperty('--art-deep',palette[1]);root.style.setProperty('--art-glint',palette[2])
   root.style.setProperty('--music-accent',controlColor(palette[0]));root.style.setProperty('--music-accent-bright',controlColor(palette[0],true))
   const old=previous.current
   previous.current=palette
   if(reduce || document.hidden || !film.current || palette.every((color,i)=>color===old[i]))return
   // Fade a prepainted copy of the previous wash. Animating inherited colors
   // on documentElement would recolor every control on every animation frame.
   Object.entries(fieldColor(old)).forEach(([name,value])=>film.current!.style.setProperty(name,value))
   const fade=film.current.animate([{opacity:1},{opacity:0}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'})
   return ()=>fade.cancel()
 },[palette,reduce])

 return <div className="opal-field" aria-hidden="true" style={fieldColor(palette)}><div className="previous-wash" ref={film}/></div>
}

export function useGlassEnergy(api:Desktop|undefined, surface:'browse'|'mini'|'expanded', enabled:boolean){
 useEffect(()=>{
   if(!api || !enabled)return
   const selector={browse:'.dock-play',mini:'.mini-rim',expanded:'.player-sleeve'}[surface]
   let node:HTMLElement|null=null,lastLow=-1,lastHigh=-1
   const stop=api.onEnergy(({bass,treble})=>{
     if(document.hidden)return
     if(!node?.isConnected){
       node=document.querySelector<HTMLElement>(selector)
       lastLow=lastHigh=-1
     }
     if(!node)return
     const low=Math.round(Math.max(0,Math.min(1,bass))*24),high=Math.round(Math.max(0,Math.min(1,treble))*24)
     if(low!==lastLow){node.style.setProperty('--low',String(low/24));lastLow=low}
     if(high!==lastHigh && surface!=='browse'){node.style.setProperty('--high',String(high/24));lastHigh=high}
   })
   return ()=>{stop();node?.style.removeProperty('--low');node?.style.removeProperty('--high')}
 },[api,surface,enabled])
}
export function sampleCover(src:string,apply:(palette:Palette)=>void){
 let active=true;const img=new Image();img.crossOrigin='anonymous'
 img.onload=()=>{
   try{const c=document.createElement('canvas');c.width=c.height=16;const ctx=c.getContext('2d');if(!ctx)return
    ctx.drawImage(img,0,0,16,16);const pixels=ctx.getImageData(0,0,16,16).data
    const buckets=new Map<string,{r:number;g:number;b:number;n:number}>()
    for(let i=0;i<pixels.length;i+=4){const [r,g,b]=[pixels[i],pixels[i+1],pixels[i+2]];if(pixels[i+3]<200)continue
      const key=[r>>5,g>>5,b>>5].join('.'),bucket=buckets.get(key)||{r:0,g:0,b:0,n:0}
      bucket.r+=r;bucket.g+=g;bucket.b+=b;bucket.n++;buckets.set(key,bucket)}
    const colors=Array.from(buckets.values()).filter(s=>s.n>=2).sort((a,b)=>b.n-a.n).map(s=>[s.r/s.n,s.g/s.n,s.b/s.n])
    if(!colors.length){if(active)apply(opal);return}
    const saturation=(c:number[])=>Math.max(...c)-Math.min(...c)
    const ranked=colors.slice(0,18)
    const vivid=ranked.reduce((a,b)=>saturation(b)>saturation(a)?b:a,ranked[0])
    const deep=ranked.find(c=>Math.max(...c)<177 && Math.hypot(...c.map((v,i)=>v-vivid[i]))>65)||ranked[0]
    const glint=ranked.find(c=>Math.min(...c)>150 && Math.hypot(...c.map((v,i)=>v-vivid[i]))>62)||ranked[ranked.length-1]
    const colorsOut=[vivid,deep,glint].map(p=>'#'+p.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('')) as Palette
    if(active)apply(colorsOut)
   }catch{if(active)apply(opal)}
 };img.onerror=()=>{if(active)apply(opal)};img.src=src;return()=>{active=false}
}

