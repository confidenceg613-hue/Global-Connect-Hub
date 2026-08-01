---
name: Timed GPS sharing
description: Ten-minute location-sharing rule across consent web sessions and the installed Expo app.
---

# Ten-minute location sharing

## The rule
Location sharing sessions last at most ten minutes. The server owns the expiry and rejects further updates after it; client timers only keep the user interface and device work aligned with that rule.

**Why:** Browser timers and native client processes can be delayed, suspended, or terminated. A client-only timer cannot be trusted to enforce consent duration.

**How to apply:** Any new GPS client must send a per-session token created by the consent-grant flow, never only the permanent invite token. Native Android background sharing is allowed only for the active session duration and must show a foreground-service notification. Web users must be told that dismissing Chrome stops browser-based tracking; use the installed app for background sharing.