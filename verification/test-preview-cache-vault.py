import json,urllib.request,urllib.error,http.cookiejar
from pathlib import Path
base='http://localhost:4184';opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(method,path,data=None,headers=None):
 r=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','X-Apoxia-Protocol':'16',**(headers or {})})
 try:
  with opener.open(r,timeout=30) as f:return f.status,dict(f.headers),f.read()
 except urllib.error.HTTPError as e:return e.code,dict(e.headers),e.read()
def api(method,path,data=None):
 status,headers,body=call(method,path,data);assert status<300,(status,body);return json.loads(body)
a=next(a for a in api('GET','/api/items') if a['type']=='image')
root=Path('verification/cache-vault-tests/tmp/gpu-preview-packs')
status,headers,body=call('GET','/media/'+a['id']+'-thumb.webp');assert status==200;etag=headers['ETag']
status,_,_=call('POST','/api/gpu-preview-pack',{'ids':[a['id']]});assert status==200;assert len(list(root.glob('*.webp')))==1
v=api('POST','/api/vaults',{'x':a['x']-600,'y':a['y']-700,'width':5000,'height':4000})
api('POST','/api/vaults/'+v['id']+'/unlock',{'password':'cache-test-only','confirm':'cache-test-only'})
assert not list(root.glob('*.webp'))
status,_,_=call('POST','/api/gpu-preview-pack',{'ids':[a['id']]});assert status==200
api('PUT','/api/vault-memberships',[{'id':v['id'],'members':{'items':[a['id']],'strokes':[],'writings':[]}}]);assert not list(root.glob('*.webp'))
status,headers,_=call('GET','/media/'+a['id']+'-thumb.webp',headers={'If-None-Match':etag});assert status==200 and headers['Cache-Control']=='private, no-store' and 'ETag' not in headers,(status,headers)
_,headers,_=call('POST','/api/vaults/'+v['id']+'/lock',{});assert headers['Clear-Site-Data']=='"cache"'
status,headers,_=call('GET','/media/'+a['id']+'-thumb.webp',headers={'If-None-Match':etag});assert status==404 and headers['Cache-Control']=='no-store',(status,headers)
status,_,_=call('POST','/api/gpu-preview-pack',{'ids':[a['id']]});assert status==404
status,_,_=call('POST','/api/gpu-preview-pack',{'ids':['../originals/foo']});assert status==400
api('POST','/api/vaults/'+v['id']+'/unlock',{'password':'cache-test-only'})
api('DELETE','/api/vaults/'+v['id'],{'confirm':'BORRAR VAULT','action':'release'})
report={'publicPackStored':True,'cachePurgedBeforeEncryption':True,'openPrivateNoStore':True,'closedPrivateStatus':404,'closedPackStatus':404,'invalidIdsStatus':400}
Path('verification/preview-cache-vault-report.json').write_text(json.dumps(report,indent=2));print('PASS',report)
