import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('./svg-vector-worker.js', import.meta.url), 'utf8');
function compile(d, options = {}) {
  let result;
  const context = vm.createContext({self: {postMessage: data => { result = data; }}});
  vm.runInContext(source, context);
  context.self.onmessage({data: {width: 100, height: 100, originX: 0, originY: 0, sourceScale: 1, offsetX: 0, offsetY: 0, contours: [{d, color: [0, 0, 0], width: .8}], ...options}});
  return result;
}
test('relative paths, implicit lines and closed subpaths preserve source geometry', () => {
  const result = compile('m10 20 5 0 h5 v5 z M40 50L42 53');
  assert.equal(result.error, undefined); assert.equal(result.pathCount, 2); assert.equal(result.segmentCount, 5);
  assert.deepEqual(Array.from(result.groups[0].levels[0]), [10,20,15,20,15,20,20,20,20,20,20,25,20,25,10,20,40,50,42,53]);
});
test('viewBox scaling and offset also scale the stroke width', () => {
  const result = compile('M10 20L12 23', {originX: 10, originY: 20, sourceScale: 2, offsetX: 5, offsetY: 7});
  assert.deepEqual(Array.from(result.groups[0].levels[0]), [5,7,9,13]); assert.equal(result.groups[0].width, 1.6);
});
test('unsupported curves and malformed paths are rejected instead of silently dropping geometry', () => {
  for (const d of ['M0 0 C1 2 3 4 5 6', 'M0 0 Q1 2 3 4', 'M0 0 A1 1 0 0 0 2 2', 'M0 0L2', 'M0 0@L2 3', 'L1 2', 'M0 0L1e999 3']) assert.ok(compile(d).error, d);
});
test('simplification keeps endpoints within its declared distance tolerance without changing the full buffer', () => {
  const points = [[0,0],[1,.2],[2,-.2],[3,0],[4,2],[5,2.2],[6,2]], d = points.map(([x,y],i)=>`${i?'L':'M'}${x} ${y}`).join('');
  const result = compile(d), [full, coarse] = result.groups[0].levels;
  assert.equal(full.length, 24); assert.ok(coarse.length < full.length); assert.deepEqual(Array.from(coarse.slice(0,2)), points[0]); assert.deepEqual(Array.from(coarse.slice(-2)), points.at(-1));
  for (const [x,y] of points) {
    let best = Infinity;
    for (let i=0;i<coarse.length;i+=4) { const ax=coarse[i],ay=coarse[i+1],dx=coarse[i+2]-ax,dy=coarse[i+3]-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1)));best=Math.min(best,Math.hypot(x-ax-t*dx,y-ay-t*dy)); }
    assert.ok(best <= result.tolerance + 1e-6);
  }
});
