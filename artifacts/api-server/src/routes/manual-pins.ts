import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { manualPinsTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const CreateManualPinBody = z.object({
  userId: z.number().int().positive(),
  name: z.string().min(1).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

router.get("/manual-pins/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  const rows = await db.select().from(manualPinsTable).where(eq(manualPinsTable.userId, userId));
  res.json(rows);
});

router.post("/manual-pins", async (req, res): Promise<void> => {
  const parsed = CreateManualPinBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(manualPinsTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.delete("/manual-pins/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  await db.delete(manualPinsTable).where(eq(manualPinsTable.id, id));
  res.json({ ok: true });
});

export default router;
