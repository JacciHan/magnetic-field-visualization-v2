import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../vendor/three.module.js';
const context = vm.createContext({THREE, performance, window: {}, console, URLSearchParams});
const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replace(/\ninit\(\);\s*$/, '');
vm.runInContext(source, context);
function run(params = {}, section = {}) {
  context.testParams = params;
  context.testSection = section;
  return vm.runInContext(`(()=>{
    Object.assign(SECTION,{n:'y',off:.4,rot:0},testSection);
    const params={current1:50,current2:50,spacing:3,direction:'同向',display:'合磁场',...testParams};
    const field=buildField('two-wires',params),sec=computeSectionBasis();
    return {field,sec,lines:generateProjectedStreamlines(field.evalB,sec,11,field)};
  })()`, context);
}
const bounds = line => new THREE.Box3().setFromPoints(line);
const closed = line => line[0].distanceTo(line.at(-1)) < 1e-8;
function innerLoops(lines) {
  const left=lines.find(l=>closed(l)&&bounds(l).max.x<0);
  const right=lines.find(l=>closed(l)&&bounds(l).min.x>0);
  assert.ok(left&&right,'both wire-local loops must remain visible');
  return [left,right];
}
function mirrorError(left,right) {
  // Point-to-polyline distance, independent of RK sampling phase/direction.
  let worst=0;
  for(const p of left) {
    const q=new THREE.Vector3(-p.x,p.y,p.z);let best=Infinity;
    for(let i=1;i<right.length;i++) {
      const target=new THREE.Vector3();
      new THREE.Line3(right[i-1],right[i]).closestPointToPoint(q,true,target);
      best=Math.min(best,q.distanceTo(target));
    }
    worst=Math.max(worst,best);
  }
  return worst;
}
for(const spacing of [1.5,3,5])for(const direction of ['同向','反向']) {
  test(`Y-normal equal currents: mirrored inner contours d=${spacing}, ${direction}`,()=>{
    for(const off of [-2,.4,2]) {
      const {lines}=run({spacing,direction},{off});const [left,right]=innerLoops(lines);
      assert.ok(mirrorError(left,right)<0.003,'reflected contours must agree within integration resolution');
      assert.ok(Math.abs(bounds(left).getSize(new THREE.Vector3()).x-bounds(right).getSize(new THREE.Vector3()).x)<.001);
      assert.ok(lines.every(l=>l.every(p=>Math.abs(p.y-off)<1e-10)));
    }
  });
}
test('unequal currents follow actual superposition and are not forced into mirrored shapes',()=>{
  const {lines}=run({current1:40,current2:60});
  const [left,right]=innerLoops(lines);
  assert.ok(mirrorError(left,right)>.05);
});
test('equal-current inner contours conserve the analytical external-wire flux function',()=>{
  const {lines}=run();
  for(const line of innerLoops(lines)) {
    const flux=line.map(p=>Math.log(Math.hypot(p.x+1.5,p.z))+Math.log(Math.hypot(p.x-1.5,p.z)));
    assert.ok(Math.max(...flux)-Math.min(...flux)<1e-4);
  }
});
test('field values retain reflection symmetry and the natural zero at the midpoint',()=>{
  const {field}=run();
  for(const x of [.2,.8,2.2])for(const z of [-.7,0,.9]) {
    const a=new THREE.Vector3(),b=new THREE.Vector3();
    field.evalB(-x,.4,z,a);field.evalB(x,.4,z,b);
    assert.ok(Math.abs(a.x-b.x)<1e-10&&Math.abs(a.z+b.z)<1e-10&&a.y===0&&b.y===0);
  }
  const center=new THREE.Vector3();field.evalB(0,.4,0,center);assert.equal(center.length(),0);
});
test('single-wire and rotated sections remain finite and lie on the requested plane',()=>{
  for(const display of ['合磁场','仅左导线','仅右导线'])for(const section of [{n:'y',rot:30},{n:'x',rot:0},{n:'z',rot:0}]) {
    const {lines,sec}=run({display},section);
    assert.ok(lines.every(l=>l.every(p=>p.toArray().every(Number.isFinite)&&Math.abs(p.clone().sub(sec.center).dot(sec.n))<1e-8)));
  }
});
