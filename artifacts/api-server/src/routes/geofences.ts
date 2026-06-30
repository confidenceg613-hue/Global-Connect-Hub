import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, geofencesTable } from "@workspace/db";
import { z } from "zod";

const router: IRouter = Router();

const CreateGeofenceBody = z.object({
  userId: z.number(),
  name: z.string().min(1).max(80),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().min(50).max(50000).default(200),
});

router.get("/geofences/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (isNaN(userId)) { res.status(400).json({ error: "invalid userId" }); return; }
  const rows = await db.select().from(geofencesTable).where(eq(geofencesTable.userId, userId));
  res.json(rows);
});

router.post("/geofences", async (req, res): Promise<void> => {
  const parsed = CreateGeofenceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(geofencesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.delete("/geofences/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  await db.delete(geofencesTable).where(eq(geofencesTable.id, id));
  res.json({ ok: true });
});

export default router;
