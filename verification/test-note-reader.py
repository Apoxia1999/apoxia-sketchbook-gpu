import json,urllib.request,time,tempfile,subprocess,os,shutil
processes=[];root=tempfile.mkdtemp(prefix='apoxia-reader-');session=None

def request(url,data=None):
 req=urllib.request.Request(url,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
 return json.load(urllib.request.urlopen(req,timeout=25))
try:
 processes.append(subprocess.Popen(['node','server.js'],env=dict(os.environ,PORT='4190',REFERENCIAS_DATA_DIR=root),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
 processes.append(subprocess.Popen(['chromedriver','--port=9515'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL))
 time.sleep(2)
 session=request('http://localhost:9515/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1280,900']}}}})['value']['sessionId']
 base='http://localhost:9515/session/'+session
 request(base+'/url',{'url':'http://localhost:4190'});time.sleep(2)
 def js(script):return request(base+'/execute/sync',{'script':script,'args':[]})['value']
 def ajs(script):return request(base+'/execute/async',{'script':'const done=arguments[0];(async()=>{'+script+'})().then(done).catch(e=>done({error:String(e)}));','args':[]})['value']
 result=ajs("await initialBoardReady;const r=await fetch('/api/text',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({x:0,y:0,displayWidth:400,displayHeight:250,textFontSize:22,color:'#f7f7f4'})});const item=await r.json();const text=('Un capítulo muy largo para leer.\\n').repeat(3000);const saved=await fetch('/api/items/'+item.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,locked:true})});if(!saved.ok)throw Error(await saved.text());await refreshItems();camera.x=100;camera.y=100;camera.scale=1;renderCamera();renderSolidPreviews();pointerPosition={x:160,y:160};return {id:item.id,length:items.get(item.id).text.length};")
 assert 'error' not in result,result
 assert result['length']>20000,result
 js("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));")
 state=js("return {open:noteReader.open,text:noteReaderText.value.length,spaceHeld,mode};")
 assert state['open'] and state['text']==result['length'] and not state['spaceHeld'],state
 js("noteReaderScroll.scrollTop=(noteReaderScroll.scrollHeight-noteReaderScroll.clientHeight)*.42;noteReaderScroll.dispatchEvent(new Event('scroll'));")
 before=js("return readerPosition();")
 js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));")
 assert js('return noteReader.open;')==False
 js("previewUnderPointer();")
 after=js("return {position:readerPosition(),percent:noteReaderPercent.textContent};")
 assert abs(after['position']-before)<.002,after
 assert after['percent']=='42%',after
 assert ajs("const id=noteReaderId;items.get(id).locked=false;closeNoteReader();previewUnderPointer();noteReaderText.value+='\\nEdición en fullscreen';noteReaderText.dispatchEvent(new Event('input'));noteReaderText.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));if(!noteReader.open)throw Error('Space closed editor');closeNoteReader();await noteReaderWrite;const saved=(await(await fetch('/api/items')).json()).find(x=>x.id===id);if(!saved.text.endsWith('Edición en fullscreen'))throw Error('Edit not saved');return true;")==True
 js("closeNoteReader();window.apoxiaDesktop={openOriginal:async id=>window.__opened=id};const id=crypto.randomUUID();items.set(id,{id,type:'image',x:0,y:0,displayWidth:400,displayHeight:250,width:64,height:64,status:'ready',originalAvailable:true,locked:true});gpuSceneDirty=true;showTexts=false;renderSolidPreviews();previewUnderPointer();")
 assert js('return Boolean(window.__opened);')
 print('PASS: Space preview without panning, long locked note, 42% scroll restoration, locked image original.')
finally:
 if session:
  try:urllib.request.urlopen(urllib.request.Request('http://localhost:9515/session/'+session,method='DELETE'),timeout=5)
  except:pass
 for p in processes:
  p.terminate()
  try:p.wait(timeout=5)
  except: p.kill()
 shutil.rmtree(root,ignore_errors=True)
