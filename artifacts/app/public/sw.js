// DeepFalcon Service Worker — v4
// Strategies:
//   • Cache-first  → hashed /assets/* + static public files
//   • Network-first → HTML navigation with offline.html fallback
//   • Never cache  → /api/* (always live)
//   • Background Sync → GPS offline-buffer flush on reconnect
//   • Push + notification routing → unchanged

const CACHE_SHELL  = 'deepfalcon-shell-v4';  // bump on major layout changes
const CACHE_ASSETS = 'deepfalcon-assets-v4'; // Vite-hashed chunks — immutable
const OFFLINE_URL  = '/offline.html';

// App shell pre-cached on install — the minimal set needed to open the app
const PRECACHE = [
  '/',
  '/index.html',
  '/offline.html',
  '/manifest.json',
  '/falcon-logo.png',
  '/favicon.svg',
];

// ── Install: pre-cache app shell ─────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .finally(() => self.skipWaiting()),
  );
});

// ── Activate: purge stale caches + notify clients of update ──────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k !== CACHE_SHELL && k !== CACHE_ASSETS)
        .map(k => caches.delete(k)),
    );
    await self.clients.claim();
    // Tell all open tabs that a fresh version just took over
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
  })());
});

// ── Fetch routing ─────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept: API calls, cross-origin requests, non-GET
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Vite hashed chunks (/assets/…) — immutable, cache-first forever
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(hit => {
        if (hit) return hit;
        return fetch(request).then(res => {
          if (res.ok) caches.open(CACHE_ASSETS).then(c => c.put(request, res.clone()));
          return res;
        });
      }),
    );
    return;
  }

  // Static public files (icons, audio, images) — cache-first, update in background
  const STATIC_EXTS = ['.png','.jpg','.jpeg','.svg','.webp','.gif','.ico','.mp3','.woff2','.woff','.ttf','.otf'];
  if (STATIC_EXTS.some(e => url.pathname.endsWith(e)) || url.pathname === '/manifest.json') {
    event.respondWith(
      caches.match(request).then(hit => {
        const network = fetch(request).then(res => {
          if (res.ok) caches.open(CACHE_SHELL).then(c => c.put(request, res.clone()));
          return res;
        }).catch(() => hit);
        return hit || network;
      }),
    );
    return;
  }

  // HTML navigation — network-first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) caches.open(CACHE_SHELL).then(c => c.put(new Request('/index.html'), res.clone()));
          return res;
        })
        .catch(() =>
          caches.match('/index.html').then(r => r ||
          caches.match(OFFLINE_URL).then(r2 => r2 ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/html' } }))),
        ),
    );
    return;
  }
});

// ── Background Sync: offline GPS-buffer flush ─────────────────────────────────
// consent.tsx registers sync('gps-buffer-flush') when it queues an offline point.
// When the device reconnects (even if the tab is closed), this fires and wakes
// any open tab to drain the buffer.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'gps-buffer-flush') return;
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => clients.forEach(c => c.postMessage({ type: 'FLUSH_OFFLINE_BUFFER' }))),
  );
});

// ── Periodic Background Sync (future-ready) ───────────────────────────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'location-refresh') {
    // Placeholder — clients handle their own polling while open.
    // Future: wake tracking sessions and post a check-in here.
    event.waitUntil(Promise.resolve());
  }
});

// ── GPS tracking notification ─────────────────────────────────────────────────
const GPS_NOTIF_TAG = 'deepfalcon-gps-active';

self.addEventListener('message', (event) => {
  const { type, inviterName, expiresAt } = event.data ?? {};

  if (type === 'LOCATION_TRACKING_STARTED') {
    const name = inviterName || 'your contact';
    const duration = expiresAt ? ' · up to 6 h' : '';
    self.registration.showNotification('📍 GPS Active — DeepFalcon', {
      body: `Sharing live location with ${name}${duration}. Swipe to stop.`,
      icon: '/falcon-logo.png',
      badge: '/favicon.svg',
      tag: GPS_NOTIF_TAG,
      renotify: false,
      requireInteraction: true,
      silent: true,
      data: { type: 'gps_active' },
    });
    return;
  }

  if (type === 'LOCATION_TRACKING_STOPPED') {
    self.registration.getNotifications({ tag: GPS_NOTIF_TAG })
      .then(notifs => notifs.forEach(n => n.close()));
    return;
  }
});

// Swipe-dismiss GPS notification → stop tracking on all open tabs
self.addEventListener('notificationclose', (event) => {
  if (event.notification.tag !== GPS_NOTIF_TAG) return;
  self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then(clients => clients.forEach(c => c.postMessage({ type: 'STOP_TRACKING_FROM_NOTIFICATION' })));
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'DeepFalcon', body: event.data.text() }; }

  const title = payload.title ?? 'DeepFalcon';
  const type  = payload.data?.type ?? 'general';
  event.waitUntil(
    self.registration.showNotification(title, {
      body:               payload.body ?? '',
      icon:               '/falcon-logo.png',
      badge:              '/favicon.svg',
      tag:                payload.tag ?? type,
      data:               payload.data ?? {},
      requireInteraction: type === 'sos',
      vibrate:            type === 'sos' ? [400, 100, 400, 100, 400] : [200, 100, 200],
    }),
  );
});

// ── Notification click: deep link ─────────────────────────────────────────────
const LIVE_MAP_TYPES = new Set(['sos','geofence_enter','geofence_exit','location_offline','location_online','location_stale']);

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data ?? {};
  const type = data.type ?? 'general';

  if (type === 'gps_active') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        for (const c of clients) { if ('focus' in c) { c.focus(); return; } }
        return self.clients.openWindow?.('/dashboard');
      }),
    );
    return;
  }

  const targetPath = LIVE_MAP_TYPES.has(type) ? '/live-map' : '/dashboard';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const c of clients) {
        if ('focus' in c) {
          c.focus();
          c.postMessage({ type: 'NOTIFICATION_CLICK', notifType: type, data, targetPath });
          return;
        }
      }
      return self.clients.openWindow?.(targetPath);
    }),
  );
});
