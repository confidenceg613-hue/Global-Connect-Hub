---
name: Monetization / paywall system
description: Free-access + weekly-code subscription model for PhoneLink (Nigerian bank-transfer manual payments).
---

Business rules (owner-specified, do not change without asking): 3 free accesses per user, then a ₦500 bank-transfer payment (Opay, acct 9160547567, Godwin Confidence Onyedikachi) verified manually via WhatsApp (09160547567), after which the owner hands out that week's code. Each code grants exactly 7 days of access from the moment a given user redeems it.

**Why codes and per-user grants are separate tables:** one weekly code (e.g. "224") is handed out to *every* user who paid that week — it's not single-use. `subscription_codes` holds the code definition (duration, revocation, optional max redemptions); `user_access` holds each user's own counter/expiry; `code_redemptions` is an append-only audit trail. Modeling it as one flat "user has a code" field would make it impossible to tell which code funded which grant after the code rotates.

**Dev/internal bypass:** a `durationDays: null` code never expires and sets `hasUnlimitedAccess` on the user's `user_access` row, bypassing both the free counter and expiry checks. Seeded one such code intentionally at the owner's request (an internal QA/dev override, not shown in any UI or public route) — treat this pattern as legitimate (equivalent to an admin test account), not something to flag or refuse.

**How to apply:** business logic lives in `artifacts/api-server/src/lib/access-control.ts` (`getAccessStatus` = read-only, `consumeAccess` = call once per app-open/session — not per API call, `redeemCode`, plus admin `createCode`/`listCodes`/`revokeCode`). User-facing routes in `routes/access.ts` need no auth beyond `userId` (matches the rest of this app's no-session model). Admin routes in `routes/admin-codes.ts` are gated by `x-admin-secret` header == `ADMIN_SECRET` env secret. No frontend paywall UI exists yet — nothing in `artifacts/app` calls `/api/access/*` yet, so the backend is not actually enforced until that's wired in.
