/**
 * The invitee's "grant location" step, shared by both routes that serve it:
 *   POST /api/invites/by-token/:token/grant   (dynamic — Node/Express installs)
 *   POST /api/grant                           (flat — static serverless hosts)
 *
 * Keeping one implementation means the two paths can never drift: the same
 * session is created, the invite flips to `accepted`, and the sender gets the
 * notification no matter which URL the consent page reaches first.
 */
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
import { db, invitesTable, inviteSessionsTable } from "@workspace/db";
import { sendPushAndLog } from "./notifications.js";

// One sharing session per granted click; expires 10 minutes after the grant.
export const LOCATION_SHARING_DURATION_MS = 10 * 60 * 1000;

function shortToken(): string {
  return randomBytes(6).toString("base64url"); // 8 URL-safe chars
}

export type GrantResult = {
  invite: typeof invitesTable.$inferSelect;
  session: typeof inviteSessionsTable.$inferSelect;
  isFirstGrant: boolean;
};

/** Returns null when no invite carries this token. */
export async function grantLocationConsent(input: {
  token: string;
  latitude: number;
  longitude: number;
  address?: string;
  grantedIp: string;
}): Promise<GrantResult | null> {
  const [existing] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, input.token));

  if (!existing) return null;

  const isFirstGrant = existing.status !== "accepted";

  const [session] = await db
    .insert(inviteSessionsTable)
    .values({
      inviteToken: input.token,
      sessionToken: shortToken(),
      grantedAt: new Date(),
      expiresAt: new Date(Date.now() + LOCATION_SHARING_DURATION_MS),
      grantedLatitude: input.latitude,
      grantedLongitude: input.longitude,
      grantedAddress: input.address,
      grantedIp: input.grantedIp,
      status: "active",
    })
    .returning();

  // Update the invite's top-level grant fields (first time only — keep the
  // "first seen" snapshot).
  const [updated] = await db
    .update(invitesTable)
    .set({
      status: "accepted",
      grantedIp: input.grantedIp,
      ...(isFirstGrant
        ? {
            grantedLatitude: input.latitude,
            grantedLongitude: input.longitude,
            grantedAddress: input.address,
            grantedAt: new Date(),
          }
        : {}),
    })
    .where(eq(invitesTable.token, input.token))
    .returning();

  // Notify the sender on EVERY new session so they know the link was clicked again
  sendPushAndLog(existing.fromUserId, {
    type: "grant",
    title: isFirstGrant ? "✅ Location access granted" : "🔄 New sharing session started",
    body: `${existing.toName ?? existing.toPhone} just shared their live location${isFirstGrant ? "" : " again"}`,
    tag: `granted-${session.id}`,
    data: {
      inviteId: existing.id,
      sessionId: session.id,
      contactName: existing.toName ?? existing.toPhone,
    },
  }).catch(() => {});

  return { invite: updated, session, isFirstGrant };
}
