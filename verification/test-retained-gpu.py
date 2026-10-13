import json,time,urllib.request,urllib.error
from pathlib import Path
BASE='http://localhost:9515'
def request(method,path,data=None):
 r=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(r,timeout=30) as f:return json.load(f)['value']
 except urllib.error.HTTPError as e:raise RuntimeError(e.read().decode()) from e
s=request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1440,1000','--enable-webgl','--ignore-gpu-blocklist']},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId']
def command(path,data=None):return request('POST','/session/'+s+path,data or {})
def js(script):return command('/execute/sync',{'script':script,'args':[]})
def pointer(acts):return command('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':acts}]})
try:
 command('/url',{'url':'http://localhost:4182'})
 for _ in range(80):
  if js('return window.__sketchGPU&&items.size'):break
  time.sleep(.1)
 js('setMode("move",false);fitAll();camera.scale*=.25;renderCamera()');time.sleep(2)
 result=js('renderCamera();const cache=photoGPU.overviewCache;camera.x+=2;renderCamera();return {cacheRetained:!!cache&&cache===photoGPU.overviewCache,items:items.size}')
 assert result['cacheRetained'],result
 js('const a=[...items.values()].find(a=>a.type==="image");camera.scale=.15;camera.x=300-a.x*.15;camera.y=200-a.y*.15;renderCamera();window.testImage=gpuPick(400,300).id;window.testX=items.get(testImage).x');time.sleep(1)
 pointer([{'type':'pointerMove','x':400,'y':300,'duration':100},{'type':'pause','duration':100},{'type':'pointerDown','button':0},{'type':'pointerMove','x':490,'y':360,'duration':300},{'type':'pointerUp','button':0}]);time.sleep(.3)
 result['drag']=js('const a=items.get(testImage),model=photoGPU.models.get(a.id)||ownedPhotoGPU.models.get(a.id);return {dx:a.x-testX,modelX:model.x,itemX:a.x}')
 assert abs(result['drag']['dx']-600)<.01,result;assert result['drag']['modelX']==result['drag']['itemX'],result
 command('/execute/async',{'script':'const done=arguments[0];travelHistory(false).then(done);','args':[]});assert js('return items.get(testImage).x===testX')
 result['undo']=True
 js('fitAll();renderCamera();setMediaVisible(false);renderCamera()');assert js('return photoGPU.models.size+ownedPhotoGPU.models.size')==0
 js('setMediaVisible(true);renderCamera()');assert js('return photoGPU.models.size')>0;result['visibility']=True
 # Eviction must not overwrite any entry referenced by the retained buffers.
 result['pins']=js('fitAll();camera.scale*=.25;renderCamera();const cache=photoGPU.overviewCache;return !!cache&&[...photoGPU.low.entries.values()].some(e=>photoGPU.low.isPinned(e)&&e.pinned===cache.token)');assert result['pins']
 result['errors']=[a for a in command('/log',{'type':'browser'}) if a['level']=='SEVERE'];assert not result['errors'],result['errors']
 Path('verification/retained-gpu-report.json').write_text(json.dumps(result,indent=2));print('PASS',result,flush=True)
finally:request('DELETE','/session/'+s)
