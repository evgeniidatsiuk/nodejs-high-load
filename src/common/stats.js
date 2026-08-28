'use strict';

const { monitorEventLoopDelay } = require('perf_hooks');

// Event-loop delay is THE metric for high-load Node.js. It measures how long
// the loop was stuck (usually on CPU work) before it could service the next
// callback. Low = responsive. High = your process is blocked and every
// pending request is waiting behind whatever is hogging the thread.
const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();

const ms = (nanos) => +(nanos / 1e6).toFixed(2);

function stats() {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSec: +process.uptime().toFixed(0),
    eventLoopDelayMs: {
      mean: ms(h.mean),
      p50: ms(h.percentile(50)),
      p99: ms(h.percentile(99)),
      max: ms(h.max),
    },
    rssMB: +(mem.rss / 1048576).toFixed(1),
  };
}

module.exports = { stats, histogram: h };
