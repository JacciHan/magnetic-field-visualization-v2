import test from 'node:test';
import assert from 'node:assert/strict';
import {ComputeClient,layerKeys} from '../compute-client.js';
class WorkerDouble {
  postMessage(message) {this.message=message;}
  terminate() {this.terminated=true;}
  respond(result) {this.onmessage({data:{id:this.message.id,result}});}
}
test('latest task cancels obsolete work and stale responses cannot replace it',async()=>{
  const workers=[];const client=new ComputeClient(()=>{const w=new WorkerDouble();workers.push(w);return w;});
  const a=client.run({radius:1});const rejected=assert.rejects(a,{name:'AbortError'});
  const b=client.run({radius:2});await rejected;
  assert.equal(workers[0].terminated,true);
  workers[0].respond('stale');workers[1].respond('latest');
  assert.equal(await b,'latest');client.dispose();
});
test('idle worker reuse and 50 cancel/retry cycles have no pending queue',async()=>{
  const workers=[];const client=new ComputeClient(()=>{const w=new WorkerDouble();workers.push(w);return w;});
  for(let i=0;i<50;i++) {
    const work=client.run(i);client.worker.respond(i);assert.equal(await work,i);
    assert.equal(client.pending,null);
  }
  assert.equal(workers.length,1);
  const pending=client.run('cancel');const rejection=assert.rejects(pending,{name:'AbortError'});
  client.dispose();await rejection;assert.equal(client.worker,null);
});
test('worker startup failure, runtime error and malformed message recover on retry',async()=>{
  let unavailable=true;
  const client=new ComputeClient(()=>{if(unavailable)throw new Error('unavailable');return new WorkerDouble();});
  await assert.rejects(client.run({}),/unavailable/);assert.equal(client.pending,null);
  unavailable=false;
  const a=client.run({});client.worker.onerror({message:'runtime failure'});await assert.rejects(a,/runtime failure/);
  const b=client.run({});client.worker.onmessageerror();await assert.rejects(b,/无法读取/);
  const c=client.run({});client.worker.respond('recovered');assert.equal(await c,'recovered');client.dispose();
});
test('cache invalidation includes all physics and section values but not presentation visibility',()=>{
  const P={current:50,radius:1.5,nLoops:160,length:5,direction:'正向',density:'丰富'},S={n:'z',off:0,rot:0,show:false,only:false};
  const base=layerKeys('solenoid',P,S,14);
  for(const [key,value] of Object.entries({current:60,radius:1.75,nLoops:300,length:8,direction:'反向'})) {
    const next=layerKeys('solenoid',{...P,[key]:value},S,14);
    for(const type of ['model','field','heat','section'])assert.notEqual(next[type],base[type]);
  }
  const density=layerKeys('solenoid',{...P,density:'清晰'},S,14);
  assert.notEqual(density.field,base.field);assert.equal(density.heat,base.heat);
  for(const nextS of [{...S,n:'y'},{...S,off:.4},{...S,rot:30}]) {
    const next=layerKeys('solenoid',P,nextS,14);
    assert.equal(next.field,base.field);assert.notEqual(next.heat,base.heat);assert.notEqual(next.section,base.section);
  }
  assert.deepEqual(layerKeys('solenoid',P,{...S,show:true,only:true},14),base);
});
