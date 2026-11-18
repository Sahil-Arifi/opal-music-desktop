"""One-time, deterministic public-snapshot cleanup; standard library only."""
from pathlib import Path
import json, re, struct, zlib
root=Path(__file__).resolve().parents[1]
# Replace design-preview recordings with fictional records and original vector covers.
p=root/'src/renderer/prototype.ts'
s=p.read_text(encoding='utf-8')
names=['currents','red','blonde','igor','melodrama','weeknd']
titles=['First Light','Night Drive','Soft Focus','Afterglow','Open Sky','Quiet Hours']
albums=['Horizon','Midnight','Daydream','Spectrum','Cloudline','Stillness']
colors=[('#345f86','#b4d9c9'),('#603d67','#d18e80'),('#95784e','#d9cfa0'),('#416e6b','#90cdb0'),('#3c456e','#b29dce'),('#683c51','#c499aa')]
tracks=[dict(source='youtube',id=f'preview-track-{i+1}',title=titles[i],artist='Demo Artist',album=albums[i],artwork=f'/reference/{names[i]}.svg',duration=180+i*15) for i in range(6)]
s=re.sub(r'const tracks:Track\[\]=\[.*?\]\n//', 'const tracks:Track[]='+json.dumps(tracks,indent=2)+'\n//',s,count=1,flags=re.S)
p.write_text(s,encoding='utf-8')
ref=root/'public/reference';ref.mkdir(parents=True,exist_ok=True)
for i,name in enumerate(names):
 a,b=colors[i]
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="{a}"/><stop offset="1" stop-color="{b}"/></linearGradient></defs><rect width="640" height="640" fill="url(#g)"/><circle cx="{160+i*45}" cy="320" r="180" fill="none" stroke="white" stroke-opacity=".3" stroke-width="28"/><path d="M0 470 Q320 {120+i*25} 640 470" fill="none" stroke="white" stroke-opacity=".5" stroke-width="8"/></svg>'
 (ref/(name+'.svg')).write_text(svg,encoding='utf-8')
# Rewrite fixture paths everywhere, including tests, keeping URL behavior unchanged.
for p in root.rglob('*'):
 if p.is_file() and p.suffix in ('.cjs','.ts','.tsx','.md'):
  text=p.read_text(encoding='utf-8')
  for name in names:text=text.replace('/reference/'+name+'.jpg','/reference/'+name+'.svg')
  p.write_text(text,encoding='utf-8')
# Original equalizer icon, no service logo or copied artwork. PNG/ICNS via stdlib.
assets=root/'assets';assets.mkdir(exist_ok=True)
def png(size,tray=False):
 rows=[]
 for y in range(size):
  row=bytearray()
  for x in range(size):
   u,v=x/size,y/size
   inside=.10<u<.90 and .10<v<.90
   bar=any(abs(u-c)<.055 and abs(v-.5)<h for c,h in [(.30,.17),(.50,.28),(.70,.21)])
   color=(0,0,0,255) if tray and bar else (0,0,0,0) if tray else (220,243,248,255) if bar else (int(28+45*u),int(46+60*v),int(82+65*u),255) if inside else (0,0,0,0)
   row.extend(color)
  rows.append(b'\x00'+row)
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
for name in ['Music-source.png','Music-dock.png']:(assets/name).write_bytes(png(1024))
for size,name in [(18,'menuTemplate.png'),(36,'menuTemplate@2x.png')]:(assets/name).write_bytes(png(size,True))
parts=[]
for size,tag in [(128,b'ic07'),(256,b'ic08'),(512,b'ic09'),(1024,b'ic10')]:
 data=png(size);parts.append(tag+struct.pack('>I',len(data)+8)+data)
data=b''.join(parts);(assets/'Music.icns').write_bytes(b'icns'+struct.pack('>I',len(data)+8)+data)
print('Replaced fixture artwork, fictionalized preview, generated original icons.')
