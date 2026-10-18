// Worker와의 RPC. 문서 하나에 Worker 하나를 쓴다:
//  - 열기를 취소하거나 엔진이 죽어도(WASM trap) 이미 열린 문서의 Worker는 영향을 받지 않는다.
//  - 문서를 닫으면 Worker를 종료해 WASM 메모리를 통째로 돌려준다.
export class DocWorker {
  constructor({ workerUrl, wasmUrl }) {
    this.nextId = 1;
    this.pending = new Map();
    this.dead = false;
    this.listeners = new Map();
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.onmessage = (e) => this.#onMessage(e.data);
    this.worker.onerror = (e) => {
      e.preventDefault?.();
      this.#fail({ code: 'worker_failed', message: e.message || 'worker error' });
    };
    this.worker.onmessageerror = () => this.#fail({ code: 'worker_crashed', message: 'messageerror' });
    this.ready = this.request('init', { wasmUrl });
    this.ready.catch(() => {});
  }

  #onMessage(m) {
    if (m.type === 'progress') {
      this.pending.get(m.id)?.onProgress?.(m);
      return;
    }
    const p = this.pending.get(m.id);
    if (!p) return;
    this.pending.delete(m.id);
    if (m.ok) p.resolve(m);
    else {
      const err = Object.assign(new Error(m.error.message), m.error);
      if (m.error.fatal) this.dead = true; // WASM trap 뒤의 인스턴스는 믿을 수 없다
      p.reject(err);
    }
  }

  #fail(err) {
    this.dead = true;
    for (const p of this.pending.values()) p.reject(Object.assign(new Error(err.message), err));
    this.pending.clear();
  }

  request(type, payload = {}, transfer = [], onProgress) {
    if (this.dead) return Promise.reject(Object.assign(new Error('worker dead'), { code: 'worker_crashed' }));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.worker.postMessage({ type, id, ...payload }, transfer);
    });
  }

  /** 진행 중인 요청을 취소한다 (검색 등 협조적 취소가 가능한 것). */
  post(type, payload = {}) {
    if (!this.dead) this.worker.postMessage({ type, ...payload });
  }

  terminate() {
    this.dead = true;
    this.worker.terminate();
    for (const p of this.pending.values()) p.reject(Object.assign(new Error('terminated'), { code: 'cancelled' }));
    this.pending.clear();
  }
}
