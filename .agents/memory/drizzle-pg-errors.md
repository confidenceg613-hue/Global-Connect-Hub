---
name: Drizzle pg error codes
description: Where to find the underlying Postgres error code when a drizzle-orm (node-postgres driver) query throws.
---

`drizzle-orm`'s node-postgres driver wraps every failed query in a `DrizzleQueryError`, whose message is just `Failed query: ...`. The original `pg` error (with the Postgres error code like `23505` for unique-violation) is NOT on `err.code` — it's on `err.cause.code`.

**Why:** confirmed directly — catching `(err as any).code === "23505"` for a duplicate-key insert never matched and the raw error page leaked through Express; switching to `(err as any).cause?.code === "23505"` fixed it immediately.

**How to apply:** when catching errors from a drizzle `.insert()/.update()` call to branch on a specific Postgres error code (unique violation, FK violation, etc.), check `err.cause?.code` (falling back to `err.code` for safety) rather than assuming the pg error is unwrapped at the top level.
