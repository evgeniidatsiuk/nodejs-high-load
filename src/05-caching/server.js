'use strict';

// APPROACH 5 — CACHING / MEMOIZATION (don't do the work twice)
//
// The cheapest request is the one you never compute. Here we memoize results
// in a bounded LRU cache. A cache MISS still runs the full CPU work (and, in
// this simple demo, still blocks — in production you'd combine caching with
// workers/cluster). A cache HIT returns in microseconds.
//
// This mirrors real high-load systems: response caches, memoized DB reads,
// Redis, HTTP caching headers/CDNs. Under repeated/hot keys, throughput jumps
// by orders of magnitude and event-loop delay stays near zero.

const http = require('http');
const { json, getN, path } = require('../common/http');
const { stats } = require('../common/stats');
const { countPrimes } = require('../common/work');

const PORT = process.env.PORT || 3000;
const MAX_ENTRIES = Number(process.env.CACHE_MAX) || 1000;

// Map preserves insertion order, which makes a tiny LRU trivial:
// re-insert on hit (moves key to newest), evict from the front when full.
const cache = new Map();
let hits = 0;
let misses = 0;

function memoizedCountPrimes(n) {
  if (cache.has(n)) {
    hits++;
    const v = cache.get(n);
    cache.delete(n);
    cache.set(n, v); // mark as most-recently-used
    return { value: v, cached: true };
  }
  misses++;
  const v = countPrimes(n);
  cache.set(n, v);
  if (cache.size > MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // evict least-recently-used
  }
  return { value: v, cached: false };
}

const server = http.createServer((req, res) => {
  switch (path(req)) {
    case '/ping':
      return json(res, 200, { ok: true, pid: process.pid });
    case '/stats':
      return json(res, 200, { ...stats(), cache: { size: cache.size, hits, misses } });
    case '/compute': {
      const n = getN(req);
      const { value, cached } = memoizedCountPrimes(n);
      return json(res, 200, { mode: 'caching', n, primes: value, cached, pid: process.pid });
    }
    default:
      return json(res, 404, { error: 'not found' });
  }
});

server.listen(PORT, () => {
  console.log(`[05-caching]    pid=${process.pid}  lru=${MAX_ENTRIES}  http://localhost:${PORT}`);
});
