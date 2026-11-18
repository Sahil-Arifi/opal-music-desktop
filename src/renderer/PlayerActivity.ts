import {useEffect,type RefObject} from 'react'

// Mouse movement only changes a class at visibility boundaries, never React state.
export function usePlayerActivity(stage:RefObject<HTMLElement|null>,enabled:boolean,playing:boolean,busy:boolean,suspended:boolean,trackId:string){
 useEffect(()=>{
  const node=stage.current;if(!node)return
  let timer:ReturnType<typeof setTimeout>|undefined,last=performance.now(),dragging=false,keyboard=false,disposed=false
  const controls='.player-header,.player-progress,.player-playback,.player-volume'
  function held(){return !playing||busy||suspended||dragging||(keyboard&&node!.contains(document.activeElement))||!!node!.querySelector(controls.split(',').map(s=>s+':hover').join(','))}
  function check(){timer=undefined;if(disposed||!enabled)return;if(held()){node!.classList.remove('controls-resting');return}const remaining=2500-(performance.now()-last);if(remaining>0)timer=setTimeout(check,remaining);else node!.classList.add('controls-resting')}
  function show(){last=performance.now();node!.classList.remove('controls-resting');if(enabled&&!timer)timer=setTimeout(check,2500)}
  function move(){keyboard=false;show()}
  function down(event:PointerEvent){keyboard=false;dragging=!!(event.target as Element)?.closest?.(controls);show()}
  function up(){dragging=false;show()}
  function key(event:KeyboardEvent){if(event.key==='Tab'||event.key.startsWith('Arrow'))keyboard=true;show()}
  function focus(){dragging=false;keyboard=false;show()}
  node.classList.remove('controls-resting');if(!enabled)return
  show();window.addEventListener('pointermove',move,{passive:true});window.addEventListener('pointerdown',down,true)
  window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('keydown',key,true)
  window.addEventListener('focus',focus);window.addEventListener('resize',focus);document.addEventListener('visibilitychange',focus);node.addEventListener('pointerleave',move);node.addEventListener('focusin',show);node.addEventListener('focusout',show)
  return()=>{disposed=true;clearTimeout(timer);node.classList.remove('controls-resting');window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('keydown',key,true);window.removeEventListener('focus',focus);window.removeEventListener('resize',focus);document.removeEventListener('visibilitychange',focus);node.removeEventListener('pointerleave',move);node.removeEventListener('focusin',show);node.removeEventListener('focusout',show)}
 },[stage,enabled,playing,busy,suspended,trackId])
}

