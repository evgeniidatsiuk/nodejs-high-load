'use strict';

// APPROACH 4 — WORKER THREADS (offload CPU work, keep one server process)
//
// A single process, but heavy computation is dispatched to a pool of worker
// THREADS. The main thread only orchestrates: it accepts requests, hands the
// CPU work to the pool, and awaits the result. The event loop stays free, so
// /ping is instant even while every worker is busy crunching primes.
//
// Cluster vs worker threads:
//   - Cluster    = many PROCESSES (separate memory), great for scaling servers.
//   - Worker pool = many THREADS in ONE process (shared memory via
//                   SharedArrayBuffer), great for offloading CPU from the
//                   request-handling loop without running N copies of the app.
//
// Try:  POOL=4 npm run start:workers

const http = require('http');
const os = require('os');
const path = require('path');
const { json, getN, path: urlPath } = require('../common/http');
const { stats } = require('../common/stats');
const { WorkerPool } = require('./pool');

const PORT = process.env.PORT || 3000;
const POOL_SIZE = Number(process.env.POOL) || os.availableParallelism?.() || os.cpus().length;

const pool = new WorkerPool(POOL_SIZE, path.join(__dirname, 'worker.js'));

const server = http.createServer(async (req, res) => {
  switch (urlPath(req)) {
    case '/ping':
      return json(res, 200, { ok: true, pid: process.pid });
    case '/stats':
      return json(res, 200, { ...stats(), poolSize: POOL_SIZE });
    case '/compute': {
      const n = getN(req);
      try {
        const { primes, threadId } = await pool.run({ limit: n }); // off-thread
        return json(res, 200, { mode: 'worker-threads', n, primes, mainPid: process.pid, threadId });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }
    default:
      return json(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, () => {
  console.log(`[04-workers]    pid=${process.pid}  pool=${POOL_SIZE}  http://localhost:${PORT}`);
});
