---
    name: Path-router migration
    description: PhoneLink moved from a single combined "Start application" workflow to real per-artifact path-router workflows on 2026-07-14.
    ---

    - The repl environment was upgraded/re-imported into one that supports Replit's per-artifact/path-router system. Artifacts (app, api-server, mobile, mockup-sandbox) are now real, each with its own platform-managed dev workflow generated from its `artifact.toml` — not something to hand-configure via `configureWorkflow`.
    - The old combined `Start application` workflow (running `scripts/start-dev.sh`, vite on port 5000) was removed. Do not recreate it — restart the managed `artifacts/app: web` and `artifacts/api-server: API Server` workflows instead.
    - **Why this mattered:** right after the migration, stale processes from the old combined script were still holding ports 8080/5000/23863, so the new per-artifact workflows failed to bind and silently reported "finished" with no error — looked like a 502/proxy problem but was actually a leftover-process port conflict. Always check `lsof -i :<port>` / `ps aux` for stale processes bound to the artifact's declared port before assuming a platform-side issue when a freshly split-out per-artifact workflow won't come up.
    - The path-router's local proxy listens on `127.0.0.1:80` inside the container — use `port: 80` for appPreview screenshots on this project now, not 5000 (each artifact has its own internal port; 80 is the router that serves `/` per `previewPath`).
    