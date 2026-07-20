import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
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
import { db, invitesTable, usersTable } from "@workspace/db";
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
  const messageWithLink =
    `${parsed.data.message}\n\nClick here to grant location access: ${consentPageUrl}`;

  const whatsappLink = buildWhatsappLink(parsed.data.toPhone, messageWithLink);

  const [invite] = await db
    .insert(invitesTable)
    .values({
      fromUserId: parsed.data.fromUserId,
      toPhone: parsed.data.toPhone,
      toName: parsed.data.toName,
      message: parsed.data.message,
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

  res.json({
    token: invite.token,
    fromUserName: sender?.name ?? "Someone",
    status: invite.status,
    consentType: invite.consentType,
    grantedLatitude: invite.grantedLatitude,
    grantedLongitude: invite.grantedLongitude,
    grantedAt: invite.grantedAt,
  });
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

  const alreadyGranted = existing.status === "accepted";

  const grantedIp = getClientIp(req);

  const [updated] = await db
    .update(invitesTable)
    .set({
      status: "accepted",
      grantedLatitude: body.data.latitude,
      grantedLongitude: body.data.longitude,
      grantedAddress: body.data.address,
      grantedIp,
      // Only stamp grantedAt on the first grant, not on re-opens
      ...(alreadyGranted ? {} : { grantedAt: new Date() }),
    })
    .where(eq(invitesTable.token, params.data.token))
    .returning();

  // Only push the "just granted" notification on the first consent, not re-opens
  if (!alreadyGranted) {
    sendPushAndLog(existing.fromUserId, {
      type: "grant",
      title: "✅ Location access granted",
      body: `${existing.toName ?? existing.toPhone} just shared their live location`,
      tag: `granted-${existing.id}`,
      data: { inviteId: existing.id, contactName: existing.toName ?? existing.toPhone },
    }).catch(() => {});
  }

  res.json(GetInviteResponse.parse(updated));
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
