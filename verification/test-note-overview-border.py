exec(open('verification/test-text-stress.py').read().split("command('/goog/cdp/execute'")[0])
exec(open('verification/test-text-interactions.py').read().split("cmd('/url'")[0])
cmd('/url',{'url':'http://localhost:4190'});time.sleep(3)
result=asyncjs('''const worker=new Worker('/gpu-worker.js');const results=[];try{for(const [width,height,hidden] of [[300,160,false],[900,160,false],[300,160,true]]){const data=await new Promise(resolve=>{worker.onmessage=e=>resolve(e.data);worker.postMessage({id:'border',size:64,note:{width,height,font:17,lines:[],lengths:[],shadow:hidden?null:'#80aaf0',border:hidden?null:'#80aaf0',backgroundHidden:hidden,background:'#000000',ink:'#eeeeee'}});});if(data.error)throw Error(data.error);const c=document.createElement('canvas');c.width=data.bitmap.width;c.height=data.bitmap.height;const ctx=c.getContext('2d');ctx.drawImage(data.bitmap,0,0);data.bitmap.close();const pixel=(x,y)=>Array.from(ctx.getImageData(x,y,1,1).data);results.push({hidden,edges:[pixel(Math.floor(c.width/2),0),pixel(Math.floor(c.width/2),c.height-1),pixel(0,Math.floor(c.height/2)),pixel(c.width-1,Math.floor(c.height/2))]});}}finally{worker.terminate();}return results;''')
for sample in result:
 for edge in sample['edges']:
  if sample['hidden']:assert edge[3]==0,sample
  else:assert edge[2]>180 and edge[3]>200,sample
print('Symmetric overview border on all four sides, transparent notes remain borderless',flush=True)
