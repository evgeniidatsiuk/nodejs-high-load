'use strict';

// Zero-install load test (autocannon is an npm devDependency, pure Node).
//
// Usage:
//   node load-tests/autocannon.js [url]
//   CONNECTIONS=100 DURATION=15 node load-tests/autocannon.js http://localhost:3000/compute?n=100000
//
// It hammers `url` with `CONNECTIONS` concurrent connections for `DURATION`
// seconds and prints requests/sec + latency percentiles.

const autocannon = require('autocannon');

const url = process.argv[2] || 'http://localhost:3000/compute?n=100000';
const connections = Number(process.env.CONNECTIONS) || 50;
const duration = Number(process.env.DURATION) || 10;

console.log(`\nLoad testing: ${url}`);
console.log(`connections=${connections}  duration=${duration}s\n`);

const instance = autocannon({ url, connections, duration }, (err, result) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log('\n--- summary ---');
  console.log(`req/sec (avg):   ${result.requests.average.toFixed(1)}`);
  console.log(`latency ms p50:  ${result.latency.p50}`);
  console.log(`latency ms p97.5:${result.latency.p97_5}`);
  console.log(`latency ms max:  ${result.latency.max}`);
  console.log(`2xx responses:   ${result['2xx']}`);
  console.log(`non-2xx:         ${result.non2xx}`);
});

autocannon.track(instance, { renderProgressBar: true });
