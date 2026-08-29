// k6 load test — the async job queue (example 09).
//
//   BASE=http://localhost:3000 N=100000 k6 run load-tests/k6/queue.js
//
// Hammers POST /jobs (enqueue). The point: enqueue returns 202 in ~O(1) time no
// matter how heavy N is, because the work happens later in the background. The
// strict p95 threshold should PASS even for large N — contrast with running the
// same N synchronously on the blocking server.

import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 50 },
    { duration: '20s', target: 50 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = __ENV.BASE || 'http://localhost:3000';
const N = __ENV.N || '100000';

export default function () {
  const res = http.post(`${BASE}/jobs?n=${N}`);
  check(res, { 'status is 202': (r) => r.status === 202 });
}
