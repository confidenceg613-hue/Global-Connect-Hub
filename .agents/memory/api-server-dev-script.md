---
name: api-server dev script is build+run, not a watcher
description: Why editing api-server route/schema .ts files silently has no effect until the workflow is restarted
---

The `artifacts/api-server` package's `dev` script is `build && start` (esbuild to `dist/index.mjs`, then `node dist/index.mjs`) — it is a one-shot build, not a file watcher.

**Why:** Unlike the Vite frontend (which HMRs on save), editing a route, middleware, or schema `.ts` file under `artifacts/api-server/src` or `lib/db/src` has zero runtime effect until the workflow process is restarted and rebuilds. Trusting stdout silence or a stale "server running" log after an edit will make a working code change look broken (or a broken one look fine).

**How to apply:** After any edit touching `artifacts/api-server/src/**` or a `lib/db` schema consumed by it, restart the `artifacts/api-server: API Server` workflow before testing/curling the endpoint, and check the rebuild log for compile errors.
