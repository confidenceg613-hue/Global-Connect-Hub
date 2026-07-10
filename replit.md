# PhoneLink

A full-stack trust-first safety platform for real-time location intelligence. Contacts receive a link and grant granular consent for location sharing, camera captures, and push notifications — no app install required.

## Stack

- **Frontend**: React 19 + Vite 7, Tailwind CSS 4, Wouter routing, TanStack Query, Framer Motion, Radix UI, Lucide React
- **Backend**: Node.js + Express 5, Drizzle ORM, PostgreSQL
- **Mobile**: React Native / Expo (in `artifacts/mobile`)
- **Monorepo**: pnpm workspaces across `artifacts/` and `lib/`

## Project structure

```
artifacts/
  app/          React frontend (Vite dev server, port 5000)
  api-server/   Express API (port 8080)
  mobile/       Expo mobile app
lib/
  db/           Drizzle ORM schema and connection
  api-spec/     Shared Zod API schema
  api-client-react/  TanStack Query hooks
scripts/
  start-dev.sh  Dev startup script (builds api-server, starts both services)
  serve-app.mjs Production static file server + API proxy
```

## Running the app

A single `Start application` workflow runs `scripts/start-dev.sh`, which builds and starts the API server on port 8080, waits for it to be ready, then starts the Vite dev server on port 5000. `.replit` only maps port 5000 to the external/public domain (`[[ports]] localPort = 5000`), so port 5000 (proxied to `/api` on 8080 by Vite) is what's actually reachable — `artifact.toml` files exist under `artifacts/*/.replit-artifact/` declaring other ports (e.g. app on 23863), but since `.replit` doesn't expose those ports externally and this environment's workflow tooling doesn't support arbitrary ports, the combined single-workflow setup on port 5000 is the correct and verified one to use here.

## Environment variables

Set in `.replit` shared env:
- `PORT=5000` — Vite dev server port
- `BASE_PATH=/` — Vite base path
- `VAPID_PUBLIC_KEY` — Web push public key
- `VAPID_SUBJECT` — Web push contact email

Required secrets (add in Replit Secrets):
- `SESSION_SECRET` — Session signing secret

Optional secrets (features degrade gracefully without them):
- `VAPID_PRIVATE_KEY` — Web push private key; without it, push notifications are skipped (still logged to `notifications_log`) but nothing else breaks
- `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_VISION_MODEL` — AI assistant + screen vision (assistant returns 503 without it)
- `MISTRAL_API_KEY` — Mistral AI model
- `GROQ_API_KEY_1` / `GROQ_API_KEY_2` — Groq inference
- `GOOGLE_MAPS_API_KEY` — Maps integration
- `MAPILLARY_ACCESS_TOKEN` — Street View imagery (unavailable without it)

Database (`DATABASE_URL`) is managed automatically by Replit.

## Database

Schema is managed with Drizzle ORM. To push schema changes to the dev database:
```bash
cd lib/db && pnpm run push
```

Tables: `users`, `assistant_messages`, `geo_videos`, `geo_photos`, `geofences`, `location_updates`, `location_type_overrides`, `location_type_reports`, `invites`, `consents`, `push_subscriptions`, `notifications_log`, `street_view_photos`

## Street View

The live map's Street View button resolves nearby crowdsourced imagery via Mapillary's free Graph API (`MAPILLARY_ACCESS_TOKEN` secret required). Every resolved location is saved permanently in the `street_view_photos` table (`artifacts/api-server/src/routes/maps.ts` → `GET /api/maps/street-view`), so repeat lookups near the same spot are served from the DB cache instead of calling Mapillary again.

## User preferences

- Keep the existing monorepo structure and stack; do not restructure or migrate.
