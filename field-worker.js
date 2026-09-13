import {computeJob, transferables} from './compute-job.js';
import {loadSolenoid} from './solenoid-cache.js';

self.onmessage = async ({data:{id, job}}) => {
  try {
    const started=performance.now();
    let cached=null;
    try {cached=await loadSolenoid(job);} catch(error) {console.warn(error.message);}
    const kinds=job.kinds.filter(kind=>!cached?.[kind]);
    const result = {...(cached || {}),...(kinds.length ? computeJob({...job,kinds}) : {})};
    result.computeMs=performance.now()-started;
    result.source=cached?'precomputed':'computed';
    self.postMessage({id, result}, transferables(result));
  } catch (error) {
    self.postMessage({id, error:error.message || String(error)});
  }
};
