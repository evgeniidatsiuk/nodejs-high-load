# Architecture & scaling diagrams

System-design view of the eight approaches in this repo, and how each one scales.
All diagrams are [Mermaid](https://mermaid.js.org/) and render directly on GitHub.

It also lays out a 10-point blueprint for a high-load system: microservices,
load balancing, horizontal scaling, optimized networking/CDN, in-memory caching,
database optimization, performance optimization, asynchronous processing,
monitoring, and security. Section 8 draws that full blueprint and maps each point
to the runnable examples here.

**Notation:** rectangles = processes/threads · cylinders = datastores ·
solid arrows = request/data flow · dashed arrows = lifecycle or backpressure.
`req/s` and latency numbers are the measured results from the
[README](../README.md#measured-results) (Apple M4 Pro, 14 cores, Node 24).

---

## 0. The model & the problem — one event loop, one thread

Node runs your JavaScript on a **single** event-loop thread. I/O is offloaded to
libuv's pool, but **CPU work runs on that one thread** — and while it runs,
nothing else does. This is example [`01-blocking`](../src/01-blocking).

```mermaid
flowchart LR
    C1["Client A"] --> Q
    C2["Client B — /ping"] --> Q
    C3["Client C"] --> Q
    subgraph NODE["Node.js process · 1 core"]
        Q["Accept queue"] --> EL["Event loop<br/>single thread"]
        EL -->|"cheap route"| FAST["/ping → respond in µs"]
        EL -->|"CPU route"| BLOCK["/compute → countPrimes()<br/>BLOCKS the loop"]
    end
    BLOCK -.->|"B and C wait behind the CPU work"| Q
```

> Result: throughput capped at ~1 core (~795 req/s), and a trivial `/ping`
> stalls ~152 ms because it is stuck behind the CPU work.

---

## 1. Stay fair on one core — cooperative chunking

Same one thread, but the CPU work is sliced and `setImmediate` hands control back
between slices. It is **not faster**, but the loop is never monopolized, so other
requests stay responsive. Example [`02-nonblocking`](../src/02-nonblocking).

```mermaid
flowchart LR
    subgraph EL["Event loop · 1 thread"]
        direction LR
        S1["compute chunk"] -.->|"setImmediate: yield"| P1["serve /ping"]
        P1 -.-> S2["compute chunk"]
        S2 -.->|"yield"| P2["serve /ping"]
        P2 -.-> S3["compute chunk → done"]
    end
```

> Trade-off: fairness, not capacity. Great for keeping health checks/other
> requests alive; it does not add CPU throughput.

---

## 2. Vertical scale, processes — the cluster module

The primary process `fork()`s one worker **process** per core; all workers share
the listening socket and the kernel load-balances connections across them. A
blocked worker no longer blocks the others. Example [`03-cluster`](../src/03-cluster).

```mermaid
flowchart TB
    C["Clients"] --> LB["Shared socket :3000<br/>(kernel round-robins connections)"]
    subgraph HOST["1 host · 4 cores"]
        P["Primary process<br/>handles no requests"]
        W1["Worker · core 1<br/>own event loop"]
        W2["Worker · core 2<br/>own event loop"]
        W3["Worker · core 3<br/>own event loop"]
        W4["Worker · core 4<br/>own event loop"]
        P -.->|"fork ×4 · restart on crash"| W1 & W2 & W3 & W4
    end
    LB --> W1 & W2 & W3 & W4
```

> Result: ~2,879 req/s (~3.6× vs one core) and `/ping` under load drops to ~46 ms.
> Separate memory per worker; self-healing when a worker dies.

---

## 3. Vertical scale, threads — a worker pool

One process, but CPU tasks are posted to a pool of worker **threads**. The main
thread only accepts, routes, and responds, so its event loop stays free even when
every thread is busy. Example [`04-worker-threads`](../src/04-worker-threads).

```mermaid
flowchart LR
    C["Clients"] --> EL
    subgraph PROC["1 Node process (shared memory)"]
        EL["Main thread · event loop<br/>accept · route · respond"]
        EL -->|"post CPU task"| TQ["Task queue"]
        subgraph POOL["Worker-thread pool"]
            T1["Thread 1"]
            T2["Thread 2"]
            T3["Thread 3"]
            T4["Thread 4"]
        end
        TQ --> T1 & T2 & T3 & T4
        T1 & T2 & T3 & T4 -->|"result message"| EL
    end
```

> Result: ~2,742 req/s and `/ping` under load stays ~0 ms — the request loop is
> never blocked. **Cluster vs threads:** cluster = many processes (isolation,
> scale the whole app); worker pool = many threads in one process (shared memory,
> offload CPU from the request loop).

---

## 4. Async processing — enqueue now, process later

Don't do heavy work inside the request at all. The handler enqueues a job and
returns `202` immediately; a bounded set of background workers drains the queue
(here, the worker-thread pool from section 3). Clients poll for the result. This
decouples the throughput of *accepting* work from the throughput of *doing* it.
Example [`09-queue`](../src/09-queue) — the local, dependency-free analog of a
message queue (RabbitMQ / Kafka) with consumers.

```mermaid
flowchart LR
    C["Client"] -->|"1 · POST /jobs"| API["HTTP handler<br/>(event loop)"]
    API -.->|"2 · 202 Accepted (instant)"| C
    API -->|"enqueue"| Q["In-memory queue"]
    Q --> D["Dispatcher<br/>bounded concurrency"]
    subgraph POOL["Background workers (thread pool)"]
        T1["thread 1"]
        T2["thread 2"]
    end
    D --> T1 & T2
    T1 & T2 -->|"store result"| STORE[("Job store<br/>id → status / result")]
    C -->|"3 · GET /jobs/:id (poll)"| API
    API -->|"read"| STORE

    style STORE fill:#f6c85f,stroke:#8a6d1a,color:#000
```

> The catch: accept-rate ≠ process-rate. Enqueue is O(1), so the queue can accept
> far more than the workers can finish — `queue.depth` grows. In production you
> **bound the queue** (reject/apply backpressure when full) and **scale
> consumers**. The win is that a traffic spike no longer stalls the event loop;
> it just lengthens the queue.

---

## 5. Don't do the work twice — caching

A bounded LRU turns repeated/hot keys into µs responses. Misses still cost the
full compute (pair with cluster/threads); hits skip it entirely.
Example [`05-caching`](../src/05-caching).

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant Cache as LRU cache
    participant CPU as countPrimes()
    C->>S: GET /compute?n=90000
    S->>Cache: get(90000)
    alt cache hit
        Cache-->>S: value
        S-->>C: 200 · µs · loop stays free
    else cache miss
        Cache-->>S: (empty)
        S->>CPU: compute (expensive)
        CPU-->>S: value
        S->>Cache: set(90000), evict least-recently-used
        S-->>C: 200
    end
```

---

## 6. Bound memory under load — streaming

Buffering builds the whole response in RAM (O(N) per in-flight request → GC
pressure / OOM at scale). Streaming emits chunks with backpressure, so per-request
memory is ~flat. Example [`06-streaming`](../src/06-streaming).

```mermaid
flowchart LR
    subgraph BUF["/buffered · O(N) memory"]
        direction TB
        GB["build entire array in a Buffer"] --> RB["res.end(whole payload)"]
    end
    subgraph STR["/stream · O(1) memory"]
        direction TB
        GEN["generator yields rows"] -->|"chunk"| SOCK["socket → client"]
        SOCK -.->|"backpressure: pause when full"| GEN
    end
```

---

## 7. Framework overhead — raw http vs Express vs Fastify

Frameworks are **orthogonal** to the event-loop story (`/compute` blocks in all
three), but they differ on the per-request hot path. Measured on cheap `/ping`,
single process. Examples [`07-express`](../src/07-express) / [`08-fastify`](../src/08-fastify).

```mermaid
flowchart TB
    subgraph RAW["raw http · ~107k req/s"]
        direction LR
        R1["socket"] --> R2["handler"] --> R3["JSON.stringify"]
    end
    subgraph EXP["Express · ~66k req/s"]
        direction LR
        E1["socket"] --> E2["middleware chain"] --> E3["general router"] --> E4["res.json"]
    end
    subgraph FAST["Fastify · ~117k req/s"]
        direction LR
        F1["socket"] --> F2["radix router"] --> F3["schema-compiled serializer"]
    end
```

---

## 8. Putting it together — the full high-load blueprint

Combining all 10 points gives a full system-design topology. Here it is with each
point numbered, so you can see where the runnable examples in this repo fit and
where the rest is infrastructure.

```mermaid
flowchart TB
    U["Clients / Internet"]
    SEC["Edge security (10)<br/>auth · TLS · input validation · WAF"]
    CDN["CDN (4)<br/>cache static assets · TCP / keep-alive tuning"]
    LB["Load balancer (2)<br/>nginx / ALB · least-conn / consistent-hash"]

    U --> SEC --> CDN --> LB

    subgraph TIER["Horizontal scale (3) — N hosts / containers · k8s / serverless"]
        direction LR
        subgraph S1["Microservice A (1)"]
            E1["event loop (7)"] --> P1["worker-thread pool (7,8)"]
        end
        subgraph S2["Microservice B (1)"]
            E2["event loop (7)"] --> P2["worker-thread pool (7,8)"]
        end
    end

    LB --> S1
    LB --> S2

    CACHE["In-memory cache (5)<br/>Redis / Memcached"]
    Q["Message queue (8)<br/>RabbitMQ / Kafka"]
    BG["Background workers (8)"]
    DB[("Database (6)<br/>PostgreSQL / Mongo / Cassandra · sharded")]
    MON["Monitoring & alerting (9)<br/>Prometheus · Grafana · ELK"]

    S1 --> CACHE
    S2 --> CACHE
    S1 --> Q
    S2 --> Q
    Q --> BG
    BG --> DB
    CACHE --> DB
    S1 --> DB
    S2 --> DB

    MON -.->|"metrics · logs · traces"| TIER
    MON -.-> CACHE
    MON -.-> DB
    MON -.-> Q

    style CACHE fill:#f6c85f,stroke:#8a6d1a,color:#000
    style DB fill:#5aa9e6,stroke:#1d4e79,color:#000
    style Q fill:#c3aed6,stroke:#5b3a86,color:#000
```

### How the 10 points map to this repo

| # | High-load concern | In this repo | Runnable? |
|---|---------------|--------------|-----------|
| 1 | Application architecture (microservices) | each server is a small single-purpose service | ✅ all `src/*` |
| 2 | Load balancing | the kernel load-balancing the cluster's shared socket is the local analog | ◐ `03-cluster` |
| 3 | Horizontal scaling | shown in the topology; cluster is the single-host (vertical) analog | ○ diagram only |
| 4 | Optimized networking / CDN | infrastructure (nginx, CDN, TCP tuning) | ○ infra |
| 5 | In-memory caching | bounded LRU memoization | ✅ `05-caching` |
| 6 | Database optimization | infrastructure (indexes, sharding) | ○ infra |
| 7 | Performance optimization (don't block, stream) | blocking vs chunked vs cluster vs threads; streaming | ✅ `01,02,03,04,06,07,08` |
| 8 | Asynchronous processing (worker threads / queues) | worker-thread pool + an in-process job queue with background workers | ✅ `04-worker-threads`, `09-queue` |
| 9 | Monitoring & alerting | event-loop delay + memory via `/stats` (a mini version) | ✅ `common/stats.js` |
| 10 | Security & compliance | infrastructure (authn/z, TLS, validation) | ○ infra |

Legend: ✅ runnable & load-testable here · ◐ partial local analog · ○ diagram/infrastructure only.

---

## 9. The two axes of scaling

```mermaid
flowchart LR
    ONE["1 core<br/>~795 req/s<br/>/ping stalls 152 ms"]
    MANY["N cores · 1 host<br/>~2.9k req/s<br/>/ping ~0–46 ms"]
    MANY_HOSTS["M hosts × N cores<br/>~M × per-host<br/>behind a load balancer"]

    ONE -->|"VERTICAL — use all cores: cluster / worker threads"| MANY
    MANY -->|"HORIZONTAL — add hosts: load balancer"| MANY_HOSTS
```

| Axis | Mechanism | In this repo | Bounded by |
|------|-----------|--------------|-----------|
| Stay responsive | chunk work / async I/O | `02-nonblocking` | still 1 core |
| Vertical (cores) | cluster **or** worker threads | `03`, `04` | cores per host |
| Skip work | cache / memoize | `05` | hit rate, memory |
| Bound memory | stream with backpressure | `06` | — |
| Lower per-req cost | framework choice | `07`, `08` | app logic |
| Horizontal (hosts) | load balancer + stateless nodes | topology above | infra / shared state |
