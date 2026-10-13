exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(3)
result=asyncjs('''const canvas=document.createElement('canvas');const engine=new ApoxiaMediaRenderer(canvas,()=>{},null,{lowTile:128,lowPages:1,highPages:1,nativePages:0,noteSource:()=>({width:300,height:160,font:17,lines:[],lengths:[],shadow:'#80aaf0',border:'#80aaf0',background:'#000000',ink:'#eeeeee'})});const model={id:'test-border',type:'note',x:0,y:0,w:300,h:160,shadow:0,dom:false,backgroundHidden:false,borderColor:'#80aaf0',noteKey:'test'};engine.sync([model]);engine.enqueue(engine.models.get(model.id),64);engine.pump();for(let i=0;i<100&&!engine.texture(engine.models.get(model.id),64);i++)await new Promise(r=>setTimeout(r,20));const samples=[];for(const scale of [.2,.137,.075])for(const offset of [0,.24,.51,.79]){engine.render({x:100+offset,y:100+offset,scale});const gl=engine.gl,p=new Uint8Array(4);const read=(x,y)=>{gl.readPixels(x,canvas.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return Array.from(p);};const left=Math.round(100+offset),top=Math.round(100+offset),right=Math.round(100+offset+300*scale),bottom=Math.round(100+offset+160*scale);samples.push({scale,offset,left:[0,1,2,3].map(i=>read(left+i,Math.floor((top+bottom)/2))),top:[0,1,2,3].map(i=>read(Math.floor((left+right)/2),top+i)),right:[0,1,2,3].map(i=>read(right-1-i,Math.floor((top+bottom)/2))),bottom:[0,1,2,3].map(i=>read(Math.floor((left+right)/2),bottom-1-i))});}engine.reset();for(const worker of engine.workers)worker.worker.terminate();return samples;''')
for sample in result:
 for side in ['left','top','right','bottom']:
  pixels=sample[side]
  assert all(p[2]>200 for p in pixels[:1]),sample
  assert all(p[2]<20 for p in pixels[1:]),sample
print('Exactly one screen pixel on all four sides at fractional positions and zoom levels',flush=True)
