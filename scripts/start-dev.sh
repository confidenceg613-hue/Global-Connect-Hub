#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Clean up the background API process when this script exits for any reason
cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    echo "[start-dev] Stopping API server (pid $API_PID)..."
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Release any stale processes on the ports we need (handle multiple PIDs)
for PORT_KILL in 5000 8080; do
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    echo "[start-dev] Releasing stale process on port $PORT_KILL (pid $pid)..."
    kill "$pid" 2>/dev/null || true
  done < <(lsof -ti :"$PORT_KILL" 2>/dev/null || true)
done
# Give released processes a moment to exit
sleep 1

# Build and start the API server in the background
echo "[start-dev] Building API server..."
cd "$ROOT/artifacts/api-server"
NODE_ENV=development pnpm run build

echo "[start-dev] Starting API server on port 8080..."
PORT=8080 NODE_ENV=development node --enable-source-maps ./dist/index.mjs &
API_PID=$!

# Wait for the API server to be ready (up to 15 seconds)
echo "[start-dev] Waiting for API server to be ready..."
for i in $(seq 1 15); do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "[start-dev] ERROR: API server process exited unexpectedly."
    exit 1
  fi
  if (echo >/dev/tcp/localhost/8080) 2>/dev/null; then
    echo "[start-dev] API server is ready."
    break
  fi
  sleep 1
done

# Start the Vite dev server in the foreground (port 5000)
echo "[start-dev] Starting Vite dev server on port 5000..."
cd "$ROOT/artifacts/app"
exec pnpm run dev
