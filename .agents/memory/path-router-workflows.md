---
name: Path-router vs combined workflow
description: How to decide between per-artifact workflows and a single combined workflow when artifact.toml files are present.
---

`artifact.toml` files live under `artifacts/*/.replit-artifact/` (a hidden directory) — a plain `find . -iname artifact.toml` can miss them if it excludes dotfiles/dirs; check that exact path before concluding they're absent.

Their presence does not by itself mean the public dev domain routes by path to each artifact's declared port. Treat `.replit`'s `[[ports]]` section as the runtime source of truth for what's externally reachable, and treat the artifact.toml ports as advisory only.

**Why:** a monorepo can have its own combined dev script (e.g. `scripts/start-dev.sh`) binding ports it picks itself, while artifact.toml files declare different per-service ports for a path-based router. Whether that router is actually active depends on the project's `.replit` port mappings and the workflow tooling's supported ports (webview mode only supports port 5000) — in practice this varies per project/session.

**How to apply:** if the public dev domain 502s while `curl localhost:<port>` succeeds, check `.replit`'s `[[ports]]` first. If only port 5000 is mapped externally (or the artifact's declared port isn't in the workflow tool's supported list), keep/use a single combined workflow serving on port 5000 — per-artifact workflows on unmapped or unsupported ports won't be reachable regardless of what artifact.toml declares. Only switch to per-artifact workflows when `.replit` actually maps each artifact's declared port externally.
