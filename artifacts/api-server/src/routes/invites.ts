import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { randomBytes } from "crypto";

/** Extract the real client IP, respecting common proxy headers. */
function getClientIp(req: import("express").Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd)) return fwd[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

/** Fire-and-forget ip-api.com lookup. Returns null on any error. */
async function lookupIp(ip: string): Promise<Record<string, unknown> | null> {
  // Skip private/loopback addresses
  if (!ip || ip === "unknown" || ip.startsWith("127.") || ip.startsWith("::1") || ip.startsWith("10.") || ip.startsWith("192.168.") || ip === "::ffff:127.0.0.1") {
    return { note: "private/local address — no geo data available", query: ip };
  }
  try {
    const fields = "status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,mobile,proxy,hosting,query";
    const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`);
    if (!r.ok) return null;
    return await r.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

function shortToken(): string {
  return randomBytes(6).toString("base64url"); // 8 URL-safe chars
}
import { db, invitesTable, usersTable, inviteSessionsTable } from "@workspace/db";
import { sendPushAndLog } from "../lib/notifications.js";
import { consumeAccess, BANK_DETAILS } from "../lib/access-control.js";
import {
  ListInvitesQueryParams,
  CreateInviteBody,
  GetInviteByTokenParams,
  GrantLocationConsentParams,
  GrantLocationConsentBody,
  GetInviteParams,
  GetInviteResponse,
  UpdateInviteParams,
  UpdateInviteBody,
  UpdateInviteResponse,
} from "@workspace/api-zod";

function buildWhatsappLink(toPhone: string, message: string): string {
  const digits = toPhone.replace(/[^\d]/g, "");
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${encoded}`;
}

const router: IRouter = Router();

router.get("/invites", async (req, res): Promise<void> => {
  const params = ListInvitesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId, status } = params.data;
  const conditions = [];
  if (userId !== undefined) conditions.push(eq(invitesTable.fromUserId, userId));
  if (status !== undefined) conditions.push(eq(invitesTable.status, status));

  const invites =
    conditions.length > 0
      ? await db.select().from(invitesTable).where(and(...conditions))
      : await db.select().from(invitesTable);

  res.json(invites);
});

router.post("/invites", async (req, res): Promise<void> => {
  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Each invite sent counts as one free trial. Block after 3.
  const access = await consumeAccess(parsed.data.fromUserId);
  if (!access.allowed) {
    res.status(402).json({
      error: "You've used all 3 free invite trials. Activate a pass to continue sending invites.",
      ...access,
      payment: BANK_DETAILS,
    });
    return;
  }

  const token = shortToken();

  // Build the consent page URL from the baseUrl provided by the frontend
  const baseUrl = parsed.data.baseUrl ?? "";
  const consentPageUrl = baseUrl
    ? `${baseUrl}/consent/${token}`
    : `/consent/${token}`;

  // Compose the WhatsApp message with the tracking link embedded
  const messageWithLink = parsed.data.message
    ? `${parsed.data.message}\n\nClick here to grant location access: ${consentPageUrl}`
    : `Click here to grant location access: ${consentPageUrl}`;

  const whatsappLink = buildWhatsappLink(parsed.data.toPhone, messageWithLink);

  const [invite] = await db
    .insert(invitesTable)
    .values({
      fromUserId: parsed.data.fromUserId,
      toPhone: parsed.data.toPhone,
      toName: parsed.data.toName,
      message: parsed.data.message ?? "",
      consentType: parsed.data.consentType,
      token,
      consentPageUrl,
      whatsappLink,
      status: "pending",
    })
    .returning();

  res.status(201).json(GetInviteResponse.parse(invite));
});

// Must be before /invites/:id so "by-token" isn't parsed as an id
router.get("/invites/by-token/:token", async (req, res): Promise<void> => {
  const params = GetInviteByTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, params.data.token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  // Capture IP + UA on first open only
  if (!invite.openedIp) {
    const ip = getClientIp(req);
    const ua = req.headers["user-agent"] ?? null;
    // Fire geo lookup asynchronously — don't block the response
    lookupIp(ip).then((ipInfo) => {
      db.update(invitesTable)
        .set({ openedIp: ip, openedAt: new Date(), openedUserAgent: ua, ipInfo })
        .where(eq(invitesTable.token, params.data.token))
        .catch(() => {});
    }).catch(() => {});
  }

  // Look up the sender's name
  const [sender] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, invite.fromUserId));

  // Count sessions so the consent page can show "Xth time" messaging
  const sessions = await db
    .select()
    .from(inviteSessionsTable)
    .where(eq(inviteSessionsTable.inviteToken, invite.token));

  res.json({
    token: invite.token,
    fromUserName: sender?.name ?? "Someone",
    // Always return "accepted" semantics if the link has been used before,
    // but never block re-use — the link is permanent.
    status: invite.status,
    consentType: invite.consentType,
    grantedLatitude: invite.grantedLatitude,
    grantedLongitude: invite.grantedLongitude,
    grantedAt: invite.grantedAt,
    sessionCount: sessions.length,
  });
});

