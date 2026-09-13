// Cancellation terminates a busy worker, so obsolete long calculations cannot
// delay the newest request. Idle workers are reused; no unbounded request queue.
export class ComputeClient {
  constructor(createWorker = () => new Worker(new URL('./field-worker.js', import.meta.url), {type:'module'})) {
    this.createWorker = createWorker;
    this.worker = null;
    this.pending = null;
    this.sequence = 0;
  }
  cancel() {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = null;
    clearTimeout(pending.timer);
    this.worker?.terminate();
    this.worker = null;
    pending.reject(new DOMException('计算已取消', 'AbortError'));
  }
  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
  run(job) {
    this.cancel();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      try {
        if (!this.worker) this.worker = this.createWorker();
        const worker = this.worker;
        const fail = error => {
          if (this.pending?.id !== id) return;
          clearTimeout(this.pending.timer);
          this.pending = null;
          worker.terminate();
          this.worker = null;
          reject(error);
        };
        this.pending = {id, resolve, reject, timer:setTimeout(() => fail(new Error('计算超时，请重试')), 30000)};
        worker.onmessage = ({data}) => {
          if (this.pending?.id !== id || data.id !== id) return;
          if (data.error) { fail(new Error(data.error)); return; }
          clearTimeout(this.pending.timer);
          this.pending = null;
          resolve(data.result);
        };
        worker.onerror = event => { event.preventDefault?.(); fail(new Error(event.message || '后台计算未能启动')); };
        worker.onmessageerror = () => fail(new Error('后台计算结果无法读取'));
        worker.postMessage({id,job});
      } catch (error) {
        if (this.pending) clearTimeout(this.pending.timer);
        this.pending = null;
        this.worker?.terminate();
        this.worker = null;
        reject(error);
      }
    });
  }
}

export function layerKeys(sceneId, params, section, size) {
  const model = JSON.stringify([sceneId, Object.entries(params).filter(([key]) => key !== 'density').sort()]);
  const field = JSON.stringify([model, params.density || null]);
  const slice = JSON.stringify([model, section.n, section.off, section.rot, size]);
  return {model, field, heat:slice, section:slice};
}
