'use strict';

// APPROACH 3 — CLUSTER (scale across CPU cores, process-per-core)
//
// The primary process forks N workers (default: one per core). Each worker is
// a full copy of the server with its OWN event loop, all sharing the same
// listening port — the OS/Node load-balances incoming connections across them.
//
// This is the classic way to turn a single-threaded runtime into something
// that uses the whole machine. CPU-bound throughput scales roughly linearly
// with core count, because a blocked worker no longer blocks the others.
//
// Try:  WORKERS=4 npm run start:cluster

const cluster = require('cluster');
const os = require('os');

if (cluster.isPrimary) {
  const workers = Number(process.env.WORKERS) || os.availableParallelism?.() || os.cpus().length;
  console.log(`[03-cluster]    primary pid=${process.pid} forking ${workers} workers`);
  for (let i = 0; i < workers; i++) cluster.fork();

  // Self-healing: if a worker crashes, replace it. A must-have in production.
  cluster.on('exit', (worker, code, signal) => {
    console.log(`[03-cluster]    worker pid=${worker.process.pid} died (${signal || code}); restarting`);
    cluster.fork();
  });
} else {
  // ---- worker: an ordinary (blocking) server, but now there are N of them ----
  const http = require('http');
  const { json, getN, path } = require('../common/http');
  const { stats } = require('../common/stats');
  const { countPrimes } = require('../common/work');

  const PORT = process.env.PORT || 3000;

  http
    .createServer((req, res) => {
      switch (path(req)) {
        case '/ping':
          return json(res, 200, { ok: true, pid: process.pid });
        case '/stats':
          return json(res, 200, stats());
        case '/compute': {
          const n = getN(req);
          const primes = countPrimes(n); // blocks THIS worker only
          return json(res, 200, { mode: 'cluster', n, primes, pid: process.pid });
        }
        default:
          return json(res, 404, { error: 'not found' });
      }
    })
    .listen(PORT, () => {
      console.log(`[03-cluster]    worker  pid=${process.pid}  listening :${PORT}`);
    });
}
