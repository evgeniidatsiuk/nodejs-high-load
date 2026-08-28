'use strict';

// APPROACH 1 — NAIVE / BLOCKING (the anti-pattern, the baseline)
//
// One process, one event-loop thread. The /compute handler runs a heavy CPU
// loop synchronously. While it runs, the thread can do NOTHING else: other
// /compute requests queue up, and even a trivial /ping is stuck behind them.
//
// Under load you will see: throughput capped at ~1 core, latency climbing
// without bound, and /stats reporting huge eventLoopDelay.

const http = require('http');
const { json, getN, path } = require('../common/http');
const { stats } = require('../common/stats');
const { countPrimes } = require('../common/work');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  switch (path(req)) {
    case '/ping':
      return json(res, 200, { ok: true, pid: process.pid });
    case '/stats':
      return json(res, 200, stats());
    case '/compute': {
      const n = getN(req);
      const primes = countPrimes(n); // <-- BLOCKS the whole event loop
      return json(res, 200, { mode: 'blocking', n, primes, pid: process.pid });
    }
    default:
      return json(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, () => {
  console.log(`[01-blocking]   pid=${process.pid}  http://localhost:${PORT}`);
});
