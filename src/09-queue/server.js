'use strict';

// APPROACH 9 — ASYNC PROCESSING / JOB QUEUE (accept fast, process in background)
//
// Instead of doing heavy work inside the request (examples 1-4), the handler
// just ENQUEUES a job and returns 202 Accepted immediately. A bounded pool of
// background workers drains the queue and does the actual CPU work — here by
// reusing the worker-thread pool from example 4, so the main event loop is never
// blocked. Clients poll GET /jobs/<id> for the result.
//
// This is the local, dependency-free analog of a message queue (RabbitMQ/Kafka)
// with background consumers. The payoff: the throughput of ACCEPTING work is
// decoupled from the throughput of DOING it. Enqueue stays O(1) and fast no
// matter how heavy each job is; the work itself is smoothed out at a controlled
// concurrency so the machine is never overwhelmed.
//
//   POST /jobs?n=100000   -> 202 { id, status: "queued" }
//   GET  /jobs/<id>       -> { id, status, result, waitMs, runMs }
//   GET  /stats           -> event-loop delay + queue depth + counters
//
// Try:  CONCURRENCY=4 npm run start:queue

const http = require('http');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const { json, clampN, path: urlPath } = require('../common/http');
const { stats } = require('../common/stats');
const { WorkerPool } = require('../04-worker-threads/pool');

const PORT = process.env.PORT || 3000;
const CONCURRENCY = Number(process.env.CONCURRENCY) || os.availableParallelism?.() || os.cpus().length;
const MAX_JOBS = Number(process.env.MAX_JOBS) || 5000; // cap the in-memory history

// Background consumers = a worker-thread pool (reused from example 4), so the
// heavy work runs off the main thread.
const pool = new WorkerPool(CONCURRENCY, path.join(__dirname, '..', '04-worker-threads', 'worker.js'));

const jobs = new Map(); // id -> job
const queue = []; // ids waiting to be processed
let active = 0; // jobs currently being processed
let processed = 0; // lifetime completed counter

function enqueue(limit) {
  const id = randomUUID();
  const job = {
    id,
    limit,
    status: 'queued',
    result: null,
    enqueuedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
  };
  jobs.set(id, job);
  queue.push(id);
  evict();
  pump();
  return job;
}

// Keep memory bounded under load: drop the oldest FINISHED jobs first.
function evict() {
  if (jobs.size <= MAX_JOBS) return;
  for (const [id, job] of jobs) {
    if (jobs.size <= MAX_JOBS) break;
    if (job.status === 'done' || job.status === 'error') jobs.delete(id);
  }
}

// Pull jobs off the queue up to CONCURRENCY at a time.
function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const id = queue.shift();
    const job = jobs.get(id);
    if (!job) continue; // evicted before it got to run
    active++;
    job.status = 'processing';
    job.startedAt = Date.now();
    pool
      .run({ limit: job.limit })
      .then(({ primes }) => {
        job.status = 'done';
        job.result = primes;
      })
      .catch((err) => {
        job.status = 'error';
        job.error = err.message;
      })
      .finally(() => {
        job.finishedAt = Date.now();
        active--;
        processed++;
        pump();
      });
  }
}

const server = http.createServer((req, res) => {
  const p = urlPath(req);

  // Enqueue: returns immediately, does NOT wait for the work.
  if (req.method === 'POST' && p === '/jobs') {
    req.resume(); // drain any request body
    const n = clampN(new URL(req.url, 'http://localhost').searchParams.get('n'));
    const job = enqueue(n);
    return json(res, 202, { id: job.id, status: job.status, n });
  }

  // Poll for a job's result.
  if (req.method === 'GET' && p.startsWith('/jobs/')) {
    const id = p.slice('/jobs/'.length);
    const job = jobs.get(id);
    if (!job) return json(res, 404, { error: 'job not found (queued too long ago and evicted?)' });
    const waitMs = (job.startedAt ?? Date.now()) - job.enqueuedAt;
    const runMs = job.startedAt && job.finishedAt ? job.finishedAt - job.startedAt : null;
    return json(res, 200, { id: job.id, status: job.status, n: job.limit, result: job.result, waitMs, runMs });
  }

  if (p === '/stats') {
    return json(res, 200, {
      ...stats(),
      queue: { depth: queue.length, active, processed, tracked: jobs.size, concurrency: CONCURRENCY },
    });
  }
  if (p === '/ping') return json(res, 200, { ok: true, pid: process.pid });

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[09-queue]      pid=${process.pid}  concurrency=${CONCURRENCY}  http://localhost:${PORT}`);
});
