import urllib.request,json,time,base64,hashlib
from pathlib import Path
BASE='http://localhost:9515'
def req(method,path,data=None):
 r=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=60) as f:return json.load(f)['value']
files=sorted(str(p) for p in Path('/home/apoxia/Downloads/testpictures/2025').rglob('*.webp'))
s=req('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--no-sandbox','--no-first-run','--window-size=1440,1000','--enable-webgl','--ignore-gpu-blocklist']},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId']
Path('/tmp/sketch-gpu-real-session.json').write_text(json.dumps({'session':s}))
def command(path,data={}):return req('POST','/session/'+s+path,data)
def js(script):return command('/execute/sync',{'script':script,'args':[]})
command('/url',{'url':'http://localhost:4180'});time.sleep(1)
e=command('/element',{'using':'css selector','value':'#fileInput'})['element-6066-11e4-a52e-4f735466cecf']
start=time.time();command('/element/'+e+'/value',{'text':'\n'.join(files)})
last=0
while time.time()-start<1800:
 p=js('return window.__gpuImportProgress||{active:true,complete:0}')
 if time.time()-last>20:print('PROGRESS',p,'seconds',round(time.time()-start,1),flush=True);last=time.time()
 if not p['active']:break
 time.sleep(1)
assert not p['active'] and p['complete']==len(files) and p['errors']==0,p
report={'files':len(files),'importSeconds':round(time.time()-start,2),'progress':p}
print('IMPORTED',report,flush=True)
records=js('return [...items.values()]');assert len(records)==len(files);assert all(a.get('gpuOriginalOnly') and a['status']=='ready' for a in records)
for a in records[::max(1,len(records)//20)]:
 source=Path(files[a['importBatch']['index']]);stored=Path('data/originals')/(a['id']+a['originalExt']);assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(stored.read_bytes()).digest()
report['originalHashesVerified']=len(records[::max(1,len(records)//20)])
print('ORIGINALS_BYTE_IDENTICAL',report['originalHashesVerified'],flush=True)
js('setMode("move",false);fitAll()');time.sleep(1)
start=time.time()
while time.time()-start<180:
 stats=js('return __sketchGPU.stats()')
 ready=js('return photoGPU.low.entries.size+ownedPhotoGPU.low.entries.size')
 if ready>=len(files) and stats['public']['pending']==0 and stats['owned']['pending']==0:break
 time.sleep(1)
report['thumbnailCount']=ready;report['overviewStats']=stats
print('OVERVIEW_READY',ready,stats,flush=True)
assert ready==len(files),(ready,stats)
def measure():return command('/execute/async',{'script':"const done=arguments[0];let times=[],last=performance.now(),n=0;function step(t){times.push(t-last);last=t;camera.x+=n%2?2:-2;renderCamera();if(++n<240)requestAnimationFrame(step);else{times.sort((a,b)=>a-b);done({median:times[120],p95:times[228],stats:__sketchGPU.stats()});}}requestAnimationFrame(step);",'args':[]})
report['overviewPerformance']=measure();print('PERFORMANCE_OVERVIEW',report['overviewPerformance'],flush=True)
js('const a=[...items.values()][0];camera.scale=a.originalWidth/a.displayWidth;camera.x=250-a.x*camera.scale;camera.y=180-a.y*camera.scale;renderCamera()');time.sleep(3)
report['closePerformance']=measure();print('PERFORMANCE_ORIGINAL',report['closePerformance'],flush=True)
command('/url',{'url':'http://localhost:4180'});time.sleep(2)
assert js('return items.size')==len(files);report['persistentReload']=True
report['errors']=[x for x in command('/log',{'type':'browser'}) if x['level']=='SEVERE']
js('fitAll()');time.sleep(3)
shot=req('GET','/session/'+s+'/screenshot');Path('verification/real-collection.png').write_bytes(base64.b64decode(shot))
Path('verification/real-collection-report.json').write_text(json.dumps(report,indent=2));print('DONE',flush=True)
