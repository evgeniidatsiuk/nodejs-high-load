#!/usr/bin/env bash
# One-command benchmark: boot a server, load it, print event-loop stats, tear down.
#
#   bash load-tests/bench.sh blocking
#   bash load-tests/bench.sh cluster
#   N=100000 CONNECTIONS=50 DURATION=10 bash load-tests/bench.sh workers
#
# Valid targets: blocking nonblocking cluster workers caching streaming
set -euo pipefail

TARGET="${1:-blocking}"
PORT="${PORT:-3000}"
N="${N:-100000}"
CONNECTIONS="${CONNECTIONS:-50}"
DURATION="${DURATION:-10}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "$TARGET" in
  blocking)    SCRIPT="src/01-blocking/server.js" ;;
  nonblocking) SCRIPT="src/02-nonblocking/server.js" ;;
  cluster)     SCRIPT="src/03-cluster/server.js" ;;
  workers)     SCRIPT="src/04-worker-threads/server.js" ;;
  caching)     SCRIPT="src/05-caching/server.js" ;;
  streaming)   SCRIPT="src/06-streaming/server.js" ;;
  *) echo "unknown target: $TARGET"; exit 1 ;;
esac

echo "==> starting '$TARGET' on :$PORT"
PORT="$PORT" node "$SCRIPT" &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; wait $SERVER_PID 2>/dev/null || true' EXIT

# wait for the port to accept connections
for _ in $(seq 1 50); do
  if curl -sf "http://localhost:$PORT/ping" >/dev/null 2>&1; then break; fi
  sleep 0.1
done

echo "==> load: /compute?n=$N  (connections=$CONNECTIONS, ${DURATION}s)"
CONNECTIONS="$CONNECTIONS" DURATION="$DURATION" \
  node load-tests/autocannon.js "http://localhost:$PORT/compute?n=$N"

echo ""
echo "==> event-loop + memory stats after load:"
curl -s "http://localhost:$PORT/stats" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s),null,2)))'
echo ""
echo "==> done ('$TARGET')"
