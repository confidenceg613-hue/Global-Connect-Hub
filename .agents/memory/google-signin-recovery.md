---
name: Google Sign-In as account recovery
description: Why PhoneLink added Google Sign-In and the account-merge rules used for linking/unlinking.
---

PhoneLink's invites/notifications/settings already persist server-side keyed by `userId`; the actual gap Google Sign-In closes is *rediscovering* `userId` after a reinstall or device switch, not new persistence. Implemented with Google Identity Services (frontend) + `google-auth-library` ID-token verification (backend) — no OAuth client secret needed, just `GOOGLE_CLIENT_ID` (backend) / `VITE_GOOGLE_CLIENT_ID` (frontend), both set to the same public client ID value.

**Whyःdesign choices:**
- Kept the existing localStorage-only `useAuth` (see `auth-model.md`) instead of building a session/cookie layer — bigger change than requested, and this app's endpoints already treat `userId` as a claim, not an authenticated fact.
- `usersTable` phone columns were made nullable to allow genuine Google-only sign-up; any code deriving `fullPhone` from `countryCode`/`phoneNumber` must guard against both being null (previously assumed always present).
- Link/unlink rules: linking to a Google identity already tied to a *different account with a phone number* is rejected (409, no silent merge of real data); linking to an empty "shell" account (Google-only, never added a phone) deletes the shell and attaches Google to the current account instead, done inside a DB transaction to avoid a delete/update race. Disconnecting Google is blocked unless the account has a phone number, to avoid orphaning it with no login method.

**How to apply:** If you touch `usersTable` phone fields or the Google link/unlink routes again, re-check both the transaction wrapping and the null-guard on `fullPhone` derivation — a prior review caught both broken in the first draft.
