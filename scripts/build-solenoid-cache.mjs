import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildField,generateFieldLines,computeSectionBasis,HEAT_RES} from '../field-core.js';
import * as THREE from '../vendor/three.module.js';
const root=new URL('../',import.meta.url),out=new URL('precomputed/solenoid-v1/',root);
await fs.mkdir(out,{recursive:true});
const hash=createHash('sha256').update(await fs.readFile(new URL('field-core.js',root))).digest('hex');
const manifest={schema:1,fieldCoreSha256:hash,description:'48-point Gauss field, unchanged RK4 and quality gates; positive unit ampere-turn, R/L grid from UI',entries:[]};
for(const radius of [1,1.25,1.5,1.75])for(const length of [4,4.5,5,5.5,6,6.5,7,7.5,8]) {
  const params={radius,length,current:50,nLoops:160,direction:'正向（N 在 +Y）'};
  const field=buildField('solenoid',params),generated=generateFieldLines('solenoid',params,field);
  if(generated.total<12 || generated.quality.passed!==generated.total)throw new Error(`Invalid geometry ${radius}/${length}`);
  // Store each rotationally unique trajectory once, not six copies.
  const baseLines=generated.lines.slice(0,generated.closed/6).map(points=>points.flatMap(p=>p.toArray()));
  const axisLine=generated.lines.at(-1).flatMap(p=>p.toArray());
  const sec=computeSectionBasis({n:'z',off:0,rot:0}),values=[],p=new THREE.Vector3(),b=new THREE.Vector3();
  for(let row=0;row<HEAT_RES;row++)for(let col=0;col<HEAT_RES;col++) {
    p.copy(sec.center).addScaledVector(sec.U,(col/HEAT_RES-.5)*14).addScaledVector(sec.V,(.5-row/HEAT_RES)*14);
    if(field.heatMask(p.x,p.y,p.z))values.push(null);
    else {field.evalB(p.x,p.y,p.z,b);values.push(b.length()/8000);}
  }
  const artifact={schema:1,radius,length,fieldCoreSha256:hash,field:{...generated,lines:undefined,baseLines,axisLine},heat:{resolution:HEAT_RES,size:14,section:{n:'z',off:0,rot:0},perAmpereTurn:values}};
  const name=`r${radius}-l${length}.json.gz`,bytes=gzipSync(JSON.stringify(artifact),{level:9});
  await fs.writeFile(new URL(name,out),bytes);
  manifest.entries.push({radius,length,name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),total:generated.total});
  console.log(`${name}: ${generated.total} lines, ${bytes.length} bytes`);
}
await fs.writeFile(new URL('manifest.json',out),JSON.stringify(manifest,null,2)+'\n');
