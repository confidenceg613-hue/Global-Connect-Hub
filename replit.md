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
  app/          React frontend (Vite dev server, artifact-declared port 23863)
  api-server/   Express API (port 8080)
  mobile/       Expo mobile app (artifact-declared port 18115)
  mockup-sandbox/  Canvas component preview server
lib/
  db/           Drizzle ORM schema and connection
  api-spec/     Shared Zod API schema
  api-client-react/  TanStack Query hooks
scripts/
  start-dev.sh  Legacy combined dev script — superseded by per-artifact workflows below, kept only for reference
  serve-app.mjs Production static file server + API proxy
```

## Running the app

As of 2026-07-14 this environment supports Replit's per-artifact/path-router workflow system. Each `artifacts/*/.replit-artifact/artifact.toml` is a real registered artifact with its own managed dev workflow (generated from the toml, not hand-configured):
- **`artifacts/app: web`** — Vite dev server on port 23863; path router proxies `/` to it.
- **`artifacts/api-server: API Server`** — Express API on port 8080; path router proxies `/api` to it.
- **`artifacts/mobile: expo`** — Expo dev server on port 18115; path router proxies `/mobile/` to it. Not started by default — start it if mobile preview is needed.
- **`artifacts/mockup-sandbox: Component Preview Server`** — canvas component previews; scaffolded/started on demand by the mockup-sandbox skill.

There is also a `Start application` workflow (`PORT=5000 pnpm --filter @workspace/app run dev`) that runs the Vite frontend on port 5000 — this is what the Replit webview preview uses. Restart both `Start application` and `artifacts/api-server: API Server` after code changes. The Vite dev server proxies `/api/*` to `localhost:8080`, so both must be running for the app to work. Do not start `scripts/start-dev.sh` directly as a workflow. If a stray process is ever left bound to 8080 or 5000, kill it before restarting.

Fresh environment setup is handled automatically by `scripts/post-merge.sh` (runs `pnpm install --frozen-lockfile` then `pnpm --filter db push`).

## Imported-project setup status

The imported workspace has been prepared for Replit:

- Dependencies are installed with `pnpm install --frozen-lockfile`.
- The development database schema has been applied with `pnpm --filter @workspace/db run push`.
- Use the **Start application** workflow for the browser preview. It starts the Vite app on port 5000 and API server on port 8080 together.
- The frontend and API production builds both pass.

The AI assistant, street-level imagery, and web-push delivery remain unavailable until their optional API keys/secrets are configured. The Expo mobile and Canvas preview workflows are intentionally separate and only need to be started when those previews are needed.

## Environment variables

Set in `.replit` shared env:
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
- **Admin routes** (`artifacts/api-server/src/routes/admin-codes.ts` + `admin-dashboard.ts`, gated by `x-admin-secret` header == `ADMIN_SECRET`): code management (`POST/GET /api/admin/codes`, `PATCH /api/admin/codes/:id/revoke`) plus the Admin HQ dashboard API (`POST /api/admin/login`, `GET /api/admin/overview`, `GET /api/admin/users/:userId/history`, `PATCH /api/admin/users/:userId/unlimited`, `POST /api/admin/users/:userId/revoke-access`, `POST /api/admin/users/:userId/reset-free-trial`, `POST /api/admin/messages`). Codes and user internals are never returned by any non-admin route.
- `subscription_codes.price_naira` records what a code was actually sold for (defaults to the standard bank-transfer price for normal codes, `null` for free/internal codes) so total revenue can be computed as `Σ priceNaira × redemptionCount`.
- Frontend paywall is fully wired: `AccessProvider`/`useAccess` (`artifacts/app/src/hooks/use-access.tsx`) calls `check-in` once per session, `ProtectedRoute` in `App.tsx` redirects to `/subscription` whenever `status.allowed` is false, and `artifacts/app/src/pages/subscription.tsx` shows payment info + a redeem-code form.
- **Admin HQ** (`artifacts/app/src/pages/admin.tsx`, route `/admin`, reachable via the "Admin HQ" key-icon card at the end of the landing page's feature list): password-gated (checked against `ADMIN_SECRET` server-side only — never hardcoded or shipped in frontend code) dashboard for Godwin to see every user (free trial vs subscribed vs unlimited), total revenue collected, per-user payment/redemption history, send a message that pins to a user's notifications (`notifications_log.pinned` + `type: "admin_message"`), grant/revoke unlimited access, reset a user's free trial, and manage subscription codes (create/revoke, with price).

## Database

Schema is managed with Drizzle ORM. To push schema changes to the dev database:
```bash
cd lib/db && pnpm run push
```

Tables: `users`, `assistant_messages`, `geo_videos`, `geo_photos`, `geofences`, `location_updates`, `location_type_overrides`, `location_type_reports`, `invites`, `consents`, `push_subscriptions`, `notifications_log`, `street_view_photos`

## Street View

The live map's Street View button resolves nearby crowdsourced imagery via Mapillary's free Graph API (`MAPILLARY_ACCESS_TOKEN` secret required). Every resolved location is saved permanently in the `street_view_photos` table (`artifacts/api-server/src/routes/maps.ts` → `GET /api/maps/street-view`), so repeat lookups near the same spot are served from the DB cache instead of calling Mapillary again.

## Setup notes

- On fresh imports, run `pnpm install` from the workspace root to install all dependencies before starting the app.
- After `pnpm install`, push the DB schema: `cd lib/db && pnpm run push`. This applies the Drizzle schema to the Replit-managed PostgreSQL instance.
- The `postgresql-16` Nix module in `.replit` is required for the Replit-managed PostgreSQL to be available — do not remove it.
- `artifacts/mockup-sandbox` has no `dev` script by default — it's scaffolded on demand by the mockup-sandbox skill when canvas prototyping is used, so its workflow showing `FINISHED` at rest is expected.

### Post-import setup performed (2026-07-28)
1. `pnpm install` — installed all 1107 workspace packages from the lockfile.
2. `cd lib/db && pnpm run push` — applied the full Drizzle schema to the PostgreSQL database.
3. `Start application` workflow restarted — Vite frontend on port 5000, API server on port 8080, both confirmed healthy.

### IP Target Locator — Best Estimate is now real-time IP only
The "Best Estimate" in the IP Target Locator (`/ip-lookup`) was changed to always use the live IP geolocation consensus (4 external APIs) instead of stored GPS data from PhoneLink contacts. This means searching an IP always reflects its current geolocation — not a contact's last recorded position.

### Ten-minute GPS sharing
- Every consent grant creates a server-enforced **10-minute** sharing session. The API rejects new location updates after the session expires, even if a client is still running.
- The consent web page displays the remaining session time and stops its browser GPS watcher when the ten minutes end. Browsers cannot reliably keep sharing after Chrome itself is removed from Android's recent apps; Android terminates the browser process.
- The native mobile app uses Android's visible foreground-location notification to keep sending updates while the user uses other apps for the same ten-minute window. This requires an installed native/development build and **Allow all the time** location permission; Expo Go cannot provide background location.

## User preferences

- Keep the existing monorepo structure and stack; do not restructure or migrate.
- After completing a fix, list remaining suggestions/gaps and ask (via a question) whether to work on them next — don't just leave it as a passive offer.
