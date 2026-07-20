---
name: Guardian Brief feature
description: AI-generated natural-language situation reports per tracked contact, powered by Mistral.
---

## What it does
For every accepted invite, fetches the latest `location_updates` row and calls Mistral to generate a 2–3 sentence human-readable situation report plus a risk level (`safe` / `warning` / `alert`).

## Files
- `artifacts/api-server/src/routes/guardian.ts` — backend route
- `artifacts/app/src/pages/guardian.tsx` — full-page UI at `/guardian`
- Dashboard quick-action "Guardian Brief" → `/guardian` (replaces old "Activity" slot)

## API
`GET /api/guardian/brief?userId=X`
Returns `{ results: [{ token, name, brief, risk, lat, lng, address, battery, batteryCharging, activity, accuracy, minutesSincePing }] }`.

## Data flow
1. Query all `status = 'accepted'` invites for userId
2. For each token, get latest row from `locationUpdatesTable` (ordered by `createdAt DESC`)
3. Build Mistral prompt with telemetry; parse JSON response `{ brief, risk }`
4. Fallback brief generated locally if Mistral is unavailable

## Frontend behaviour
- Auto-refreshes every 45 seconds with a visible countdown
- Shows "GENERATING" state while AI call is in flight
- Anomaly banner appears if any contact is `warning` or `alert`
- Empty state links to `/invites` to send first invite
