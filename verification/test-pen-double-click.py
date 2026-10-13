"""Regression test with real pointer events and isolated temporary canvas data.
Start PORT=4197 REFERENCIAS_DATA_DIR=/tmp/apoxia-pen-click-test node server.js
and chromedriver --port=9517 before running this file.
"""
import urllib.request,json,time
base='http://127.0.0.1:9517'
def req(path,data=None,method=None):
 r=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method or ('POST' if data is not None else 'GET'))
 out=json.load(urllib.request.urlopen(r))['value']
 if isinstance(out,dict) and 'error' in out: raise RuntimeError(out)
 return out
s=req('/session',{'capabilities':{'alwaysMatch':{'browserName':'chrome','goog:chromeOptions':{'args':['--headless=new','--no-sandbox','--window-size=1440,1000']}}}})['sessionId']
def cmd(p,d=None):return req('/session/'+s+p,d)
def js(c):return cmd('/execute/sync',{'script':c,'args':[]})
def ajs(c):return cmd('/execute/async',{'script':'const done=arguments[0];(async()=>{'+c+'})().then(done).catch(e=>done({error:String(e)}));','args':[]})
def actions(a):cmd('/actions',{'actions':[{'type':'pointer','id':'mouse','parameters':{'pointerType':'mouse'},'actions':a}]});time.sleep(.15)
def at(x,y):return {'type':'pointerMove','x':x,'y':y,'duration':30}
def down():return {'type':'pointerDown','button':0}
def up():return {'type':'pointerUp','button':0}
try:
 cmd('/url',{'url':'http://127.0.0.1:4197'});time.sleep(3)
 print(ajs("await initialBoardReady;for(const id of [...items.keys()])removeCard(id);for(const node of writingNodes.values())node.remove();writingNodes.clear();writings.clear();window.n=await apiChange('/api/text','POST',{x:100,y:100,displayWidth:400,displayHeight:200,textFontSize:22,color:'#f7f7f4'});items.set(n.id,n);createCard(n);window.w=await apiChange('/api/writings','POST',{text:'Texto de prueba',x:650,y:220,size:48,color:'#ffffff'});writings.set(w.id,w);setMode('move',false);camera.x=0;camera.y=0;camera.scale=1;renderCamera();return true;"))
 time.sleep(1)
 # first tap includes 8px wobble, second is 18px away: neither may move the note.
 actions([at(200,160),down(),at(208,160),up(),{'type':'pause','duration':100},at(218,160),down(),up()])
 assert js('return editingNoteId===n.id && n.x===100 && n.y===100'),js('return {edit:editingNoteId,n,gesture}')
 print('NOTE_WOBBLE_DOUBLE_EDIT: PASS')
 time.sleep(.6)
 actions([at(200,160),down(),up(),{'type':'pause','duration':80},at(200,160),down(),up()])
 assert js('return editingNoteId===null'),'native double toggled twice'
 print('NOTE_NATIVE_DOUBLE_EXIT: PASS')
 time.sleep(.6)
 actions([at(200,160),down(),at(260,195),up()])
 assert js('return n.x===160 && n.y===135'),js('return n')
 assert ajs('await travelHistory(false);return n.x===100 && n.y===100;')
 print('NOTE_DRAG_UNDO: PASS')
 time.sleep(.6)
 p=js('const r=writingNodes.get(w.id).getBoundingClientRect();return {x:Math.round(r.x+30),y:Math.round(r.y+r.height/2)}')
 x,y=p['x'],p['y']
 actions([at(x,y),down(),at(x+8,y),up(),{'type':'pause','duration':100},at(x+18,y),down(),up()])
 assert js('return editingWriting?.id===w.id && w.x===650 && w.y===220'),js('return {editingWriting,w,pendingTextTap,lastTextTap}')
 print('WRITING_WOBBLE_DOUBLE_EDIT: PASS')
 ajs('await finishWritingEdit(false);return true;');time.sleep(.6)
 actions([at(x,y),down(),at(x+60,y+30),up()])
 assert js('return w.x===710 && w.y===250')
 assert ajs('await travelHistory(false);return w.x===650 && w.y===220;')
 print('WRITING_DRAG_UNDO: PASS')
 time.sleep(.6)
 actions([at(x,y),down(),up(),{'type':'pause','duration':80},at(x+25,y),down(),up()])
 assert js('return editingWriting===null && w.x===650')
 print('DISTANT_TAPS_REJECTED: PASS')
 time.sleep(.6)
 actions([at(x,y),down(),up(),{'type':'pause','duration':550},at(x+8,y),down(),up()])
 assert js('return editingWriting===null')
 print('SLOW_TAPS_REJECTED: PASS')

finally:req('/session/'+s,method='DELETE')
