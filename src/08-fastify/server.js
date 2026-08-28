'use strict';

// APPROACH 8 — FASTIFY (low-overhead framework built for throughput)
//
// Fastify keeps the same ergonomics as Express but is engineered for high
// load: a radix-tree router and, crucially, schema-based serialization
// (fast-json-stringify) that compiles a response schema into a specialized
// serializer instead of calling generic JSON.stringify. On cheap JSON
// endpoints this is noticeably faster than Express.
//
// Same caveat as example 7: the framework doesn't fix event-loop blocking.
// /compute still blocks; scale it with cluster or worker threads.

const Fastify = require('fastify');
const { stats } = require('../common/stats');
const { clampN } = require('../common/http');
const { countPrimes } = require('../common/work');

const PORT = process.env.PORT || 3000;
const app = Fastify({ logger: false });

// A response schema lets Fastify pre-compile a fast serializer for this route.
app.get(
  '/ping',
  {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: { ok: { type: 'boolean' }, pid: { type: 'integer' } },
        },
      },
    },
  },
  async () => ({ ok: true, pid: process.pid })
);

app.get('/stats', async () => stats());

app.get('/compute', async (req) => {
  const n = clampN(req.query.n);
  const primes = countPrimes(n); // still blocks the event loop — see example 1
  return { mode: 'fastify', n, primes, pid: process.pid };
});

app
  .listen({ port: PORT, host: '0.0.0.0' })
  .then(() => console.log(`[08-fastify]    pid=${process.pid}  http://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
