---
name: PWA fullscreen — no requestFullscreen
description: Why we never call requestFullscreen() and how fullscreen is achieved instead.
---

## Rule
Never call `requestFullscreen()` (or any variant) programmatically in this app — not on mount, not on tap, not on any automatic trigger.

## Why
Calling it always shows the browser's native "To exit full screen, swipe up / press Esc" notification banner. This fires every single time the app launches and is jarring. The user explicitly complained about it.

## How to achieve fullscreen without the popup
1. **Manifest** — `"display": "fullscreen"` + `"display_override": ["fullscreen", "standalone", "minimal-ui"]` in manifest.json. Installed PWAs get real fullscreen with no notification.
2. **CSS** — `min-height: 100dvh` + `overflow-x: hidden` on html/body/root. Gives a visually full-screen experience for non-installed browser sessions.
3. **Orientation lock** — `screen.orientation.lock("portrait")` is fine (no visible banner).

## Where it still lives (intentional)
`live-map.tsx handleFullscreen` — this is triggered only by an explicit user button press ("enter fullscreen" icon on the map). That's fine; user-initiated fullscreen is expected to show the notification once.

## What was removed
`use-immersive-mode.ts` previously called `requestFullscreen()` on every mount and every touchstart/click, causing the popup on every page load. The hook now only calls `screen.orientation.lock("portrait")`.
