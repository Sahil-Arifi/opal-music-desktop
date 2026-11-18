const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const {YouTubeAPI, videoId} = require('./youtube-api.cjs');

const READ = 'https://www.googleapis.com/auth/youtube.readonly';
const WRITE = 'https://www.googleapis.com/auth/youtube.force-ssl';
const SCOPES = ['openid','email','profile',READ,WRITE];
const emptySnapshot = () => ({liked:[],playlists:[],subscriptions:[],syncedAt:null});
const DAY = 86_400_000;

function desktopClient(json) {
  let data = json;
  if (typeof json === 'string' || Buffer.isBuffer(json)) {
    try { data = JSON.parse(String(json)); } catch { throw Error('Choose the JSON credentials downloaded for a Google Desktop app.'); }
  }
  const c = data?.installed;
  if (!c || typeof c.client_id !== 'string' || !/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(c.client_id)) {
    throw Error('Choose OAuth credentials with application type Desktop app.');
  }
  if (c.client_secret != null && typeof c.client_secret !== 'string') throw Error('Invalid OAuth client credentials.');
  return {client_id:c.client_id, client_secret:c.client_secret || ''};
}

// Return only the authorization code to the caller. Never put a token, error description, or identity in an HTML response.
async function authorize(client, openBrowser, signal) {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('base64url');
  const server = http.createServer();
  let accept, reject;
  const result = new Promise((yes,no)=>{accept=yes;reject=no;});
  result.catch(()=>{});
  server.on('error', reject);
  const cancel = () => reject(Error('Google sign-in was canceled.'));
  signal?.addEventListener('abort', cancel, {once:true});
  const timer = setTimeout(()=>reject(Error('Google sign-in timed out. Connect again to retry.')), 5*60*1000);
  try {
    await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
    if (signal?.aborted) throw Error('Google sign-in was canceled.');
    const host = '127.0.0.1:' + server.address().port;
    const redirect = 'http://' + host + '/oauth/callback';
    let consumed = false;
    server.on('request',(req,res)=>{
      let url;
      try {url = new URL(req.url, redirect);} catch {res.writeHead(400).end();return;}
      res.setHeader('Content-Type','text/plain; charset=utf-8');
      res.setHeader('Cache-Control','no-store');
      res.setHeader('Referrer-Policy','no-referrer');
      res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
      if (req.headers.host !== host || url.pathname !== '/oauth/callback' || req.method !== 'GET') {res.writeHead(404).end();return;}
      if (consumed || url.searchParams.get('state') !== state) {res.writeHead(403).end('This sign-in link is invalid.');return;}
      consumed = true;
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error')) {
        res.end('Sign-in canceled. You can close this tab.');
        reject(Error('Google sign-in was canceled.'));return;
      }
      res.end('Google returned your authorization. You can close this tab and return to YouTube Music.');
      accept({code, verifier, redirect});
    });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:SCOPES.join(' '),
      code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent',state});
    await openBrowser(url.href);
    return await result;
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',cancel);
    server.close();server.closeAllConnections();
  }
}

