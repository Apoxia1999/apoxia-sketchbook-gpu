"""Real-data GPU regression and frame benchmark; run with local ChromeDriver :9515."""
import argparse,json,time,urllib.request,urllib.error
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://localhost:4180');args=parser.parse_args()
base='http://localhost:9515'
def request(method,path,data=None):
 r=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=60) as f:return json.load(f)['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
s=request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1440,1000','--enable-webgl','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--disable-frame-rate-limit']},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId']
def command(path,data=None):return request('POST','/session/'+s+path,data or {})
def js(script):return command('/execute/sync',{'script':script,'args':[]})
try:
 command('/url',{'url':args.url})
 for _ in range(120):
  if js('return window.__sketchGPU&&items.size>0'):break
  time.sleep(.25)
 js('setMode("move",false);fitAll()')
 for n in range(600):
  state=js('return {items:items.size,ready:photoGPU.low.entries.size+ownedPhotoGPU.low.entries.size,stats:__sketchGPU.stats()}')
  if n%40==0:print('WARM',state,flush=True)
  if state['ready']>=state['items'] and not state['stats']['public']['pending']:break
  time.sleep(.25)
 assert state['ready']==state['items'],state
 report={'files':state['items'],'mode':'headless hardware WebGL; browser frame cap disabled'}
 script='''const done=arguments[0];let times=[],cpu=[],last=performance.now(),n=0;function step(t){times.push(t-last);last=t;const start=performance.now();camera.x+=n%2?2:-2;renderCamera();cpu.push(performance.now()-start);if(++n<300)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);done({medianMs:times[150],p95Ms:times[285],cpuMedianMs:cpu[150],cpuP95Ms:cpu[285],stats:__sketchGPU.stats(),overviewCache:!!photoGPU.overviewCache});}}requestAnimationFrame(step);'''
 report['overview']=command('/execute/async',{'script':script,'args':[]});print('OVERVIEW',report['overview'],flush=True)
 # The former implementation rebuilt geometry on every camera frame.
 report['beforeRetainedGeometry']=js('const retained=photoGPU.renderOverview;photoGPU.renderOverview=()=>false;let costs=[];for(let i=0;i<100;i++){let t=performance.now();camera.x+=i%2?2:-2;renderCamera();costs.push(performance.now()-t);}photoGPU.renderOverview=retained;costs.sort((a,b)=>a-b);return {cpuMedianMs:costs[50],cpuP95Ms:costs[95]}');print('BEFORE',report['beforeRetainedGeometry'],flush=True)
 # A moved image must invalidate static geometry and update hit testing.
 report['sceneInvalidation']=js('const a=[...items.values()].find(a=>a.type==="image"),old=a.x;a.x+=17;updateCard(a);renderCamera();const model=photoGPU.models.get(a.id)||ownedPhotoGPU.models.get(a.id);const good=model.x===a.x;a.x=old;updateCard(a);renderCamera();return good');assert report['sceneInvalidation']
 js('const a=[...items.values()].find(a=>a.type==="image");camera.scale=a.originalWidth/a.displayWidth;camera.x=250-a.x*camera.scale;camera.y=180-a.y*camera.scale;renderCamera()')
 for _ in range(80):
  if js('return photoGPU.native.entries.size>0&&!photoGPU.pending.size'):break
  time.sleep(.1)
 report['native']=command('/execute/async',{'script':script,'args':[]});print('NATIVE',report['native'],flush=True);assert report['native']['stats']['public']['originalTiles']>0
 report['gpu']=js('const gl=photoGPU.gl,e=gl.getExtension("WEBGL_debug_renderer_info");return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)')
 report['errors']=[a for a in command('/log',{'type':'browser'}) if a['level']=='SEVERE'];assert not report['errors'],report['errors']
 Path('verification/performance-regression-report.json').write_text(json.dumps(report,indent=2));print('PASS',report['gpu'],flush=True)
finally:request('DELETE','/session/'+s)
