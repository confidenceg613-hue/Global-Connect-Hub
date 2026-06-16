import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, invitesTable } from "@workspace/db";
import {
  ListInvitesQueryParams,
  CreateInviteBody,
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
      ? await db
          .select()
          .from(invitesTable)
          .where(and(...conditions))
      : await db.select().from(invitesTable);

  res.json(invites);
});

router.post("/invites", async (req, res): Promise<void> => {
  const parsed = CreateInviteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const whatsappLink = buildWhatsappLink(parsed.data.toPhone, parsed.data.message);

  const [invite] = await db
    .insert(invitesTable)
    .values({
      ...parsed.data,
      whatsappLink,
      status: "pending",
    })
    .returning();

  res.status(201).json(GetInviteResponse.parse(invite));
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

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.message) {
    const [existing] = await db
      .select()
      .from(invitesTable)
      .where(eq(invitesTable.id, params.data.id));
    if (existing) {
      updates.whatsappLink = buildWhatsappLink(
        existing.toPhone,
        parsed.data.message,
      );
    }
  }

  const [invite] = await db
    .update(invitesTable)
    .set(updates)
    .where(eq(invitesTable.id, params.data.id))
    .returning();

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  res.json(UpdateInviteResponse.parse(invite));
});

export default router;
