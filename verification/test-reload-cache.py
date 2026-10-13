"""Reload benchmark against an isolated data copy; needs ChromeDriver :9515."""
import json,time,urllib.request,urllib.error
from pathlib import Path
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://localhost:4183');parser.add_argument('--count',type=int,default=7690);parser.add_argument('--report',default='verification/reload-cache-report.json');args=parser.parse_args()
base='http://localhost:9515';url=args.url;expected=args.count
def req(method,path,data=None):
 r=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=60) as f:return json.load(f)['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
s=req('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1440,1000','--enable-webgl','--ignore-gpu-blocklist','--disable-backgrounding-occluded-windows','--disable-renderer-backgrounding','--disable-background-timer-throttling']},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId']
def command(path,data=None):return req('POST','/session/'+s+path,data or {})
def js(script):return command('/execute/sync',{'script':script,'args':[]})
def load(refresh=False):
 start=time.monotonic();command('/refresh' if refresh else '/url',{} if refresh else {'url':url})
 while time.monotonic()-start<60:
  if js(f'return !!window.__sketchGPU&&items.size==={expected}'):break
  time.sleep(.05)
 js('setMode("move",false);fitAll()');last=0
 while time.monotonic()-start<120:
  state=js('return {ready:photoGPU.low.entries.size+ownedPhotoGPU.low.entries.size,stats:__sketchGPU.stats()}')
  if time.monotonic()-last>5:print('PROGRESS',refresh,round(time.monotonic()-start,2),state['ready'],flush=True);last=time.monotonic()
  if state['ready']==expected and not state['stats']['public']['pending']:break
  time.sleep(.05)
 assert state['ready']==expected,state
 return {'seconds':round(time.monotonic()-start,2),'state':state}
try:
 report={'files':expected,'cold':load(),'reload':load(True)};print('RELOAD',report,flush=True)
 report['errors']=[a for a in command('/log',{'type':'browser'}) if a['level']=='SEVERE'];assert not report['errors'],report['errors']
 # A public file is cacheable but must validate on every fresh browser load.
 id=js('return [...items.values()].find(a=>a.type==="image").id')
 target=url+'/media/'+id+'-thumb.webp';response=urllib.request.urlopen(target);headers=dict(response.headers);response.read();assert headers['Cache-Control']=='private, no-cache';assert headers.get('ETag')
 try:urllib.request.urlopen(urllib.request.Request(target,headers={'If-None-Match':headers['ETag']}));raise AssertionError('expected 304')
 except urllib.error.HTTPError as e:assert e.code==304,e.code
 report['conditionalCache']={'status':304,'cacheControl':headers['Cache-Control']}
 Path(args.report).write_text(json.dumps(report,indent=2));print('PASS',flush=True)
finally:req('DELETE','/session/'+s)
