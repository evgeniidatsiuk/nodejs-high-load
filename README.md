# High-Load Node.js — approaches you can load-test locally

Six small, self-contained HTTP servers, each demonstrating a different approach
to handling high load in Node.js — plus ready-to-run load tests (k6 **and** a
zero-install autocannon runner).

Inspired by the "Node.js and high load" series (event loop → blocking → cluster
→ worker threads), extended with caching and streaming.

All servers expose the **same routes** so you can swap one for another and
re-run the exact same load test:

| Route | What it does |
|-------|--------------|
| `GET /compute?n=100000` | CPU-bound work (counts primes ≤ n). The "load". |
| `GET /ping` | Trivial response. Shows whether the loop is responsive. |
| `GET /stats` | Event-loop delay percentiles + memory (`rssMB`) + pid. |

> **Event-loop delay** is the number to watch. It's how long the loop was stuck
> (usually on CPU work) before it could handle the next callback. Low = healthy,
> high = your process is blocked and every pending request is waiting.

---

## The six approaches

| # | Approach | Folder | Idea |
|---|----------|--------|------|
| 1 | **Blocking (baseline)** | `src/01-blocking` | Naive synchronous CPU work in the handler. Blocks everything. The anti-pattern. |
| 2 | **Non-blocking / chunked** | `src/02-nonblocking` | Slice CPU work and `setImmediate` between slices. Same speed, but stays *fair*. |
| 3 | **Cluster** | `src/03-cluster` | Fork one process per core; OS load-balances. Scales CPU throughput across cores. |
| 4 | **Worker threads** | `src/04-worker-threads` | One process, a pool of threads for CPU work. Main event loop stays free. |
| 5 | **Caching / memoization** | `src/05-caching` | Bounded LRU cache. The cheapest request is the one you never compute. |
| 6 | **Streaming** | `src/06-streaming` | Stream large responses with backpressure. Constant memory instead of buffering. |

---

## Quick start

```bash
npm install                 # installs autocannon (the only dependency)

# 1. Start one server (each listens on :3000, override with PORT=)
npm run start:blocking      # or :nonblocking :cluster :workers :caching :streaming

# 2. In another terminal, load it
npm run load                # hits /compute?n=100000 with 50 connections for 10s

# ...or one command that boots, loads, prints stats, and tears down:
bash load-tests/bench.sh blocking
bash load-tests/bench.sh cluster
```

Tune anything with env vars:

```bash
WORKERS=4 npm run start:cluster                       # cluster size
POOL=4    npm run start:workers                        # thread-pool size
N=250000 CONNECTIONS=100 DURATION=15 bash load-tests/bench.sh workers
```

---

## Load testing

### Option A — autocannon (no install, ships with `npm install`)

```bash
node load-tests/autocannon.js "http://localhost:3000/compute?n=100000"
CONNECTIONS=100 DURATION=15 node load-tests/autocannon.js http://localhost:3000/compute?n=100000
```

### Option B — k6 (install separately: `brew install k6`)

```bash
# raw throughput/latency of the CPU endpoint
BASE=http://localhost:3000 N=100000 k6 run load-tests/k6/compute.js

# THE blocking demo: hammer /compute while probing /ping — watch probe p95
BASE=http://localhost:3000 N=100000 k6 run load-tests/k6/ping-under-load.js
```

---

## Measured results

Numbers below are from this repo on a 14-core machine, `n=90000`, 50 connections,
8s, with cluster and worker pool both capped to **4** for an apples-to-apples
comparison. Run it yourself — your numbers will differ, the *shape* won't.

### Throughput & latency on `/compute`

| Approach (4-way) | req/sec | latency p50 | latency max | event-loop delay (mean) |
|------------------|--------:|------------:|------------:|------------------------:|
| Blocking (1 proc) | ~795 | 60 ms | 1574 ms | 53 ms |
| Cluster (4 proc)  | ~2879 | 15 ms | 106 ms | 30 ms |
| Worker threads (4)| ~2742 | 18 ms | 33 ms | 20 ms* |

\* ~20 ms is essentially the monitor's own resolution — the main thread was never
meaningfully blocked, because all CPU work ran on the worker threads.

**~3.6× throughput** and a **~15–45×** better tail latency just by using all cores.

### Fairness: `/ping` latency *while* `/compute` is under heavy load

| Approach | `/ping` avg | `/ping` max |
|----------|------------:|------------:|
| Blocking | 152 ms | 195 ms |
| Cluster (4) | 46 ms | 55 ms |
| Worker threads (4) | ~0 ms | ~0 ms |

This is the whole story in one table: on the blocking server a trivial health
check is stuck behind heavy CPU work. Worker threads keep the request loop
completely free; cluster spreads the pain across processes.

### Caching (`src/05-caching`)

Hit the same `n` twice: the first call computes (`"cached": false`), every
repeat returns instantly (`"cached": true`) with event-loop delay near zero.
Check `/stats` for `cache: { hits, misses }`.

### Streaming (`src/06-streaming`)

Compare memory (`rssMB` in `/stats`) under load:

```bash
node load-tests/autocannon.js "http://localhost:3000/buffered?rows=200000"   # buffers whole payload
node load-tests/autocannon.js "http://localhost:3000/stream?rows=200000"     # constant memory
```

---

## How to read each example

Every server is intentionally short and only the interesting part differs.
Shared helpers live in `src/common/`:

- `work.js` — the CPU workload (`countPrimes`, and the chunked variant).
- `stats.js` — event-loop delay monitor (`perf_hooks.monitorEventLoopDelay`).
- `http.js` — tiny JSON/url helpers.

## When to use which (rules of thumb)

- **Never** run long synchronous work (or `*Sync` fs/crypto) on the request path → example 1 shows why.
- **Chunk** work that must run in-process when you only need to stay responsive, not faster → example 2.
- **Cluster** to scale a mostly-I/O or mixed app across cores with zero code changes to handlers → example 3. Put it behind a real LB / use a process manager (PM2) in prod.
- **Worker threads** to offload CPU-heavy computation while keeping a single, shared-memory process → example 4.
- **Cache** hot/repeated results (in-memory, then Redis, then CDN/HTTP caching) → example 5.
- **Stream** anything large so per-request memory stays flat → example 6.
- In production you often **combine** them: cluster of processes, each offloading CPU to worker threads, fronted by a cache.
