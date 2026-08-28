'use strict';

const { Worker } = require('worker_threads');

// A minimal fixed-size worker pool. CPU work is posted to idle workers; if all
// are busy, tasks queue until one frees up. This keeps the MAIN thread's event
// loop free to accept connections and serve cheap routes while heavy work runs
// on separate threads.
class WorkerPool {
  constructor(size, workerPath) {
    this.size = size;
    this.workerPath = workerPath;
    this.idle = [];
    this.queue = [];
    for (let i = 0; i < size; i++) this._spawn();
  }

  _spawn() {
    const worker = new Worker(this.workerPath);
    worker.on('error', (err) => {
      // A worker crashed. Fail its in-flight job (if any) and replace it.
      if (worker._job) {
        worker._job.reject(err);
        worker._job = null;
      }
      this.idle = this.idle.filter((w) => w !== worker);
      this._spawn();
      this._drain();
    });
    this.idle.push(worker);
  }

  run(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._drain();
    });
  }

  _drain() {
    if (this.queue.length === 0 || this.idle.length === 0) return;
    const worker = this.idle.pop();
    const job = this.queue.shift();
    worker._job = job;

    const onMessage = (result) => {
      cleanup();
      worker._job = null;
      this.idle.push(worker);
      job.resolve(result);
      this._drain(); // pick up the next queued task
    };
    const cleanup = () => worker.off('message', onMessage);

    worker.once('message', onMessage);
    worker.postMessage(job.task);
  }
}

module.exports = { WorkerPool };
