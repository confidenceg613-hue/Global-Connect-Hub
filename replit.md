# PhoneLink

A real-time location tracking and safety platform with trust-first consent management.

## Features
- Location sharing with trusted contacts
- Geofencing and SOS alerts
- Push notifications (Web Push / VAPID)
- Auto-capture camera frames (geo_photos) when location consent is granted
- International phone registration

## Stack
- **Monorepo**: pnpm workspaces
- **Backend**: Node.js 20, Express 5, esbuild
- **Frontend**: React 19, Vite 7, Tailwind CSS 4, wouter, react-query, shadcn/ui, Leaflet
- **Database**: PostgreSQL + Drizzle ORM
- **API**: OpenAPI spec-first (`lib/api-spec/openapi.yaml`), Orval codegen, Zod validation
- **Notifications**: web-push (VAPID)

## Running

Two services must be running:

| Service | Workflow | Port |
|---|---|---|
| API Server | `artifacts/api-server: API Server` | 8080 |
| Web App | `artifacts/app: web` | `$PORT` |

### First-time setup
```bash
pnpm install                          # install all workspace deps
pnpm --filter @workspace/db run push  # push schema to database
```

## Environment Variables / Secrets

| Key | Type | Notes |
|---|---|---|
| `DATABASE_URL` | Auto (Replit) | Injected automatically |
| `SESSION_SECRET` | Secret | Session signing |
| `VAPID_PUBLIC_KEY` | Env var | Web push public key |
| `VAPID_PRIVATE_KEY` | Secret | Web push private key |
| `VAPID_SUBJECT` | Env var | e.g. `mailto:admin@phonelink.app` |

## Auth Model
Auth is client-side only — `userId` is stored in `localStorage`. There is no server-side session verification. All endpoints should validate resource ownership server-side against the provided `userId`.

## Key Directories
- `artifacts/api-server/` — Express API server
- `artifacts/app/` — React web frontend
- `lib/db/` — Drizzle ORM schema and config
- `lib/api-spec/` — OpenAPI source of truth
- `scripts/` — workspace scripts

## User Preferences
- Max 2 responses per interaction; complete work within 10 seconds.
