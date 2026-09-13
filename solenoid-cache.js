import {gunzipSync} from './vendor/fflate.js';
import {heatColor} from './field-core.js';
const cache=new Map();
const radii=[1,1.25,1.5,1.75],lengths=[4,4.5,5,5.5,6,6.5,7,7.5,8];

// Geometry of a linear air-core field is independent of positive I*N.
// Reversing current reverses traversal, while heat values scale by |I*N|.
export function materializeSolenoid(artifact,job) {
  if(artifact.schema!==1 || artifact.radius!==job.params.radius || artifact.length!==job.params.length)throw new Error('预计算模型版本或尺寸不匹配');
  const result={},reverse=job.params.direction.startsWith('反向');
  if(job.kinds.includes('field')) {
    const lines=[];
    for(const angle of [-.38,0,.38,Math.PI-.38,Math.PI,Math.PI+.38])for(const base of artifact.field.baseLines) {
      // Stored baseLines are already at the first (-.38) display rotation.
      const delta=angle+.38,c=Math.cos(delta),s=Math.sin(delta),line=new Float32Array(base.length);
      for(let i=0;i<base.length;i+=3){line[i]=base[i]*c+base[i+2]*s;line[i+1]=base[i+1];line[i+2]=-base[i]*s+base[i+2]*c;}
      lines.push(line);
    }
    lines.push(new Float32Array(artifact.field.axisLine));
    const {baseLines,axisLine,...stats}=artifact.field;
    result.field={...stats,lines:lines.map(data=>{
      const line=new Float32Array(data.length),count=data.length/3;
      for(let i=0;i<count;i++) {
        const j=reverse?count-1-i:i;
        line[i*3]=data[j*3];line[i*3+1]=data[j*3+1];line[i*3+2]=data[j*3+2];
      }
      return line;
    })};
  }
  if(job.kinds.includes('heat') && job.section.n==='z' && job.section.off===0 && job.section.rot===0 && job.size===14) {
    const S=artifact.heat.resolution,scale=Math.abs(job.params.current*job.params.nLoops);
    // Match makeHeatData's float-grid rounding before computing P98 and colors.
    const vals=Float32Array.from(artifact.heat.perAmpereTurn,v=>v===null?NaN:v*scale);
    const sorted=Array.from(vals).filter(Number.isFinite).sort((a,b)=>a-b),pixels=new Uint8ClampedArray(S*S*4);
    const maxB=sorted.at(-1)||0,scaleB=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.98))]||0;
    const logMax=Math.log(Math.max(scaleB,1e-9)+1);
    for(let i=0;i<vals.length;i++)if(Number.isFinite(vals[i]))pixels.set([...heatColor(Math.pow(Math.min(1,Math.log(vals[i]+1)/logMax),.72)),138],i*4);
    result.heat={pixels,resolution:S,maxB,scaleB};
  }
  return result;
}

export async function loadSolenoid(job) {
  const {params,sceneId}=job;
  if(sceneId!=='solenoid' || !radii.includes(params.radius) || !lengths.includes(params.length) || params.integrationSlices || !params.current || !params.nLoops)return null;
  const defaultHeat=job.kinds.includes('heat') && job.section.n==='z' && job.section.off===0 && job.section.rot===0 && job.size===14;
  if(!job.kinds.includes('field') && !defaultHeat)return null;
  const key=`r${params.radius}-l${params.length}`;
  let artifact=cache.get(key);
  if(!artifact) {
    const response=await fetch(new URL(`./precomputed/solenoid-v1/${key}.json.gz`,import.meta.url));
    if(!response.ok)throw new Error(`预计算资源加载失败 (${response.status})`);
    artifact=JSON.parse(new TextDecoder().decode(gunzipSync(new Uint8Array(await response.arrayBuffer()))));
    if(cache.size>=2)cache.delete(cache.keys().next().value);
    cache.set(key,artifact);
  }
  return materializeSolenoid(artifact,job);
}
