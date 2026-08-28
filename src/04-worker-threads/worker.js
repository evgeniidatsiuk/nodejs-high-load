'use strict';

// Runs on a separate thread. It receives a task, does the CPU-bound work, and
// posts the result back. Because it's a different thread, this computation
// never touches the main event loop.
const { parentPort, threadId } = require('worker_threads');
const { countPrimes } = require('../common/work');

parentPort.on('message', (task) => {
  const primes = countPrimes(task.limit);
  // threadId (not pid): worker threads live inside the main process, so they
  // all share one PID but each has a distinct thread id.
  parentPort.postMessage({ primes, threadId });
});
