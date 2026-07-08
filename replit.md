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

The workflow **Start application** runs `bash scripts/start-dev.sh`, which:
1. Builds the API server (`artifacts/api-server`)
2. Starts the API server on **port 8080** (`PORT=8080`)
3. Starts the Vite dev server on **port 5000** (proxies `/api` → `localhost:8080`)

The preview pane connects to port 5000.

## Environment variables

Set in `.replit` shared env:
- `PORT=5000` — Vite dev server port
- `BASE_PATH=/` — Vite base path
- `VAPID_PUBLIC_KEY` — Web push public key
- `VAPID_SUBJECT` — Web push contact email

Required secrets (add in Replit Secrets):
- `VAPID_PRIVATE_KEY` — Web push private key (push notifications)
- `SESSION_SECRET` — Session signing secret

Optional secrets (features degrade gracefully without them):
- `OPENAI_API_KEY` / `OPENAI_MODEL` / `OPENAI_VISION_MODEL` — AI assistant + screen vision
- `MISTRAL_API_KEY` — Mistral AI model
- `GROQ_API_KEY_1` / `GROQ_API_KEY_2` — Groq inference
- `GOOGLE_MAPS_API_KEY` — Maps integration

Database (`DATABASE_URL`) is managed automatically by Replit.

## Database

Schema is managed with Drizzle ORM. To push schema changes to the dev database:
```bash
cd lib/db && pnpm run push
```

Tables: `users`, `assistant-messages`, `geo-videos`, `geo-photos`, `geofences`, `location-updates`, `invites`, `consents`, `push-subscriptions`

## User preferences

- Keep the existing monorepo structure and stack; do not restructure or migrate.
