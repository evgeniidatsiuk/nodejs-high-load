'use strict';

// A deliberately CPU-bound workload we can dial up/down with `limit`.
// Counting primes is pure computation: no I/O, no way to "await" it away.
// This is the kind of work that blocks Node's single event-loop thread.

function isPrime(n) {
  if (n < 2) return false;
  if (n % 2 === 0) return n === 2;
  for (let j = 3; j * j <= n; j += 2) {
    if (n % j === 0) return false;
  }
  return true;
}

// Synchronous. Runs to completion on the calling thread and blocks
// everything else (other requests, timers, I/O callbacks) until it returns.
function countPrimes(limit) {
  let count = 0;
  for (let i = 2; i <= limit; i++) {
    if (isPrime(i)) count++;
  }
  return count;
}

// Same total work, sliced into chunks. Between chunks we hand control back to
// the event loop with setImmediate, so other requests/timers get a turn.
// NOTE: this does NOT make the CPU work faster or use more cores — it only
// keeps the process *responsive* while the work runs on the one thread.
function countPrimesChunked(limit, chunkSize = 5000) {
  return new Promise((resolve) => {
    let count = 0;
    let i = 2;
    function step() {
      const end = Math.min(i + chunkSize, limit + 1);
      for (; i < end; i++) {
        if (isPrime(i)) count++;
      }
      if (i <= limit) {
        setImmediate(step); // yield to the event loop, then continue
      } else {
        resolve(count);
      }
    }
    step();
  });
}

module.exports = { isPrime, countPrimes, countPrimesChunked };
