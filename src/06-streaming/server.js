'use strict';

// APPROACH 6 — STREAMING (bound memory, don't buffer big responses)
//
// High load isn't only about CPU — it's also about memory. Building a large
// response in a string/Buffer means each concurrent request holds the WHOLE
// payload in RAM at once. With enough concurrency you OOM or trigger heavy GC.
//
// Streaming sends the payload in pieces with backpressure: Node only produces
// more data when the socket is ready for it, so per-request memory stays flat
// no matter how large the response.
//
// Compare, under load, the rssMB in /stats:
//   GET /buffered?rows=200000   -> builds the entire array in memory first
//   GET /stream?rows=200000     -> emits rows incrementally, constant memory

const http = require('http');
const { Readable } = require('stream');
const { json, path } = require('../common/http');
const { stats } = require('../common/stats');

const PORT = process.env.PORT || 3000;

function rowsCount(req, def = 200000, max = 5_000_000) {
  const u = new URL(req.url, 'http://localhost');
  let n = parseInt(u.searchParams.get('rows') ?? def, 10);
  if (!Number.isFinite(n) || n < 1) n = def;
  return Math.min(n, max);
}

function* generateRows(count) {
  yield '[';
  for (let i = 0; i < count; i++) {
    yield (i ? ',' : '') + JSON.stringify({ id: i, value: Math.sqrt(i) });
  }
  yield ']';
}

const server = http.createServer((req, res) => {
  const p = path(req);

  if (p === '/ping') return json(res, 200, { ok: true, pid: process.pid });
  if (p === '/stats') return json(res, 200, stats());

  if (p === '/buffered') {
    const count = rowsCount(req);
    let body = '['; // whole payload materialized in memory
    for (let i = 0; i < count; i++) {
      body += (i ? ',' : '') + JSON.stringify({ id: i, value: Math.sqrt(i) });
    }
    body += ']';
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(body);
  }

  if (p === '/stream') {
    const count = rowsCount(req);
    res.writeHead(200, { 'content-type': 'application/json' });
    // Readable.from(generator) honors backpressure automatically.
    return Readable.from(generateRows(count)).pipe(res);
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[06-streaming]  pid=${process.pid}  http://localhost:${PORT}`);
});
