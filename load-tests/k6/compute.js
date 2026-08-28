// k6 load test — raw throughput/latency of the CPU endpoint.
//
//   k6 run load-tests/k6/compute.js
//   BASE=http://localhost:3000 N=100000 k6 run load-tests/k6/compute.js
//
// Ramps to 50 virtual users, holds, then ramps down. The p95 threshold is
// intentionally strict so you can watch it PASS on cluster/workers and FAIL
// on the blocking server.

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '20s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:3000';
const N = __ENV.N || '100000';

export default function () {
  const res = http.get(`${BASE}/compute?n=${N}`);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
