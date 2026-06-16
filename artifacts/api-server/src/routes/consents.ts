import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import { db, consentsTable } from "@workspace/db";
import {
  ListConsentsQueryParams,
  CreateConsentBody,
  GetConsentParams,
  GetConsentResponse,
  UpdateConsentParams,
  UpdateConsentBody,
  UpdateConsentResponse,
  DeleteConsentParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/consents/summary", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      type: consentsTable.type,
      status: consentsTable.status,
      count: sql<number>`count(*)::int`,
    })
    .from(consentsTable)
    .groupBy(consentsTable.type, consentsTable.status);

  const blank = () => ({ granted: 0, denied: 0, revoked: 0, total: 0 });
  const summary: Record<string, ReturnType<typeof blank>> = {
    location: blank(),
    notification: blank(),
    messaging: blank(),
    totals: blank(),
  };

  for (const row of rows) {
    const t = summary[row.type];
    const s = row.status as "granted" | "denied" | "revoked";
    if (t && s in t) {
      (t[s] as number) += row.count;
      t.total += row.count;
    }
    const tot = summary["totals"]!;
    (tot[s] as number) += row.count;
    tot.total += row.count;
  }

  res.json(summary);
});

router.get("/consents", async (req, res): Promise<void> => {
  const params = ListConsentsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { userId, type, status } = params.data;
  const conditions = [];
  if (userId !== undefined) conditions.push(eq(consentsTable.userId, userId));
  if (type !== undefined) conditions.push(eq(consentsTable.type, type));
  if (status !== undefined) conditions.push(eq(consentsTable.status, status));

  const consents =
    conditions.length > 0
      ? await db
          .select()
          .from(consentsTable)
          .where(and(...conditions))
      : await db.select().from(consentsTable);

  res.json(consents);
});

router.post("/consents", async (req, res): Promise<void> => {
  const parsed = CreateConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  const grantedAt = parsed.data.status === "granted" ? now : undefined;
  const revokedAt = parsed.data.status === "revoked" ? now : undefined;

  const [consent] = await db
    .insert(consentsTable)
    .values({ ...parsed.data, grantedAt, revokedAt })
    .returning();

  res.status(201).json(GetConsentResponse.parse(consent));
});

router.get("/consents/:id", async (req, res): Promise<void> => {
  const params = GetConsentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [consent] = await db
    .select()
    .from(consentsTable)
    .where(eq(consentsTable.id, params.data.id));

  if (!consent) {
    res.status(404).json({ error: "Consent not found" });
    return;
  }

  res.json(GetConsentResponse.parse(consent));
});

router.patch("/consents/:id", async (req, res): Promise<void> => {
  const params = UpdateConsentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.status === "granted") updates.grantedAt = new Date();
  if (parsed.data.status === "revoked") updates.revokedAt = new Date();

  const [consent] = await db
    .update(consentsTable)
    .set(updates)
    .where(eq(consentsTable.id, params.data.id))
    .returning();

  if (!consent) {
    res.status(404).json({ error: "Consent not found" });
    return;
  }

  res.json(UpdateConsentResponse.parse(consent));
});

router.delete("/consents/:id", async (req, res): Promise<void> => {
  const params = DeleteConsentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [deleted] = await db
    .delete(consentsTable)
    .where(eq(consentsTable.id, params.data.id))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Consent not found" });
    return;
  }

  res.sendStatus(204);
});

export default router;
