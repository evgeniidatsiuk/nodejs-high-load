// k6 load test — THE event-loop-blocking demo.
//
//   BASE=http://localhost:3000 N=100000 k6 run load-tests/k6/ping-under-load.js
//
// Two scenarios run at the same time:
//   * load  — 20 VUs continuously hitting the heavy /compute endpoint
//   * probe — a steady 5 req/s hitting the trivial /ping endpoint
//
// The interesting metric is the p95 latency of the PROBE (tagged scenario:probe).
//   - Blocking server:      /ping p95 is huge — it's stuck behind CPU work.
//   - Cluster/worker-threads:/ping p95 stays tiny — the loop is never blocked.

import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE || 'http://localhost:3000';
const N = __ENV.N || '100000';

export const options = {
  scenarios: {
    load: {
      executor: 'constant-vus',
      vus: 20,
      duration: '30s',
      exec: 'compute',
    },
    probe: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '30s',
      preAllocatedVUs: 20,
      exec: 'ping',
    },
  },
  thresholds: {
    // How responsive did the cheap endpoint stay while the server was busy?
    'http_req_duration{scenario:probe}': ['p(95)<100'],
  },
};

export function compute() {
  http.get(`${BASE}/compute?n=${N}`);
}

export function ping() {
  const res = http.get(`${BASE}/ping`);
  check(res, { 'ping ok': (r) => r.status === 200 });
}
