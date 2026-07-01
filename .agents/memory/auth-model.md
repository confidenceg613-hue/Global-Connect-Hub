---
name: Auth model in PhoneLink
description: How userId identity currently works client- and server-side, and the security implication for any new endpoint.
---

`artifacts/app/src/hooks/use-auth.ts` is the entire auth model: it stores a plain integer `userId` in `localStorage` on "login" (phone registration), with no session token, no OTP/code verification, and no server-side session check. `userId` is just passed around as a request param/body field by the frontend.

**Why:** OTP verification was flagged early in the project as unresolved/never actually wired up — registration effectively just creates a user row and stores its id client-side.

**How to apply:** Any backend endpoint that mutates data tied to a user (resolve/dismiss actions, ownership-gated reads, etc.) must NOT trust a `userId` passed in the request body/params at face value for anything sensitive — but since there's no real session to check against, the practical mitigation used so far is: verify the `userId` matches the actual owner record in the DB (e.g. `invite.fromUserId`) before allowing the action, and treat `userId` in requests as an identity *claim* rather than an authenticated fact. Don't assume a "logged in" state implies real authentication when reasoning about security for this app.
