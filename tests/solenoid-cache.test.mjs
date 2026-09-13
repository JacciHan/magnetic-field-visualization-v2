import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import * as THREE from '../vendor/three.module.js';
import {materializeSolenoid} from '../solenoid-cache.js';
import {buildField,assessLineQuality,computeSectionBasis} from '../field-core.js';
import {computeHeatData} from '../compute-job.js';
const root=new URL('../precomputed/solenoid-v1/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',root)));
const hash=data=>createHash('sha256').update(data).digest('hex');
test('precomputed catalogue covers all 36 permitted shapes and matches the current solver',()=>{
  assert.equal(manifest.entries.length,36);
  assert.equal(manifest.fieldCoreSha256,hash(fs.readFileSync(new URL('../field-core.js',import.meta.url))));
  const names=new Set(manifest.entries.map(row=>`${row.radius}/${row.length}`));
  for(const radius of [1,1.25,1.5,1.75])for(let length=4;length<=8;length+=.5)assert.ok(names.has(`${radius}/${length}`));
});
for(const entry of manifest.entries) test(`cached R=${entry.radius}, L=${entry.length}: signed curves and scaled heat agree with actual field`,()=>{
  const bytes=fs.readFileSync(new URL(entry.name,root));assert.equal(hash(bytes),entry.sha256);
  const artifact=JSON.parse(gunzipSync(bytes));assert.equal(artifact.fieldCoreSha256,manifest.fieldCoreSha256);
  for(const [current,nLoops,direction] of [[50,160,'正向（N 在 +Y）'],[10,50,'反向（N 在 −Y）'],[100,300,'正向（N 在 +Y）']]) {
    const params={radius:entry.radius,length:entry.length,current,nLoops,direction};
    const job={sceneId:'solenoid',params,section:{n:'z',off:0,rot:0},size:14,kinds:['field','heat']};
    const result=materializeSolenoid(artifact,job),field=buildField('solenoid',params);
    assert.equal(result.field.lines.length,entry.total);assert.ok(entry.total>=12);
    for(let i=0;i<result.field.lines.length;i++) {
      const data=result.field.lines[i],points=[];
      for(let j=0;j<data.length;j+=3)points.push(new THREE.Vector3(data[j],data[j+1],data[j+2]));
      assert.ok(assessLineQuality(points,field.evalB,result.field.closedFlags[i]).pass);
      const b=new THREE.Vector3();
      for(let j=0;j<points.length-1;j+=Math.max(1,Math.floor(points.length/16))) {
        const mid=points[j].clone().add(points[j+1]).multiplyScalar(.5);
        field.evalB(mid.x,mid.y,mid.z,b);
        assert.ok(points[j+1].clone().sub(points[j]).normalize().dot(b.normalize())>.94);
      }
    }
    // Independent direct field samples of the cached plane, including masked cells.
    const sec=computeSectionBasis(job.section),b=new THREE.Vector3();
    for(let row=0;row<128;row+=11)for(let col=0;col<128;col+=13){
      const p=sec.center.clone().addScaledVector(sec.U,(col/128-.5)*14).addScaledVector(sec.V,(.5-row/128)*14);
      const value=artifact.heat.perAmpereTurn[row*128+col];
      if(field.heatMask(p.x,p.y,p.z))assert.equal(value,null);
      else{field.evalB(p.x,p.y,p.z,b);assert.ok(Math.abs(value*current*nLoops-b.length())<=1e-8*Math.max(1,b.length()));}
    }
  }
});
test('default cached heat texture matches direct grid calculation; rotated slices are not reused',()=>{
  const entry=manifest.entries.find(e=>e.radius===1.5&&e.length===5),artifact=JSON.parse(gunzipSync(fs.readFileSync(new URL(entry.name,root))));
  const params={radius:1.5,length:5,current:50,nLoops:160,direction:'正向（N 在 +Y）'};
  const job={sceneId:'solenoid',params,section:{n:'z',off:0,rot:0},size:14,kinds:['heat']};
  const cached=materializeSolenoid(artifact,job).heat,direct=computeHeatData(buildField('solenoid',params),computeSectionBasis(job.section),14);
  assert.equal(cached.scaleB,direct.scaleB);assert.deepEqual(cached.pixels,direct.pixels);
  assert.equal(materializeSolenoid(artifact,{...job,section:{n:'z',off:.2,rot:0}}).heat,undefined);
  assert.equal(materializeSolenoid(artifact,{...job,section:{n:'z',off:0,rot:30}}).heat,undefined);
});
