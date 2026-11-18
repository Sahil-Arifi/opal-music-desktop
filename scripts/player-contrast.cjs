// Run after npm run build:ui. The fixture is injected into a temporary Chrome profile.
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require('playwright-core');
const {createServer} = require('../src/main/server.cjs');

function fixture() {
  const artwork = document.createElement('canvas');
  artwork.width = artwork.height = 32;
  const ctx = artwork.getContext('2d');
  ctx.fillStyle = new URLSearchParams(location.search).get('cover') || '#fff';
  ctx.fillRect(0, 0, 32, 32);
  const track = {id:'colour-test', source:'youtube', title:'Fixture track', artist:'Fixture artist', artwork:artwork.toDataURL(), duration:60};
  const state = {current:track, position:20, duration:60, playing:false, volume:.5, effects:'full', queue:[], library:[], loading:false, error:''};
  const home = {account:{configured:true, connected:true, name:'Fixture'}, recent:[track], recentItems:[], recentArtists:[], releases:[], discover:[], liked:[], playlists:[]};
  const subscribe = () => () => {};
  let notifyState=()=>{},notifyMode=()=>{},volumeBeforeMute=state.volume;
  const lyrics=Array.from({length:14},(_,n)=>({time:n*4,text:'Fixture line '+n}));
  lyrics[1].text='(Solo voice)';
  lyrics[2].backing=[{text:'Backing voice',start:9,end:11}];
  lyrics[3].text='';lyrics[4].text='[Instrumental]';
  window.testCatalog=[];
  const totals={plays:1,songs:1,albums:1,artists:1,seconds:30};
  window.music = {
    getState:async () => state, getHome:async () => home, getMode:async () => 'full',
    onState:fn=>{notifyState=fn;return ()=>{};}, onHome:subscribe, onMode:fn=>{notifyMode=fn;return ()=>{};}, onEnergy:subscribe, onEngine:subscribe,
    discovery:async () => [], recentSearches:async () => [], setVideoBounds:async () => {}, setPlaybackMode:async () => {},
    setMode:async mode=>notifyMode(mode),
    command:async (name,value)=>{
      if(name==='volume')state.volume=value;
      if(name==='mute'){if(state.volume){volumeBeforeMute=state.volume;state.volume=0;}else state.volume=volumeBeforeMute;}
      if(name==='seek')state.position=value;
      notifyState({...state});
    },
    lyrics:async()=>({synced:true,source:'Fixture',lines:lyrics}),
    stats:async period=>({period,totals,artists:[{id:'UCABCDEFGHIJKLMNOPQRSTUV',name:'Fixture artist',plays:1,seconds:30}],
      albums:[{id:'["fixture album","fixture artist"]',name:'Fixture album',artist:'Fixture artist',plays:1,seconds:30}],
      songs:[{...track,plays:1,seconds:30}],coverage:{scope:'Fixture history.',untimedPlays:0}}),
    catalog:async(kind,ref)=>{
      window.testCatalog.push({kind,...ref});
      return {kind,id:ref.id||ref.title,title:ref.title,tracks:[],albums:[],singles:[],artists:[],playlists:[]};
    },
  };
}

