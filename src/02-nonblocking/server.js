'use strict';

// APPROACH 2 — NON-BLOCKING / COOPERATIVE (keep the loop responsive)
//
// Same single process, same one core — but the CPU work is sliced into chunks
// that yield to the event loop between slices (see countPrimesChunked).
//
// The lesson: this does NOT add CPU capacity. A single /compute takes about
// the same wall-clock time. What changes is FAIRNESS: /ping and other requests
// stay fast because the loop is never monopolized. Event-loop delay stays low.
//
// Rule of thumb this demonstrates: never run long synchronous work in a
// handler, and never use *Sync file/crypto calls on the request path.

const http = require('http');
const { json, getN, path } = require('../common/http');
const { stats } = require('../common/stats');
const { countPrimesChunked } = require('../common/work');

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  switch (path(req)) {
    case '/ping':
      return json(res, 200, { ok: true, pid: process.pid });
    case '/stats':
      return json(res, 200, stats());
    case '/compute': {
      const n = getN(req);
      const primes = await countPrimesChunked(n); // yields between chunks
      return json(res, 200, { mode: 'chunked', n, primes, pid: process.pid });
    }
    default:
      return json(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, () => {
  console.log(`[02-nonblocking] pid=${process.pid}  http://localhost:${PORT}`);
});
