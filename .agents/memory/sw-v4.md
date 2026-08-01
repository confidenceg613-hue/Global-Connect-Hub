---
name: Service Worker v4 — caching, background sync, update notifications
description: What sw.js v4 does and the background sync pattern for offline GPS buffers.
---

## Cache strategy (sw.js v4)
- Cache names: `deepfalcon-shell-v4` (app shell) + `deepfalcon-assets-v4` (hashed JS/CSS).
- **`/assets/*`** — immutable Vite hashes → cache-first forever.
- **Static public files** (`.png`, `.jpg`, `.svg`, `.mp3`, etc.) → stale-while-revalidate.
- **Navigation (HTML)** → network-first, falls back to cached `/index.html`, then `/offline.html`.
- **`/api/*` and cross-origin** — never intercepted.
- When upgrading: old caches (anything not in the two v4 names) are deleted on activate.

## SW update notification
On `activate`, SW posts `{ type: 'SW_UPDATED' }` to all open clients.
`ServiceWorkerManager` in App.tsx listens for this and shows a toast with a "Reload" `ToastAction`.
Also checks `registration.waiting` on register (handles the case where the user had the app open during the SW update).
SKIP_WAITING is posted to the waiting SW when the user clicks Reload.

## Background sync — offline GPS buffer
Pattern (three-part):
1. **consent.tsx** — when `pushLocation` fails, it queues the point in `offlineBufferRef` + localStorage, then calls `navigator.serviceWorker.ready.then(reg => reg.sync.register('gps-buffer-flush'))`.
2. **sw.js** — `sync` event with tag `gps-buffer-flush` posts `{ type: 'FLUSH_OFFLINE_BUFFER' }` to all open window clients.
3. **consent.tsx** — SW message handler calls `flushOfflineBufferRef.current()` which drains the buffer via `/api/signals/ingest-batch`.

This means GPS points survive temporary network loss and are replayed even if the tab was suspended.

## GPS notification text
Body says "up to 6 h" (session cap raised from 10 min to 6 hours).
Notification icon updated to `/falcon-logo.png` (was `/favicon.svg`).

## Offline fallback page
`/offline.html` — fully self-contained HTML (no React, no external deps) matching app brand. Shows the shield logo, "OFFLINE MODE" badge, message about buffered data being safe, and a "Try Again" button.

## GPS session duration
`LOCATION_SHARING_DURATION_MS` in consent.tsx changed from `10 * 60 * 1000` to `6 * 60 * 60 * 1000`.
