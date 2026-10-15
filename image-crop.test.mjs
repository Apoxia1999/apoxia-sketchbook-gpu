import test from 'node:test';
import assert from 'node:assert/strict';
import './image-crop.js';
const Crop=globalThis.ApoxiaCrop;
test('crop validation only accepts normalized, nonempty source rectangles',()=>{
 assert.equal(Crop.normalize(null),null);assert.equal(Crop.normalize({x:0,y:0,width:1,height:1}),null);
 assert.deepEqual(Crop.normalize({x:.25,y:.1,width:.5,height:.8}),{x:.25,y:.1,width:.5,height:.8});
 for(const value of [false,[],{x:0,y:0,width:0,height:1},{x:-.1,y:0,width:1,height:1},{x:.8,y:0,width:.5,height:1},{x:0,y:NaN,width:1,height:1}])assert.throws(()=>Crop.normalize(value));
});
test('crop keeps the original source position and scale while moving visible edges',()=>{
 const item={x:300,y:300,displayWidth:400,displayHeight:200},original=Crop.sourceBounds(item);
 const result=Crop.drag(original,item,'w',100,0,8);
 assert.deepEqual(result,{x:400,y:300,displayWidth:300,displayHeight:200,crop:{x:.25,y:0,width:.75,height:1}});
 assert.deepEqual(Crop.sourceBounds(result),original);
 assert.equal(Crop.aspect({...result,width:200,height:100}),1.5);
});
test('recropping a cropped image uses full-source coordinates',()=>{
 const item={x:400,y:300,displayWidth:300,displayHeight:200,crop:{x:.25,y:0,width:.75,height:1}},original=Crop.sourceBounds(item);
 const result=Crop.drag(original,item,'se',-100,-50,8);
 assert.deepEqual(result.crop,{x:.25,y:0,width:.5,height:.75});
 assert.deepEqual(Crop.sourceBounds(result),original);
});
test('overshooting any original edge resets all crop dimensions',()=>{
 const item={x:400,y:350,displayWidth:200,displayHeight:100,crop:{x:.25,y:.25,width:.5,height:.5}},original=Crop.sourceBounds(item);
 for(const [dir,dx,dy]of [['w',-101,0],['e',101,0],['n',0,-51],['s',0,51]]){
  assert.deepEqual(Crop.drag(original,item,dir,dx,dy,8),{x:300,y:300,displayWidth:400,displayHeight:200,crop:null});
 }
});
test('dragging across the opposite edge cannot invert or empty the crop',()=>{
 const item={x:0,y:0,displayWidth:400,displayHeight:200};const result=Crop.drag(Crop.sourceBounds(item),item,'nw',1000,1000,8);
 assert.equal(result.displayWidth,8);assert.equal(result.displayHeight,8);assert.ok(result.crop.width>0&&result.crop.height>0);
});
