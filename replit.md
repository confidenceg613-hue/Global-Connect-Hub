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

This workspace re-import does not support Replit's per-artifact/path-router workflow system (this project's environment only registers a `mockup-sandbox` artifact type — `createArtifact` rejects `web`/`api`/`mobile` types here). The `artifacts/*/.replit-artifact/artifact.toml` files are kept for reference/documentation but nothing auto-registers them as live artifacts in this environment.

Instead, a single combined workflow runs everything:
- **`Start application`** — runs `scripts/start-dev.sh`, which builds and starts the API server in the background on port 8080, then runs the Vite dev server in the foreground on port 5000 (webview). Vite proxies `/api/*` to `localhost:8080`.

If this project is ever moved back into an environment that supports per-artifact workflows, switch back to the per-artifact setup described in git history and stop wiring `scripts/start-dev.sh` to a workflow directly, per the original design.

Mobile (`artifacts/mobile`, Expo) and the mockup sandbox are not started automatically — no workflow currently runs them. Ask if you need those.

## Environment variables

Set in `.replit` shared env:
- `PORT=5000` — Vite dev server port
- `BASE_PATH=/` — Vite base path
- `VAPID_PUBLIC_KEY` — Web push public key
- `VAPID_SUBJECT` — Web push contact email

Required secrets (add in Replit Secrets):
- `SESSION_SECRET` — Session signing secret
- `ADMIN_SECRET` — Shared secret for the `/api/admin/*` subscription-code management routes (sent as the `x-admin-secret` header). Never exposed to the app itself.

Optional secrets (features degrade gracefully without them):
- `VAPID_PRIVATE_KEY` — Web push private key; without it, push notifications are skipped (still logged to `notifications_log`) but nothing else breaks
- `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_VISION_MODEL` — AI assistant + screen vision (assistant returns 503 without it)
- `MISTRAL_API_KEY` — Mistral AI model
- `GROQ_API_KEY_1` / `GROQ_API_KEY_2` — Groq inference
- `GOOGLE_MAPS_API_KEY` — Maps integration
- `GOOGLE_MAPS_API_KEY` — Street View imagery via Google Street View Static + Embed APIs (unavailable without it)

Database (`DATABASE_URL`) is managed automatically by Replit.

## Monetization (subscription codes)

3 free accesses per user, then a paid weekly code is required. Backend lives entirely in `artifacts/api-server/src/lib/access-control.ts`.

- **Tables** (`lib/db/src/schema/`): `subscription_codes` (admin-managed codes; `duration_days: null` = never expires, reserved for internal/dev codes; `max_redemptions: null` = unlimited users per code), `user_access` (one row per user — free-access counter + current subscription expiry), `code_redemptions` (append-only audit log).
- **User-facing routes** (`artifacts/api-server/src/routes/access.ts`, no auth beyond `userId`, matching the rest of the app):
  - `GET /api/access/payment-info` — bank transfer details to show when paywalled.
  - `GET /api/access/:userId/status` — check access without consuming a free use.
  - `POST /api/access/:userId/check-in` — call once per app open/session; consumes one free access if no active subscription; returns 402 + payment details once free/paid access is exhausted.
  - `POST /api/access/:userId/redeem` — submit a code received after payment; 402 if invalid/revoked/exhausted.
- **Admin routes** (`artifacts/api-server/src/routes/admin-codes.ts`, gated by `x-admin-secret` header == `ADMIN_SECRET`): `POST /api/admin/codes`, `GET /api/admin/codes`, `PATCH /api/admin/codes/:id/revoke`. Codes are never returned by any non-admin route.
- Seeded codes already in the dev DB: `224`/`462`/`418` (7-day weekly codes, unlimited redemptions) and `419` (dev/internal bypass — unlimited duration, never displayed to users). Add more weekly codes via the admin API as new weeks start.
- Frontend paywall UI is not built yet — the app doesn't call `/api/access/*` anywhere. Next step to actually enforce this is wiring a check-in call + redeem-code screen into `artifacts/app`.

## Database

Schema is managed with Drizzle ORM. To push schema changes to the dev database:
```bash
cd lib/db && pnpm run push
```

Tables: `users`, `assistant_messages`, `geo_videos`, `geo_photos`, `geofences`, `location_updates`, `location_type_overrides`, `location_type_reports`, `invites`, `consents`, `push_subscriptions`, `notifications_log`, `street_view_photos`

## Street View

The live map's Street View button resolves nearby crowdsourced imagery via Mapillary's free Graph API (`MAPILLARY_ACCESS_TOKEN` secret required). Every resolved location is saved permanently in the `street_view_photos` table (`artifacts/api-server/src/routes/maps.ts` → `GET /api/maps/street-view`), so repeat lookups near the same spot are served from the DB cache instead of calling Mapillary again.

## Setup notes

- On fresh imports, `artifacts/mobile/package.json` needs `"main": "expo-router/entry"` (missing after import, which made Metro look for a non-existent classic `App.js` entry) plus `react-native-web` + `react-dom` as dependencies (needed for the Expo web bundle to build). Both are now committed.
- `artifacts/mockup-sandbox` has no `dev` script by default — it's scaffolded on demand by the mockup-sandbox skill when canvas prototyping is used, so its workflow showing `FINISHED` at rest is expected.

## User preferences

- Keep the existing monorepo structure and stack; do not restructure or migrate.
- After completing a fix, list remaining suggestions/gaps and ask (via a question) whether to work on them next — don't just leave it as a passive offer.
