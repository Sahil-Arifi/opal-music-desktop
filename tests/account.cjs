const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const {Account,desktopClient,authorize}=require('../src/main/account.cjs');
const {YouTubeAPI}=require('../src/main/youtube-api.cjs');

test('desktop OAuth validates loopback state and binds code challenge to verifier',async()=>{
  let challenge, redirect;
  const value=await authorize({client_id:'test.apps.googleusercontent.com'},async url=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://accounts.google.com');
    challenge=u.searchParams.get('code_challenge');
    redirect=u.searchParams.get('redirect_uri');
    const cb=new URL(redirect);
    assert.equal(cb.hostname,'127.0.0.1');
    cb.searchParams.set('code','test-code');
    cb.searchParams.set('state','unrelated');
    assert.equal((await fetch(cb)).status,403);
    cb.searchParams.set('state',u.searchParams.get('state'));
    assert.equal((await fetch(cb)).status,200);
  });
  assert.equal(value.code,'test-code');
  assert.equal(value.redirect,redirect);
  assert.equal(crypto.createHash('sha256').update(value.verifier).digest('base64url'),challenge);
});
test('canceled OAuth does not exchange a code',async()=>{
  await assert.rejects(authorize({client_id:'test.apps.googleusercontent.com'},async url=>{
    const u=new URL(url),cb=new URL(u.searchParams.get('redirect_uri'));
    cb.search=new URLSearchParams({state:u.searchParams.get('state'),error:'access_denied'});
    assert.equal((await fetch(cb)).status,200);
  }),/cancel/);
  assert.throws(()=>desktopClient({web:{client_id:'123.apps.googleusercontent.com'}}),/Desktop/);
});
test('Google data API paginates owned playlists and resolves playlist video order and ISO durations',async()=>{
  const first='a2345678901',second='b2345678902';
  const api=new YouTubeAPI(async url=>{
    const p=url.searchParams;
    if(url.pathname.endsWith('/playlists')) {
      assert.equal(p.get('mine'),'true');
      return Response.json({items:[{id:p.has('pageToken')?'B':'A',snippet:{title:'List'},contentDetails:{itemCount:2}}],nextPageToken:p.has('pageToken')?undefined:'second-page'});
    }
    if(url.pathname.endsWith('/playlistItems'))return Response.json({items:[second,first,second].map(videoId=>({contentDetails:{videoId}}))});
    assert.equal(url.pathname,'/youtube/v3/videos');
    return Response.json({items:[first,second].map(id=>({id,snippet:{title:id,channelTitle:'artist'},contentDetails:{duration:'PT1H1M2S'}}))});
  });
  assert.deepEqual((await api.playlists()).map(p=>p.id),['A','B']);
  const tracks=await api.playlist('PL123');
  assert.deepEqual(tracks.map(t=>t.id),[second,first,second]);
  assert.ok(tracks.every(t=>t.duration===3662));
});
test('a desktop account signs in, refreshes once concurrently, rates, persists encrypted state and disconnects',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prism-account-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const key=crypto.randomBytes(32);
  const storage={isEncryptionAvailable:()=>true,
    encryptString: str=>{const iv=crypto.randomBytes(16),c=crypto.createCipheriv('aes-256-ctr',key,iv);return Buffer.concat([iv,c.update(str),c.final()]);},
    decryptString: buf=>{const c=crypto.createDecipheriv('aes-256-ctr',key,buf.subarray(0,16));return Buffer.concat([c.update(buf.subarray(16)),c.final()]).toString();}
  };
  let refreshes=0,rated=0,revoke=0;
  const id='abcdEFGHI01',scope='https://www.googleapis.com/auth/youtube.force-ssl';
  const record={id,snippet:{title:'Song',channelTitle:'Artist'},contentDetails:{duration:'PT3M'}};
  const fake=async(input,opts)=>{
    const u=new URL(input);
    if(u.pathname==='/token'){
      if(opts.body.get('grant_type')==='refresh_token'){refreshes++;return Response.json({access_token:'updated-secret',expires_in:3600});}
      assert.equal(opts.body.get('client_secret'),'secret-value');
      return Response.json({access_token:'test-token',refresh_token:'refresh-value',expires_in:5,scope});
    }
    if(u.pathname.endsWith('/userinfo'))return Response.json({sub:'abc',name:'Test user',email:'test@example.test'});
    if(u.pathname.endsWith('/revoke')){revoke++;return new Response(null,{status:200});}
    assert.equal(opts.headers.Authorization,'Bearer updated-secret');
    if(u.pathname.endsWith('/videos/rate')){rated++;assert.equal(opts.method,'POST');return new Response(null,{status:204});}
    return Response.json({items:u.pathname.endsWith('/videos')?[record]:[]});
  };
  const account=new Account({dir,storage,fetchImpl:fake,openBrowser:async raw=>{
    const u=new URL(raw);const cb=new URL(u.searchParams.get('redirect_uri'));
    cb.search=new URLSearchParams({state:u.searchParams.get('state'),code:'code'});
    await fetch(cb);
  }});
  await assert.rejects(account.signIn(),/Import/);
  account.configure({installed:{client_id:'sample.apps.googleusercontent.com',client_secret:'secret-value'}});
  assert.equal((await account.signIn()).connected,true);
  assert.equal((await account.sync()).liked[0].id,id);
  assert.equal(refreshes,1);
  await account.rate(id,'none');
  assert.equal(rated,1);assert.deepEqual(account.snapshot().liked,[]);
  assert.equal(fs.readFileSync(account.file).includes(Buffer.from('secret-value')),false);
  const restored=new Account({dir,storage,fetchImpl:fake});
  assert.equal(restored.status().name,'Test user');
  assert.equal((await restored.signOut()).connected,false);
  assert.equal(revoke,1);assert.equal(restored.status().configured,true);
  assert.equal(restored.snapshot().syncedAt,null);
});
test('pasted YouTube links directly request video details; arbitrary URLs never hit search',async()=>{
  const urls=[];
  const api=new YouTubeAPI(async url=>{
    urls.push(url);
    return Response.json({items:[{id:'7nxWP9BhI7w',snippet:{title:'Roads',channelTitle:'Portishead'}}]});
  });
  for(const url of ['https://music.youtube.com/watch?v=7nxWP9BhI7w&list=RD123','youtu.be/7nxWP9BhI7w?t=4','https://www.youtube.com/shorts/7nxWP9BhI7w']){
    assert.equal((await api.search(url))[0].title,'Roads');
  }
  await assert.rejects(api.search('https://music.youtube.com.evil.test/watch?v=7nxWP9BhI7w'),/Paste a YouTube/);
  assert.ok(urls.length===3 && urls.every(u=>u.pathname==='/youtube/v3/videos' && u.searchParams.get('id')==='7nxWP9BhI7w'));
});

