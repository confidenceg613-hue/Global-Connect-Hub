import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, invitesTable, usersTable } from "@workspace/db";
import { sendPushAndLog } from "../lib/notifications.js";
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

  const token = randomUUID();

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

  if (existing.status === "accepted") {
    res.status(409).json({ error: "Location already granted" });
    return;
  }

  const [updated] = await db
    .update(invitesTable)
    .set({
      status: "accepted",
      grantedLatitude: body.data.latitude,
      grantedLongitude: body.data.longitude,
      grantedAddress: body.data.address,
      grantedAt: new Date(),
    })
    .where(eq(invitesTable.token, params.data.token))
    .returning();

  // Notify the requester that consent was granted
  sendPushAndLog(existing.fromUserId, {
    type: "grant",
    title: "✅ Location access granted",
    body: `${existing.toName ?? existing.toPhone} just shared their live location`,
    tag: `granted-${existing.id}`,
    data: { inviteId: existing.id, contactName: existing.toName ?? existing.toPhone },
  }).catch(() => {});

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
