---
name: Path-router vs combined workflow
description: Why the public dev domain can 502 while localhost works fine, when artifact.toml files are present.
---

When a project has `artifacts/*/.replit-artifact/artifact.toml` files (multi-artifact / imported full-stack project), the platform's public dev-domain proxy routes requests **by path** to each artifact's own declared `localPort` (from its `artifact.toml` `[[services]]` entry), not to whatever port a single combined dev-startup script happens to bind.

**Why:** A monorepo can have its own custom single-workflow dev script (e.g. `scripts/start-dev.sh`) that builds/starts an API server and a Vite frontend together on ports it picks itself (e.g. 5000 + 8080). If artifact.toml files also exist for those same services with *different* declared ports (e.g. app on 23863), the router uses the artifact.toml ports for external traffic. The combined workflow still answers fine on `localhost:<its own port>`, but the public `*.replit.dev` domain 502s because nothing is listening on the ports the router expects.

**How to apply:** If the public dev domain 502s while `curl localhost:<port>` succeeds, check for `artifact.toml` files under `artifacts/*/.replit-artifact/`. If present, remove the old combined workflow and instead start the per-artifact workflows (they read `[services.env]` / `[services.development].run` from artifact.toml and bind the exact ports the router expects). Only start the artifacts actually needed (e.g. skip mobile/mockup-sandbox if unused).
