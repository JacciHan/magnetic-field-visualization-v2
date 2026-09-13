import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../vendor/three.module.js';
import {SCENES,buildField,generateFieldLines,sampleModel,runPhysicsValidation,runGeometryValidation} from '../field-core.js';
import {computeJob,computeHeatData,transferables} from '../compute-job.js';
import {computeSectionBasis} from '../field-core.js';
const params = (id, overrides={}) => ({...Object.fromEntries(SCENES.find(s=>s.id===id).params.map(p=>[p.id,p.val])),...overrides});
const vector = new THREE.Vector3();

test('45 physical checks and 121 independent reference vectors', () => {
  const report=runPhysicsValidation();
  assert.equal(report.passed,45); assert.equal(report.total,45);
  // Frozen independent Biot–Savart / high-order quadrature results from 2026-09-06.
  // Neither this fixture nor its values are generated with the production solver.
  const refs=JSON.parse(fs.readFileSync(new URL('./fixtures/physics-reference.json',import.meta.url)));
  assert.equal(refs.length,121);
  for(const row of refs) {
    const actual=new THREE.Vector3(...sampleModel(row.id,row.params,row.point).B);
    const ref=new THREE.Vector3(...row.reference),scale=ref.length();
    assert.ok(actual.distanceTo(ref) <= (scale>1e-6 ? .01*scale : 1e-6),`${row.id} ${row.point}`);
  }
});

for(const density of ['清晰','标准','丰富'])for(const radius of [1,2,4])for(const direction of ['正向','反向']) {
  test(`loop ${density} R=${radius} ${direction}: complete paired planes, signed direction, symmetry`,()=>{
    const P=params('loop',{density,radius,direction,current:radius===1?10:radius===4?100:50});
    const field=buildField('loop',P),gen=generateFieldLines('loop',P,field);
    const planes=({'清晰':2,'标准':4,'丰富':6})[density],perSide=({'清晰':4,'标准':5,'丰富':6})[density],perPlane=2*perSide;
    assert.equal(gen.total,planes*perPlane);
    assert.equal(gen.closed,gen.total);assert.equal(gen.quality.passed,gen.total);
    const axis=new THREE.Vector3(0,1,0);
    for(let k=0;k<planes;k++)for(let i=0;i<perPlane;i++) {
      const line=gen.lines[k*perPlane+i],base=gen.lines[i];
      assert.ok(line[0].distanceTo(line.at(-1))<1e-7);
      for(let j=0;j<line.length-1;j+=Math.max(1,Math.floor(line.length/80))) {
        // Verify spatial rotation and actual arrow orientation, not abs(dot).
        assert.ok(base[j].clone().applyAxisAngle(axis,k*Math.PI/planes).distanceTo(line[j])<1e-7);
        const tangent=line[j+1].clone().sub(line[j]).normalize();
        const mid=line[j+1].clone().add(line[j]).multiplyScalar(.5);
        field.evalB(mid.x,mid.y,mid.z,vector);
        assert.ok(tangent.dot(vector.normalize())>.94,`backward or misaligned line ${i}`);
      }
    }
    // Opposite sides must match as curves; phase and traversal differ after reflection.
    const left=gen.lines[0],right=gen.lines[perSide];
    let error=0;
    for(let i=0;i<left.length;i+=Math.max(1,Math.floor(left.length/60))) {
      const target=left[i].clone().applyAxisAngle(axis,Math.PI);
      let distance=Infinity;
      for(let j=1;j<right.length;j++) {
        new THREE.Line3(right[j-1],right[j]).closestPointToPoint(target,true,vector);
        distance=Math.min(distance,target.distanceTo(vector));
      }
      error=Math.max(error,distance);
    }
    assert.ok(error<=.01*radius,`paired curve distance ${error}`);
  });
}

test('density leaves sampled field values unchanged; current reversal negates the vector',()=>{
  for(const point of [[0,0,0],[.6,.7,.2],[2.2,.3,.4]]) {
    const a=sampleModel('loop',{density:'清晰'},point).B;
    assert.deepEqual(sampleModel('loop',{density:'丰富'},point).B,a);
    const b=sampleModel('loop',{direction:'反向'},point).B;
    assert.ok(new THREE.Vector3(...a).add(new THREE.Vector3(...b)).length()<1e-9);
  }
});

test('all existing geometry boundary cases still pass',()=>{
  const result=runGeometryValidation();
  assert.ok(result.total>=23);
  assert.equal(result.passed,result.total,JSON.stringify(result.checks.filter(c=>!c.pass)));
});

test('worker job computes requested layers only and transfers finite float geometry',()=>{
  const job={sceneId:'solenoid',params:params('solenoid'),section:{n:'z',off:0,rot:0},size:14,kinds:['field']};
  const result=computeJob(job);
  assert.equal(result.field.total,19);assert.equal(result.field.closed,18);assert.equal(result.field.expectedOpen,1);
  assert.equal(result.heat,undefined);assert.equal(result.section,undefined);
  assert.equal(transferables(result).length,19);
  assert.ok(result.field.lines.every(line=>line.every(Number.isFinite)));
  const only=computeJob({...job,sceneId:'straight-wire',params:params('straight-wire'),section:{n:'y',off:0,rot:0},kinds:['section']});
  assert.equal(only.field,undefined); assert.ok(only.section.lines.length>0);
});

test('heatmap preserves finite values, near-wire mask and signed-current magnitude',()=>{
  const P=params('loop'),sec=computeSectionBasis({n:'z',off:0,rot:0});
  const a=computeHeatData(buildField('loop',P),sec,10);
  const b=computeHeatData(buildField('loop',{...P,direction:'反向'}),sec,10);
  assert.equal(a.pixels.length,128*128*4);assert.equal(a.scaleB,b.scaleB);
  assert.deepEqual(a.pixels,b.pixels);assert.ok(a.scaleB>0);
  let transparent=0,opaque=0;
  for(let i=3;i<a.pixels.length;i+=4) a.pixels[i]===0?transparent++:opaque++;
  assert.ok(transparent>0 && opaque>0);
});