// GET /invites/by-token/:token/sessions — list all sessions for this invite (dashboard)
router.get("/invites/by-token/:token/sessions", async (req, res): Promise<void> => {
  const params = GetInviteByTokenParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Verify the invite exists
  const [invite] = await db
    .select({ id: invitesTable.id })
    .from(invitesTable)
    .where(eq(invitesTable.token, params.data.token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const sessions = await db
    .select()
    .from(inviteSessionsTable)
    .where(eq(inviteSessionsTable.inviteToken, params.data.token))
    .orderBy(desc(inviteSessionsTable.createdAt));

  res.json(sessions);
});

router.post("/invites/by-token/:token/grant", async (req, res): Promise<void> => {
  const params = GrantLocationConsentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = GrantLocationConsentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [existing] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.token, params.data.token));

  if (!existing) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const grantedIp = getClientIp(req);
  const isFirstGrant = existing.status !== "accepted";

  // --- Create a new session for this grant (permanent reuse: one session per click) ---
  const sessionToken = shortToken();
  const [session] = await db
    .insert(inviteSessionsTable)
    .values({
      inviteToken: params.data.token,
      sessionToken,
      grantedAt: new Date(),
      grantedLatitude: body.data.latitude,
      grantedLongitude: body.data.longitude,
      grantedAddress: body.data.address,
      grantedIp,
      status: "active",
    })
    .returning();

  // Update the invite's top-level grant fields (first time only — keep the "first seen" snapshot)
  const [updated] = await db
    .update(invitesTable)
    .set({
      status: "accepted",
      grantedIp,
      ...(isFirstGrant
        ? {
            grantedLatitude: body.data.latitude,
            grantedLongitude: body.data.longitude,
            grantedAddress: body.data.address,
            grantedAt: new Date(),
          }
        : {}),
    })
    .where(eq(invitesTable.token, params.data.token))
    .returning();

  // Push a notification on EVERY new session so the owner knows the link was clicked again
  sendPushAndLog(existing.fromUserId, {
    type: "grant",
    title: isFirstGrant ? "✅ Location access granted" : "🔄 New sharing session started",
    body: `${existing.toName ?? existing.toPhone} just shared their live location${isFirstGrant ? "" : " again"}`,
    tag: `granted-${session.id}`,
    data: { inviteId: existing.id, sessionId: session.id, contactName: existing.toName ?? existing.toPhone },
  }).catch(() => {});

  res.json({
    ...GetInviteResponse.parse(updated),
    sessionToken: session.sessionToken,
  });
});

router.get("/invites/:id", async (req, res): Promise<void> => {
  const params = GetInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [invite] = await db
    .select()
    .from(invitesTable)
    .where(eq(invitesTable.id, params.data.id));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json(GetInviteResponse.parse(invite));
});

router.patch("/invites/:id", async (req, res): Promise<void> => {
  const params = UpdateInviteParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [invite] = await db
    .update(invitesTable)
    .set({ ...parsed.data })
    .where(eq(invitesTable.id, params.data.id))
    .returning();

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json(UpdateInviteResponse.parse(invite));
});

export default router;
