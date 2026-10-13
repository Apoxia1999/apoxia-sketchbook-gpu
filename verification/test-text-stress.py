"""1000 persisted notes plus real photographs; same scenarios before and after fixes."""
import argparse,atexit,json,time,urllib.request,urllib.error
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://localhost:4186');parser.add_argument('--report',default='verification/text-baseline-report.json');parser.add_argument('--session');parser.add_argument('--headless',action='store_true');parser.add_argument('--uncapped',action='store_true');parser.add_argument('--keep-open',action='store_true');args=parser.parse_args();base='http://localhost:9515'
def req(method,path,data=None):
 r=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=60) as f:return json.load(f)['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
flags=['--no-sandbox','--window-size=1440,1000','--enable-webgl','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']
if args.uncapped:flags.append('--disable-frame-rate-limit')
if args.headless:flags.append('--headless=new')
s=args.session or req('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':flags},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId'];Path('/tmp/sketch-text-session.json').write_text(json.dumps({'session':s}))
if not args.session and not args.keep_open:
 def cleanup():
  try:req('DELETE','/session/'+s)
  except Exception:pass
 atexit.register(cleanup)
def command(path,data=None):return req('POST','/session/'+s+path,data or {})
def js(script):return command('/execute/sync',{'script':script,'args':[]})
command('/goog/cdp/execute',{'cmd':'Emulation.setDeviceMetricsOverride','params':{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False}})
command('/url',{'url':args.url})
command('/timeouts',{'script':60000})
for _ in range(200):
 if js('return window.__sketchGPU&&items.size===8685'):break
 time.sleep(.1)
js('window.__textStressRunning=true;for(const name of ["wheel","pointerdown","keydown"])window.addEventListener(name,e=>{if(window.__textStressRunning)e.stopImmediatePropagation();},{capture:true});setMode("move",false);fitAll()')
for _ in range(120):
 if js('return photoGPU.low.entries.size===7685&&!photoGPU.pending.size'):break
 time.sleep(.1)
report={'notes':js('return [...items.values()].filter(a=>a.type==="text").length'),'images':7685,'viewport':js('return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio}'),'mode':'headed hardware WebGL, '+('browser frame cap disabled' if args.uncapped else 'browser frame cap enabled'),'gpu':js('const gl=photoGPU.gl,e=gl.getExtension("WEBGL_debug_renderer_info");return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)')};print('SCENE',report,flush=True)
script='''const done=arguments[0];let times=[],cpu=[],n=0,last=performance.now();const base={...window.__textStressBaseCamera};function step(t){times.push(t-last);last=t;const start=performance.now();Object.assign(camera,base);camera.x+=n%2?2:0;if(window.__textStressZoom)zoomAt(n%2?1.004:1/1.004,700,450);renderCamera();cpu.push(performance.now()-start);if(++n<240)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);cpu.sort((a,b)=>a-b);done({medianMs:times[120],p95Ms:times[228],cpuMedianMs:cpu[120],cpuP95Ms:cpu[228],fpsMedian:Math.round(1000/times[120]),proxies:noteProxyCards.size,domNotes:document.querySelectorAll('.text-card').length,media:__sketchGPU.stats(),hidden:document.hidden,focused:document.hasFocus(),camera:{...camera},notes:typeof noteGPU==="undefined"?null:noteGPU.stats});}}requestAnimationFrame(step);'''
for name,setup in [
 ('mixedOverview','fitAll()'),
 ('notesOverview','camera.scale=.012;camera.x=80-210000*camera.scale;camera.y=70;renderCamera()'),
 ('notesPreviewText','camera.scale=.024;camera.x=80-210000*camera.scale;camera.y=70;renderCamera()'),
 ('notesEditable','camera.scale=.07;camera.x=80-210000*camera.scale;camera.y=70;renderCamera()'),
 ('notesZoom','camera.scale=.024;camera.x=80-210000*camera.scale;camera.y=70;__textStressZoom=true;renderCamera()')]:
 js('__textStressZoom=false;'+setup+';window.__textStressBaseCamera={...camera}');time.sleep(.4)
 for _ in range(100):
  if js('return typeof noteGPU==="undefined"||!noteGPU.pending.size'):break
  time.sleep(.05)
 report[name]=command('/execute/async',{'script':script,'args':[]});print(name,report[name],flush=True)
 report[name]['profile']=js('const out={};for(const name of ["renderNotePreviews","renderSolidPreviews","renderConnections","renderCamera"]){let t=performance.now();for(let i=0;i<5;i++)window[name]();out[name]=(performance.now()-t)/5;}return out')
report['errors']=[a for a in command('/log',{'type':'browser'}) if a['level']=='SEVERE'];Path(args.report).write_text(json.dumps(report,indent=2));js('window.__textStressRunning=false');print('DONE',flush=True)
# A new test browser closes automatically unless --keep-open is explicit.