// Read both the rendered glyph pixels and nearby backdrop. Token contrast alone
// cannot reveal pale artwork escaping the isolated blend layer.
async function measureBackground(imageURL) {
  const bitmap = new Image();
  bitmap.src = imageURL;
  await bitmap.decode();
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  function luminance(rgb) {
    const linear = rgb.map(value => {
      const srgb = value/255;
      return srgb <= .04045 ? srgb/12.92 : ((srgb+.055)/1.055)**2.4;
    });
    return linear[0]*.2126 + linear[1]*.7152 + linear[2]*.0722;
  }
  const ratios = ['.player-info h1', '.lyric-line.current', '.lyric-line.current + .lyric-line'].map(selector => {
    const el = document.querySelector(selector);
    const bounds = el.getBoundingClientRect();
    const x = Math.round(bounds.left + 1), y = Math.round(bounds.top - 2);
    const base = [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
    const components = getComputedStyle(el).color.match(/[\d.]+/g).map(Number);
    const opacity = components[3] ?? 1;
    const ink = base.map((c,i) => c*(1-opacity) + components[i]*opacity);
    return (luminance(ink)+.05)/(luminance(base)+.05);
  });
  const box = document.querySelector('.lyric-line.current .lyric-ink').getBoundingClientRect();
  const pixels = ctx.getImageData(Math.floor(box.left),Math.floor(box.top),Math.ceil(box.width),Math.ceil(box.height)).data;
  let brightInk = 0;
  for(let i=0;i<pixels.length;i+=4)if(Math.min(pixels[i],pixels[i+1],pixels[i+2]) >= 247)brightInk++;
  return {ratios, brightInk, ink:getComputedStyle(document.querySelector('.lyric-line.current .lyric-ink')).color};

}

async function verifyControls(page,origin){
  async function volume(scope,value){
    const container=page.locator(scope);
    const input=container.locator('input[aria-label=Volume]');
    await container.getByRole('button',{name:value?'Mute':'Unmute',exact:true}).waitFor();
    assert.equal(Number(await input.inputValue()),value);
    assert.equal(await container.locator('.volume-toggle svg').count(),1);
  }
  for(const [width,height] of [[1220,820],[800,590]]){
    await page.setViewportSize({width,height});await page.goto(origin);
    const dock=page.locator('.dock-right');await volume('.dock-right',.5);
    await dock.getByRole('button',{name:'Mute',exact:true}).click();await volume('.dock-right',0);
    await page.getByRole('button',{name:'Open now playing',exact:true}).click();
    await volume('.player-volume',0);await page.locator('.player-volume').getByRole('button',{name:'Unmute'}).click();
    await volume('.player-volume',.5);
    await page.getByRole('button',{name:'Show lyrics',exact:true}).click();
    const lines=page.locator('.lyrics-lines');await lines.waitFor();
    assert.equal(await lines.locator('.lyric-backing').count(),1);
    assert.equal(await lines.locator('.lyric-break').count(),2);
    assert.equal(await lines.locator('[data-cue="1"] .lyric-ink').innerText(),'(Solo voice)');
    const backing=lines.getByText('Backing voice',{exact:true});
    await page.evaluate(()=>window.music.command('seek',10));await page.waitForFunction(()=>document.querySelector('.lyric-backing')?.dataset.active==='true');
    const sizes=await backing.evaluate(el=>[parseFloat(getComputedStyle(el).fontSize),parseFloat(getComputedStyle(el.closest('button')).fontSize)]);
    assert(sizes[0]<sizes[1]);assert.equal(await backing.isVisible(),true);
    await lines.locator('[data-cue="3"]').click();await page.waitForFunction(()=>document.querySelector('[data-cue="3"].current .lyric-break'));
    assert.equal(await backing.getAttribute('data-active'),'false');
    await page.getByRole('button',{name:'Collapse player'}).click();
    await page.evaluate(()=>window.music.setMode('mini'));await page.setViewportSize({width:360,height:450});
    await volume('.mini-volume',.5);await page.locator('.mini-volume').getByRole('button',{name:'Mute',exact:true}).click();
    await volume('.mini-volume',0);await page.locator('.mini-volume').getByRole('button',{name:'Unmute'}).click();
    await volume('.mini-volume',.5);
    await page.setViewportSize({width,height});await page.evaluate(()=>window.music.setMode('full'));
    for(const kind of ['artist','album']){
      await page.getByRole('button',{name:'Stats',exact:true}).click();
      await page.getByRole('button',{name:'Open '+kind+' Fixture '+kind,exact:true}).click();
      const selected=await page.waitForFunction(kind=>window.testCatalog.find(item=>item.kind===kind),kind);
      const ref=await selected.jsonValue();
      assert.equal(ref.title,'Fixture '+kind);
      if(kind==='artist')assert.equal(ref.id,'UCABCDEFGHIJKLMNOPQRSTUV');
      else {assert.equal(ref.id,undefined);assert.equal(ref.artist,'Fixture artist');}
    }
  }
  console.log('Verified mute restoration, artist and album navigation, backing vocals and source-marked breaks at both sizes.');
}
async function main() {
  const server = await createServer({rendererDir:process.env.MUSIC_RENDERER_DIST || path.resolve(__dirname, '../dist/renderer')});
  let browser;
  try {
    browser = await chromium.launch({channel:'chrome', headless:true, args:['--enable-unsafe-swiftshader']});
    const page = await browser.newPage({deviceScaleFactor:1});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(fixture);
    for (const cover of ['#ffffff','#88fa3c','#9334f3']) {
      await page.goto(server.origin+'/?cover='+encodeURIComponent(cover));
      await page.getByRole('button',{name:'Open now playing',exact:true}).click();
      await page.getByRole('button',{name:'Show lyrics',exact:true}).click();
      await page.locator('.lyric-line.current').waitFor();
      for (const [width,height] of [[1220,820],[800,590]]) {
        await page.setViewportSize({width,height});
        await page.waitForFunction(() => {
          const host = document.querySelector('.lyrics-scroll').getBoundingClientRect();
          const cue = document.querySelector('.lyric-line.current').getBoundingClientRect();
          return Math.abs(host.y+host.height/2-cue.y-cue.height/2) < 3;
        });
        const volume = await page.locator('.player-volume').boundingBox();
        const sleeve = await page.locator('.player-sleeve').boundingBox();
        assert(Math.abs(volume.width-sleeve.width) < 1.1, 'Volume should span the sleeve');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.lyric-line.current .lyric-ink')).color === 'rgb(255, 255, 255)');
        const screenshot = await page.screenshot();
        const {ratios,brightInk,ink} = await page.evaluate(measureBackground,'data:image/png;base64,'+screenshot.toString('base64'));
        assert(ratios.every(ratio => ratio >= 4.5), cover+' at '+width+': '+ratios.join(', '));
        assert.equal(ink,'rgb(255, 255, 255)');
        assert(brightInk>30,'Foreground glyphs should contain actual white pixels');
        console.log(cover, width, ratios.map(ratio => ratio.toFixed(1)+':1').join(' / '), brightInk+' bright glyph pixels');
      }
    }
    await verifyControls(page,server.origin);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

