from pathlib import Path
import re,json
root=Path(__file__).resolve().parents[1]
for name in ['src/main/index.cjs','scripts/package-mac.cjs']:
 p=root/name;s=p.read_text(encoding='utf-8').replace('YouTube Music','Opal Music Desktop').replace('YouTube-Music-mac-arm64.zip','Opal-Music-Desktop-mac-arm64.zip');p.write_text(s,encoding='utf-8')
for name in ['src/renderer/main.tsx','src/renderer/views.tsx']:
 p=root/name;s=p.read_text(encoding='utf-8').replace('<b>YouTube Music</b>','<b>Opal Music</b>').replace('<h1>YouTube Music</h1>','<h1>Opal Music</h1><p>Independent desktop client. Not affiliated with Google or YouTube.</p>');p.write_text(s,encoding='utf-8')
p=root/'src/renderer/ui.tsx';s=p.read_text(encoding='utf-8')
s=re.sub(r'(<svg width=\{size\} height=\{size\} viewBox="0 0 40 40" aria-hidden="true">).*?(</svg>)',r'\1<rect x="3" y="3" width="34" height="34" rx="9" fill="#344d70"/><path d="M12 15v10m8-17v24m8-20v16" stroke="#ddf4f8" strokeWidth="4" strokeLinecap="round"/>\2',s,count=1)
s=re.sub(r'export function Google\(\)\{.*?\}\n', 'export function Google(){return <span aria-hidden="true">G</span>}\n',s,count=1)
p.write_text(s,encoding='utf-8')
p=root/'package.json';d=json.loads(p.read_text());d['name']='opal-music-desktop';d['productName']='Opal Music Desktop';d['description']='Independent, unofficial desktop interface for YouTube Music';d['build']['productName']='Opal Music Desktop';d['build']['appId']='local.opal.music';p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'package-lock.json';d=json.loads(p.read_text());d['name']='opal-music-desktop';d['packages']['']['name']='opal-music-desktop';p.write_text(json.dumps(d,indent=2)+'\n')
p=root/'README.md';s=p.read_text(encoding='utf-8').replace('YouTube-Music-mac-arm64.zip','Opal-Music-Desktop-mac-arm64.zip').replace('YouTube Music.app','Opal Music Desktop.app');p.write_text(s,encoding='utf-8')
