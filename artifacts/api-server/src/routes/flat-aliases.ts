/**
 * Flat single-segment aliases for the most critical mobile-web flows.
 *
 * The static serverless host in production can only execute Python functions
 * at exact paths (api/invite.py, api/user.py, api/notifications.py), so the
 * app already targets these flat paths first. Express serves the identical
 * contracts here so the same flat URLs work in dev previews and any Node
 * hosting — no behavior differences between environments.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, invitesTable, usersTable } from "@workspace/db";
import { GetInviteResponse } from "@workspace/api-zod";
import { grantLocationConsent } from "../lib/grant-consent.js";
import { getClientIp } from "../lib/request-ip.js";

const router: IRouter = Router();

// GET /api/invite?token=… → InvitePublic (same shape as /invites/by-token/:token)
router.get("/invite", async (req, res): Promise<void> => {
  const token = String(req.query.token ?? "");
  if (!token) {
    res.status(400).json({ error: "token is required" });
    return;
  }
  try {
    const [row] = await db
      .select({
        token: invitesTable.token,
        status: invitesTable.status,
        consentType: invitesTable.consentType,
        grantedLatitude: invitesTable.grantedLatitude,
        grantedLongitude: invitesTable.grantedLongitude,
        grantedAt: invitesTable.grantedAt,
        fromUserName: usersTable.name,
      })
      .from(invitesTable)
      .leftJoin(usersTable, eq(usersTable.id, invitesTable.fromUserId))
      .where(eq(invitesTable.token, token))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }
    res.json({
      token: row.token,
      fromUserName: row.fromUserName ?? "",
      status: row.status,
      consentType: row.consentType,
      grantedLatitude: row.grantedLatitude,
      grantedLongitude: row.grantedLongitude,
      grantedAt: row.grantedAt,
    });
  } catch (err) {
    // Fail soft: let the consent page render for this token.
    res.json({ token, fromUserName: "", status: "pending" });
  }
});

// POST /api/grant → the invitee's grant, with the token in the body. The
// consent page calls this first because a static serverless host can only
// execute Python functions at exact paths (a dynamic
// /invites/by-token/:token/grant 405s there).
router.post("/grant", async (req, res): Promise<void> => {
  const body = req.body as
    | { token?: unknown; latitude?: unknown; longitude?: unknown; address?: unknown }
    | undefined;
  const token = typeof body?.token === "string" ? body.token : "";
  const latitude = Number(body?.latitude);
  const longitude = Number(body?.longitude);

  if (!token || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    res.status(400).json({ error: "token, latitude and longitude are required" });
    return;
  }

  try {
    const result = await grantLocationConsent({
      token,
      latitude,
      longitude,
      address: typeof body?.address === "string" ? body.address : undefined,
      grantedIp: getClientIp(req),
    });

    if (!result) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    res.json({
      ...GetInviteResponse.parse(result.invite),
      sessionToken: result.session.sessionToken,
      expiresAt: result.session.expiresAt,
    });
  } catch (err) {
    console.error("[grant] failed:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: "Failed to record consent" });
  }
});

export default router;
