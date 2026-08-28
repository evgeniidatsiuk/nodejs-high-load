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

// Clamp a raw query value to a sane range so a load test can't ask for
// something that takes minutes.
function clampN(raw, def = 100000, max = 5_000_000) {
  let n = parseInt(raw ?? def, 10);
  if (!Number.isFinite(n) || n < 1) n = def;
  return Math.min(n, max);
}

// Read ?n= straight from a raw http.IncomingMessage (used by the built-in
// examples). Framework examples read req.query.n via clampN instead.
function getN(req, def = 100000, max = 5_000_000) {
  const u = new URL(req.url, 'http://localhost');
  return clampN(u.searchParams.get('n'), def, max);
}

function path(req) {
  return req.url.split('?')[0];
}

module.exports = { json, getN, clampN, path };
