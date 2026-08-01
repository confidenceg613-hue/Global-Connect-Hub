---
name: Express route prefix
description: app.ts mounts the router at /api — route handlers inside must NOT repeat the prefix.
---

The api-server's `app.ts` does:
```typescript
app.use("/api", router);
```

Every route registered inside `artifacts/api-server/src/routes/*.ts` files is therefore already under `/api`. Write handlers as `/guardian/brief`, not `/api/guardian/brief`.

**Why:** A handler at `/api/guardian/brief` inside a router mounted at `/api` is actually reachable at `/api/api/guardian/brief` — Express returns its default HTML 404 (`Cannot GET …`), which looks identical to a missing-route error.

**How to apply:** Any new route file added to `routes/index.ts` must use paths without the `/api` prefix. Check existing routes (e.g. `sessions.ts`, `location.ts`) as the reference — they all omit `/api`.
