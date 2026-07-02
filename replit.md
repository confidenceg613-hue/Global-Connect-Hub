# PhoneLink

A real-time location tracking and safety platform. Users share location with trusted contacts, set geofences, trigger SOS alerts, and receive push notifications.

## Run & Operate

- API server workflow: `pnpm --filter @workspace/api-server run dev` (port 8080)
- Frontend workflow: `pnpm --filter @workspace/app run dev` (port from `$PORT` env, proxied to `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Required Environment

- `DATABASE_URL` — Postgres connection string (auto-injected by Replit)
- `VAPID_PUBLIC_KEY` — Web Push public key (set as env var)
- `VAPID_PRIVATE_KEY` — Web Push private key (stored as Replit Secret)
- `VAPID_SUBJECT` — Web Push contact email (set as env var)
- `PORT` — injected by Replit workflow per artifact
- `BASE_PATH` — injected by Replit workflow per artifact

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- API: Express 5 (port 8080 in dev)
- DB: PostgreSQL + Drizzle ORM (schema push via `drizzle-kit push`)
- Frontend: React + Vite, shadcn/ui, Leaflet maps, wouter routing, react-query
- Validation: Zod, drizzle-zod
- API codegen: Orval (from OpenAPI spec in `lib/api-spec/`)
- Push notifications: web-push (VAPID)
- Build: esbuild (API), Vite (frontend)

## Where things live

- `artifacts/api-server/src/routes/` — Express route handlers
- `artifacts/api-server/src/lib/notifications.ts` — push notification + DB logging (single source of truth)
- `artifacts/app/src/` — React frontend
- `lib/db/src/schema/` — Drizzle schema definitions (source of truth for DB shape)
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for API contract)
- `lib/api-client-react/` — generated React hooks from OpenAPI spec

## Architecture decisions

- Auth is localStorage-only (userId stored client-side); server endpoints must verify ownership explicitly — no session middleware.
- All push notifications go through `sendPushAndLog` in `notifications.ts`; never call `web-push` directly from routes.
- GeoBoard auto-captures 5 camera frames when a contact grants location consent; stored in `geo_photos` as base64 JPEG.
- Schema changes in dev are applied via `drizzle-kit push`; production schema is managed by Replit's Publish flow.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- `PORT` and `BASE_PATH` are injected by Replit workflows; the app will throw at startup if run outside that context without those vars set.
- VAPID keys were rotated on project setup — old keys in `.replit` history are compromised.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
