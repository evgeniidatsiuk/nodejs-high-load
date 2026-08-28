'use strict';

// APPROACH 7 — EXPRESS (the popular framework: ergonomic, but has overhead)
//
// Express is the most widely used Node web framework. It's convenient
// (routing, middleware, req.query, res.json) but every request passes through
// a middleware chain and a general-purpose router, which costs throughput on
// cheap endpoints. Compare its /ping req/sec against raw http and Fastify.
//
// Just as important: a framework does NOT save you from the event loop. The
// /compute handler below still blocks exactly like example 1 — frameworks are
// orthogonal to the blocking/cluster/worker-threads story. To scale this, you
// still reach for cluster (example 3) or worker threads (example 4).

const express = require('express');
const { stats } = require('../common/stats');
const { clampN } = require('../common/http');
const { countPrimes } = require('../common/work');

const PORT = process.env.PORT || 3000;
const app = express();

app.get('/ping', (req, res) => {
  res.json({ ok: true, pid: process.pid });
});

app.get('/stats', (req, res) => {
  res.json(stats());
});

app.get('/compute', (req, res) => {
  const n = clampN(req.query.n);
  const primes = countPrimes(n); // still blocks the event loop — see example 1
  res.json({ mode: 'express', n, primes, pid: process.pid });
});

app.use((req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, () => {
  console.log(`[07-express]    pid=${process.pid}  http://localhost:${PORT}`);
});
