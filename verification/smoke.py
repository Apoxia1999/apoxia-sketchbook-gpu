import urllib.request,json,time
BASE='http://localhost:9515'
def req(method,path,data=None):
 r=urllib.request.Request(BASE+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json'})
 with urllib.request.urlopen(r,timeout=60) as f:return json.load(f)['value']
s=req('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1440,1000','--enable-unsafe-swiftshader']},'goog:loggingPrefs':{'browser':'ALL'}}}})['sessionId']
def command(path,data={}):return req('POST','/session/'+s+path,data)
def js(script):return command('/execute/sync',{'script':script,'args':[]})
command('/url',{'url':'http://localhost:4180'});time.sleep(2)
print('INIT',js('return {gpu:typeof __sketchGPU,toast:document.querySelector("#toast").textContent,stats:window.__sketchGPU?.stats()}'),flush=True)
command('/execute/async',{'script':"const done=arguments[0];const c=document.createElement('canvas');c.width=2000;c.height=1500;const ctx=c.getContext('2d');ctx.fillStyle='#85b3ae';ctx.fillRect(0,0,2000,1500);ctx.fillStyle='#dd8855';ctx.fillRect(200,200,1200,900);c.toBlob(async b=>{try{await __sketchGPU.importFiles([new File([b],'smoke.png',{type:'image/png'})],300,200);done('ok');}catch(e){done(String(e));}});",'args':[]})
time.sleep(2)
print('IMPORTED',js('return {stats:__sketchGPU.stats(),items:[...__sketchGPU.items.values()]}'),flush=True)
print('LOG',command('/log',{'type':'browser'}),flush=True)
open('/tmp/sketch-gpu-smoke-session','w').write(s)
