import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { OAuth2Client } from "google-auth-library";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const client = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

async function verifyGoogleIdToken(idToken: string) {
  if (!client || !GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the server");
  }
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Invalid Google token payload");
  }
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    picture: payload.picture ?? null,
  };
}

// POST /api/auth/google
// Body: { idToken: string, currentUserId?: number }
// - No currentUserId: fresh sign-in. Restores the existing account linked to
//   this Google identity, or creates a brand-new (phone-less) account.
// - currentUserId provided: links the signed-in phone account to Google.
router.post("/auth/google", async (req, res): Promise<void> => {
  const { idToken, currentUserId } = req.body ?? {};
  if (!idToken || typeof idToken !== "string") {
    res.status(400).json({ error: "idToken is required" });
    return;
  }

  let profile;
  try {
    profile = await verifyGoogleIdToken(idToken);
  } catch (err: any) {
    res.status(401).json({ error: err?.message ?? "Invalid Google token" });
    return;
  }

  const [linkedUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.googleId, profile.googleId));

  // Linking flow: an already-authenticated (phone) user wants to attach Google.
  if (typeof currentUserId === "number") {
    const [currentUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, currentUserId));

    if (!currentUser) {
      res.status(404).json({ error: "Current user not found" });
      return;
    }

    if (linkedUser && linkedUser.id !== currentUser.id && linkedUser.phoneNumber) {
      // The Google account is already tied to a different, real account —
      // never silently merge real user data.
      res.status(409).json({
        error: "This Google account is already connected to a different PhoneLink account.",
      });
      return;
    }

    // Delete the empty "shell" account (if any) and attach Google to the
    // current account atomically, so a failure partway through can't drop
    // the shell without the link succeeding (or vice versa).
    const updated = await db.transaction(async (tx) => {
      if (linkedUser && linkedUser.id !== currentUser.id) {
        await tx.delete(usersTable).where(eq(usersTable.id, linkedUser.id));
      }
      const [row] = await tx
        .update(usersTable)
        .set({
          googleId: profile.googleId,
          googleEmail: profile.email,
          googleName: profile.name,
          googlePicture: profile.picture,
          updatedAt: new Date(),
        })
        .where(eq(usersTable.id, currentUser.id))
        .returning();
      return row;
    });

    res.json({ user: updated, isNewAccount: false });
    return;
  }

  // Fresh sign-in flow (no local account yet on this device).
  if (linkedUser) {
    res.json({ user: linkedUser, isNewAccount: false });
    return;
  }

  const [created] = await db
    .insert(usersTable)
    .values({
      name: profile.name,
      googleId: profile.googleId,
      googleEmail: profile.email,
      googleName: profile.name,
      googlePicture: profile.picture,
    })
    .returning();

  res.status(201).json({ user: created, isNewAccount: true });
});

// DELETE /api/auth/google/:userId — disconnect Google from an account.
router.delete("/auth/google/:userId", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (!user.phoneNumber) {
    res.status(400).json({
      error: "Add a phone number before disconnecting Google, or you'll lose access to this account.",
    });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({
      googleId: null,
      googleEmail: null,
      googleName: null,
      googlePicture: null,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId))
    .returning();

  res.json({ user: updated });
});

export default router;
