export type Rating='none'|'like'|'dislike'
type Entry<T>={track:T;confirmed:Rating;desired:Rating;task?:Promise<void>}
// Coalesce clicks while an account write is in flight. Source confirmation is
// separate from the immediate visual state; the latest intent wins.
export class RatingState<T>{
 private rows=new Map<string,Entry<T>>()
 private closed=false
 private send:(track:T,value:Rating)=>Promise<unknown>
 private changed:()=>void
 constructor(send:(track:T,value:Rating)=>Promise<unknown>,changed:()=>void){this.send=send;this.changed=changed}
 value(key:string,base:Rating):Rating{
  const row=this.rows.get(key)
  if(!row)return base
  if(!row.task&&row.confirmed===base){this.rows.delete(key);return base}
  return row.desired
 }
 pending(key:string){return !!this.rows.get(key)?.task}
 set(key:string,track:T,value:Rating,base:Rating):Promise<void>{
  if(this.closed)return Promise.resolve()
  let row=this.rows.get(key)
  if(!row){row={track,confirmed:base,desired:value};this.rows.set(key,row)}
  row.desired=value;row.track=track
  if(row.task){this.changed();return row.task}
  const entry=row
  entry.task=Promise.resolve().then(async()=>{
   while(!this.closed&&entry.confirmed!==entry.desired){
    const intent=entry.desired
    try{await this.send(entry.track,intent);if(this.closed)return;entry.confirmed=intent}
    catch(error){if(this.closed)return;if(entry.desired!==intent)continue;entry.desired=entry.confirmed;throw error}
   }
  }).finally(()=>{entry.task=undefined;if(!this.closed)this.changed()})
  this.changed();return entry.task
 }
 close(){this.closed=true;this.rows.clear()}
}

