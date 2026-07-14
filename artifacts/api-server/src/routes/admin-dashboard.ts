import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, usersTable, userAccessTable, codeRedemptionsTable, subscriptionCodesTable } from "@workspace/db";
import { requireAdmin } from "../middleware/admin-auth";
import { evaluateAccess, getOrCreateUserAccess, getTotalRevenueNaira, listCodes } from "../lib/access-control";
import { sendPushAndLog } from "../lib/notifications";

const router: IRouter = Router();

// Everything under /admin requires the x-admin-secret header — same gate as
// the existing subscription-code admin routes. Never exposed to the regular
// app; only reachable from the Admin HQ panel after a password check.
router.use("/admin", requireAdmin);

// A successful response here just proves the supplied password is correct —
// the Admin HQ panel uses this as its "login" step. Nothing sensitive is
// echoed back.
router.post("/admin/login", (_req, res): void => {
  res.json({ ok: true });
});

router.get("/admin/overview", async (_req, res): Promise<void> => {
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));
  const accessRows = await db.select().from(userAccessTable);
  const accessByUser = new Map(accessRows.map((a) => [a.userId, a]));

  let unlimitedCount = 0;
  let subscribedCount = 0;
  let freeCount = 0;
  let lockedOrExpiredCount = 0;

  const userSummaries = users.map((u) => {
    const accessRow = accessByUser.get(u.id);
    if (!accessRow) {
      freeCount++;
      return {
        id: u.id,
        name: u.name,
        phone: u.fullPhone,
        googleEmail: u.googleEmail,
        createdAt: u.createdAt,
        status: "free" as const,
        allowed: true,
        freeAccessesUsed: 0,
        freeAccessLimit: 3,
        accessExpiresAt: null as string | null,
        activeCodeId: null as number | null,
      };
    }
    const status = evaluateAccess(accessRow);
    if (status.status === "unlimited") unlimitedCount++;
    else if (status.status === "subscribed") subscribedCount++;
    else if (status.status === "free") freeCount++;
    else lockedOrExpiredCount++;

    return {
      id: u.id,
      name: u.name,
      phone: u.fullPhone,
      googleEmail: u.googleEmail,
      createdAt: u.createdAt,
      status: status.status,
      allowed: status.allowed,
      freeAccessesUsed: accessRow.freeAccessesUsed,
      freeAccessLimit: accessRow.freeAccessLimit,
      accessExpiresAt: status.accessExpiresAt,
      activeCodeId: accessRow.activeCodeId,
    };
  });

  const totalRevenueNaira = await getTotalRevenueNaira();
  const codes = await listCodes();
  const totalRedemptions = codes.reduce((s, c) => s + c.redemptionCount, 0);
  const activeCodes = codes.filter((c) => !c.isRevoked).length;

  res.json({
    stats: {
      totalUsers: users.length,
      unlimitedCount,
      subscribedCount,
      freeCount,
      lockedOrExpiredCount,
      totalRevenueNaira,
      totalRedemptions,
      activeCodes,
      totalCodes: codes.length,
    },
    users: userSummaries,
  });
});

router.get("/admin/users/:userId/history", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  const redemptions = await db
    .select({
      id: codeRedemptionsTable.id,
      redeemedAt: codeRedemptionsTable.redeemedAt,
      expiresAt: codeRedemptionsTable.expiresAt,
      code: subscriptionCodesTable.code,
      label: subscriptionCodesTable.label,
      priceNaira: subscriptionCodesTable.priceNaira,
    })
    .from(codeRedemptionsTable)
    .innerJoin(subscriptionCodesTable, eq(codeRedemptionsTable.codeId, subscriptionCodesTable.id))
    .where(eq(codeRedemptionsTable.userId, userId))
    .orderBy(desc(codeRedemptionsTable.redeemedAt));
  res.json(redemptions);
});

const GrantBody = z.object({ hasUnlimitedAccess: z.boolean() });

router.patch("/admin/users/:userId/unlimited", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  const parsed = GrantBody.safeParse(req.body);
  if (!Number.isInteger(userId) || !parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  await getOrCreateUserAccess(userId);
  const [updated] = await db
    .update(userAccessTable)
    .set({ hasUnlimitedAccess: parsed.data.hasUnlimitedAccess, updatedAt: new Date() })
    .where(eq(userAccessTable.userId, userId))
    .returning();
  res.json(updated);
});

router.post("/admin/users/:userId/revoke-access", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  await getOrCreateUserAccess(userId);
  const [updated] = await db
    .update(userAccessTable)
    .set({ hasUnlimitedAccess: false, accessExpiresAt: null, activeCodeId: null, updatedAt: new Date() })
    .where(eq(userAccessTable.userId, userId))
    .returning();
  res.json(updated);
});

router.post("/admin/users/:userId/reset-free-trial", async (req, res): Promise<void> => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }
  await getOrCreateUserAccess(userId);
  const [updated] = await db
    .update(userAccessTable)
    .set({ freeAccessesUsed: 0, updatedAt: new Date() })
    .where(eq(userAccessTable.userId, userId))
    .returning();
  res.json(updated);
});

const MessageBody = z.object({
  userId: z.number().int().positive(),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(1000),
});

router.post("/admin/messages", async (req, res): Promise<void> => {
  const parsed = MessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, parsed.data.userId));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  await sendPushAndLog(parsed.data.userId, {
    type: "admin_message",
    title: parsed.data.title,
    body: parsed.data.body,
    pinned: true,
  });
  res.status(201).json({ ok: true });
});

export default router;
