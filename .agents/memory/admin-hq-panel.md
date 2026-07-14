---
    name: Admin HQ dashboard
    description: Password-gated admin panel added to PhoneLink for managing users/revenue/messaging; pattern for building admin auth safely.
    ---

    - The admin password is never present in any frontend source file. The client posts the entered password to `POST /api/admin/login`, which reuses the existing `requireAdmin` middleware (checks `x-admin-secret` header against the `ADMIN_SECRET` secret). The frontend keeps the password only in `sessionStorage` once entered, sent as a header on every subsequent admin call.
    - **Why:** the user asked for a hidden admin feature gated by a password that must never be visible/discoverable by regular users — the only way to guarantee that on a web frontend (whose JS bundle is always inspectable) is to never embed the secret in code and verify it server-side against an env secret.
    - Secret values entered via `requestSecrets` are exactly what the user typed into the secure form — case and all. If a user states a password in chat (e.g. "GODWIN2007") but behavior later doesn't match, check for a casing/typo mismatch between what they said and what they actually entered into the form; don't assume the auth code is broken.
    - Revenue tracking required adding a `price_naira` column to `subscription_codes` (nullable — null for free/dev codes) since the original schema only counted redemptions, not amounts. Total revenue = sum of `price_naira * redemption_count` across codes.
    - "Pin to notifications" was implemented as a boolean `pinned` column on `notifications_log` (plus a new `admin_message` type) rather than a separate table — the panel just sorts pinned rows first.
    