function raceAccount(t,fetchImpl,expiresAt) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'music-account-race-'));
  t.after(()=>fs.rmSync(dir,{force:true,recursive:true}));
  const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const account=new Account({dir,storage,fetchImpl});
  account.configure({installed:{client_id:'test.apps.googleusercontent.com'}});
  const session={access_token:'old-access',refresh_token:'old-refresh',expiresAt,
    scope:'https://www.googleapis.com/auth/youtube.force-ssl'};
  account.persist({...account.state,session,profile:{id:'A',name:'A'}});
  return account;
}
test('disconnect during a shared token refresh cannot restore auth or send a data request',async t=>{
  const started=Promise.withResolvers(), complete=Promise.withResolvers();
  let requests=0;
  const account=raceAccount(t,async url=>{
    if(String(url).endsWith('/token')){started.resolve();return complete.promise;}
    if(String(url).endsWith('/revoke'))return new Response(null,{status:200});
    requests++;return Response.json({items:[]});
  },0);
  const pending=account.sync();
  await started.promise;
  await account.signOut();
  complete.resolve(Response.json({access_token:'wrong-token',expires_in:3600}));
  await assert.rejects(pending,/account changed/);
  assert.equal(account.status().connected,false);assert.equal(account.status().syncing,false);
  assert.equal(account.snapshot().syncedAt,null);assert.equal(requests,0);
  assert.equal(JSON.parse(fs.readFileSync(account.file)).session,null);
});
test('an interrupted paginated read and a queued user rating cannot execute on a replacement account',async t=>{
  const started=Promise.withResolvers(), complete=Promise.withResolvers();
  let secondPage=0,writes=0;
  const account=raceAccount(t,async (url,opts)=>{
    const u=new URL(url);
    if(u.pathname.endsWith('/revoke'))return new Response(null,{status:200});
    if(opts.method==='POST')writes++;
    if(u.searchParams.has('pageToken'))secondPage++;
    if(u.pathname.endsWith('/playlists'))return {ok:true,status:200,json:async()=>{started.resolve();return complete.promise;}};
    return Response.json({items:[]});
  },Date.now()+3_600_000);
  const sync=account.sync(), rating=account.rate('7nxWP9BhI7w','dislike');
  const stale=Promise.allSettled([sync,rating]);
  await started.promise;
  await account.signOut();
  account.persist({...account.state,session:{access_token:'new-account',expiresAt:Date.now()+3_600_000},profile:{id:'B'}});
  complete.resolve({items:[],nextPageToken:'page-two'});
  assert.ok((await stale).every(result=>result.status==='rejected'));
  assert.equal(writes,0);assert.equal(secondPage,0);
  assert.deepEqual(account.snapshot().liked,[]);assert.equal(account.snapshot().syncedAt,null);
});
test('YouTube getRating preserves a dislike, distinguishes missing results and never writes a guessed rating',async t=>{
  const id='7nxWP9BhI7w';let rating='dislike';
  const account=raceAccount(t,async (url,opts)=>{
    assert.equal(url.pathname,'/youtube/v3/videos/getRating');
    assert.equal(url.searchParams.get('id'),id);
    assert.equal(opts.method,'GET');
    return Response.json({items:rating?[{videoId:id,rating}]:[]});
  },Date.now()+3_600_000);
  assert.equal(await account.getRating(id),'dislike');
  rating='none';assert.equal(await account.getRating(id),'none');
  rating='unspecified';await assert.rejects(account.getRating(id),/could not confirm/);
  rating='';await assert.rejects(account.getRating(id),/could not confirm/);
  await assert.rejects(account.getRating('bad'),/Invalid/);
});

