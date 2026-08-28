'use strict';

// Tiny shared HTTP helpers so each example can stay short and show only
// the part that actually differs between approaches.

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Read ?n= from the URL, clamped to a sane range so a load test can't ask
// for something that takes minutes.
function getN(req, def = 100000, max = 5_000_000) {
  const u = new URL(req.url, 'http://localhost');
  let n = parseInt(u.searchParams.get('n') ?? def, 10);
  if (!Number.isFinite(n) || n < 1) n = def;
  return Math.min(n, max);
}

function path(req) {
  return req.url.split('?')[0];
}

module.exports = { json, getN, path };