class Account {
  constructor({dir,onChange=()=>{},fetchImpl=globalThis.fetch,storage,openBrowser}) {
    this.file=path.join(dir,'youtube-account.bin');this.onChange=onChange;this.fetch=fetchImpl;
    this.storage=storage || require('electron').safeStorage;
    this.openBrowser=openBrowser || (url=>require('electron').shell.openExternal(url));
    this.state={client:null,session:null,profile:null,snapshot:emptySnapshot()};
    this.version=0;this.message='';
    if (fs.existsSync(this.file)) {
      try {const data=JSON.parse(this.storage.decryptString(fs.readFileSync(this.file)));Object.assign(this.state,data);}
      catch {this.message='The saved account could not be unlocked. Import desktop credentials to reconnect.';}
      const stamp=Date.parse(this.state.snapshot?.syncedAt);
      if (!stamp || stamp<Date.now()-30*DAY) this.state.snapshot=emptySnapshot();
    }
    this.changeTail=Promise.resolve();
  }
  persist(next) {
    if (!this.storage.isEncryptionAvailable()) throw Error('macOS Keychain is unavailable. Unlock your keychain and try again.');
    const body=this.storage.encryptString(JSON.stringify(next));
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file+'.tmp',body,{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);
    this.state=next;
  }
  status() {
    const {client,session,profile,snapshot}=this.state;
    return {connected:!!session,configured:!!client,name:profile?.name||'',email:profile?.email||'',
      message:this.message,syncing:!!this.syncTask,signingIn:!!this.authorization,syncedAt:snapshot?.syncedAt||null};
  }
  notify(){this.onChange(this.status());}
  snapshot(){return this.state.snapshot || emptySnapshot();}
  active(version) {if (this.version !== version) throw Error('The connected account changed. Try again.');}
  // An account boundary applies to every page of a request, including a new
  // request issued after awaiting JSON from the previous page.
  async read(fn, ver=this.version) {
    this.active(ver);
    const api=new YouTubeAPI((url,opts)=>this.authorizedFetch(url,opts,ver));
    const result=await fn(api);
    this.active(ver);
    return result;
  }
  change(fn) {
    const ver=this.version;
    const operation=this.changeTail.then(()=>{this.active(ver);return fn(ver);});
    this.changeTail=operation.catch(()=>{});
    return operation;
  }
  configure(json) {
    const client=desktopClient(json);
    if (this.state.session && this.state.client?.client_id !== client.client_id) throw Error('Disconnect this account before changing desktop credentials.');
    this.persist({...this.state,client});this.version++;this.authorization?.abort();this.message='';this.notify();
    return this.status();
  }
  async tokenRequest(fields) {
    const res=await this.fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams(fields),signal:AbortSignal.timeout(18000)});
    const data=await res.json();
    if (!res.ok || !data.access_token) {
      const error=Error(data.error==='invalid_grant'?'Google authorization expired. Connect your account again.':'Google could not authorize these desktop credentials.');
      error.code=data.error;throw error;
    }
    return {...data,expiresAt:Date.now()+Math.max(0,Number(data.expires_in)||0)*1000};
  }
  async signIn() {
    const {client}=this.state;
    if (!client) throw Error('Import a Google Desktop OAuth client JSON file first.');
    if (this.state.session) return this.status();
    if (this.signInTask) {await this.signInTask;return this.status();}
    if (this.revocation) {await this.revocation;return this.signIn();}
    const ver=this.version, ctrl=new AbortController();
    this.authorization=ctrl;this.message='';this.notify();
    this.signInTask=(async()=>{
      const {code,verifier,redirect}=await authorize(client,this.openBrowser,ctrl.signal);
      this.active(ver);
      const fields={client_id:client.client_id,code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'};
      if (client.client_secret) fields.client_secret=client.client_secret;
      const session=await this.tokenRequest(fields);
      const granted=new Set(String(session.scope||'').split(' '));
      if (!granted.has(WRITE) && !granted.has(READ)) throw Error('Google did not grant YouTube account access. Connect again and allow YouTube access.');
      const response=await this.fetch('https://openidconnect.googleapis.com/v1/userinfo',{
        headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(18000)
      });
      if (!response.ok) throw Error('Unable to identify the signed-in Google account.');
      const {sub,name,email}=await response.json();
      if (!sub) throw Error('Unable to identify the signed-in Google account.');
      this.active(ver);
      this.persist({...this.state,session,profile:{id:sub,name:name||email||'Google account',email:email||''},snapshot:emptySnapshot()});
    })().catch(error=>{if(ver===this.version)this.message=error.message;throw error;}).finally(()=>{
      if(this.authorization===ctrl){this.authorization=null;this.signInTask=null;this.notify();}
    });
    await this.signInTask;return this.status();
  }
  async signOut() {
    const token=this.state.session?.refresh_token || this.state.session?.access_token;
    this.changeTail=Promise.resolve();
    this.version++; this.authorization?.abort(); this.authorization=null;this.signInTask=null;this.refreshTask=null;this.syncTask=null;this.message='';
    const next={...this.state,session:null,profile:null,snapshot:emptySnapshot()};
    try { this.persist(next); }
    catch {
      fs.rmSync(this.file,{force:true});
      this.state={...next,client:null};
    }
    this.notify();
    if(token) {
      const revocation=this.fetch('https://oauth2.googleapis.com/revoke',{method:'POST',body:new URLSearchParams({token}),signal:AbortSignal.timeout(8000)})
        .then(res=>{if (!res.ok && res.status!==400) throw Error();})
        .catch(()=>{this.message='Disconnected on this Mac. To revoke access at Google, visit your Google Account connections.';this.notify();});
      this.revocation=revocation;
      try {await revocation;} finally {if(this.revocation===revocation)this.revocation=null;}
    }
    return this.status();
  }
  async accessToken(force=false) {
    const {session,client}=this.state;
    if (!session) throw Error('Connect your Google account to use YouTube.');
    if (!force && session.expiresAt>Date.now()+60000) return session.access_token;
    if (!session.refresh_token) {
      this.version++;
      this.persist({...this.state,session:null,profile:null,snapshot:emptySnapshot()});
      this.message='The Google authorization expired. Connect your account again.';
      this.notify();
      throw Error(this.message);
    }
    if (this.refreshTask) return this.refreshTask;
    const ver=this.version;
    const task=(async()=>{
      const fields={client_id:client.client_id,grant_type:'refresh_token',refresh_token:session.refresh_token};
      if (client.client_secret) fields.client_secret=client.client_secret;
      let fresh;
      try {fresh=await this.tokenRequest(fields);}
      catch(error){if(error.code==='invalid_grant' && ver===this.version){
        this.version++;this.persist({...this.state,session:null,profile:null,snapshot:emptySnapshot()});this.message=error.message;this.notify();
      }throw error;}
      this.active(ver);
      this.persist({...this.state,session:{...session,...fresh}});return fresh.access_token;
    })();
    this.refreshTask=task;
    try{return await task;}finally{if(this.refreshTask===task)this.refreshTask=null;}
  }
  async authorizedFetch(url,opts,ver) {
    this.active(ver);
    const send=async token=>{
      this.active(ver);
      return this.fetch(url,{...opts,headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
    };
    let response=await send(await this.accessToken());
    if(response.status===401) {this.active(ver);response=await send(await this.accessToken(true));}
    this.active(ver);return response;
  }
  sync() {
    if (!this.state.session) return Promise.reject(Error('Connect your Google account to sync YouTube.'));
    if (this.syncTask) return this.syncTask;
    const ver=this.version;
    const task=this.change(async epoch=>{
        const [liked,playlists,subscriptions]=await this.read(api=>Promise.all([api.liked(),api.playlists(),api.subscriptions()]),epoch);
        this.active(ver);
        const snapshot={liked,playlists,subscriptions,syncedAt:new Date().toISOString()};
        this.persist({...this.state,snapshot});this.message='';return snapshot;
      }).catch(error=>{if(ver===this.version)this.message=error.message;throw error;})
      .finally(()=>{if(this.syncTask===task){this.syncTask=null;this.notify();}});
    this.syncTask=task;this.notify();return task;
  }
  async latestUploads(ids) {
    const ver=this.version;
    const selected=ids?new Set(ids):null;
    const artists=this.snapshot().subscriptions.filter(a=>a.uploadsPlaylistId && (!selected || selected.has(a.id)));
    const tracks=[];
    for(let i=0;i<artists.length;i+=4) {
      const pages=await Promise.all(artists.slice(i,i+4).map(a=>this.read(api=>api.playlist(a.uploadsPlaylistId,5),ver)));
      tracks.push(...pages.flat());
    }
    return [...new Map(tracks.map(t=>[t.id,t])).values()].sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  }
  playlist(id){return this.read(api=>api.playlist(id));}
  search(query){return this.read(api=>api.search(query));}
  async track(id){if(!videoId(id)) throw Error('Invalid YouTube video ID.');return (await this.read(api=>api.tracks([id])))[0] || null;}
  getRating(id){return this.read(api=>api.getRating(id));}
  rate(id,rating) {
    return this.change(async ver=>{
      if(!String(this.state.session?.scope||'').split(' ').includes(WRITE)) throw Error('To rate videos, disconnect and reconnect with YouTube rating permission.');
      // Obtain the track before sending a write so metadata failure cannot leave a half-applied UI action.
      const original=this.snapshot().liked.find(t=>t.id===id);
      const track=rating==='like'?(original || await this.track(id)):null;
      if (rating==='like' && !track) throw Error('This video is unavailable.');
      await this.read(api=>api.rate(id,rating),ver);
      this.active(ver);
      const snapshot=this.snapshot(), liked=snapshot.liked.filter(t=>t.id!==id);
      if(track) liked.unshift(track);
      this.persist({...this.state,snapshot:{...snapshot,liked:liked.slice(0,1000)}});this.notify();
    });
  }
  close(){this.authorization?.abort();}
}
module.exports={Account,desktopClient,authorize};

