import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAdmin } from "../middleware/admin-auth";
import { createCode, listCodes, revokeCode } from "../lib/access-control";

const router: IRouter = Router();

// Everything under /admin requires the x-admin-secret header — never
// exposed to the regular app, only for Godwin's own use (e.g. curl/Postman).
router.use("/admin", requireAdmin);

const CreateCodeBody = z.object({
  code: z.string().min(3).max(32),
  label: z.string().max(100).optional(),
  // Omit or null => never expires (reserve this for internal/dev codes).
  durationDays: z.number().int().positive().nullable().optional(),
  // Omit or null => unlimited redemptions (normal case for a weekly code
  // shared with every user who paid that week).
  maxRedemptions: z.number().int().positive().nullable().optional(),
  // Naira price this code is sold for. Omit to use the standard bank-transfer
  // price for paid codes, or null for free/internal codes.
  priceNaira: z.number().int().nonnegative().nullable().optional(),
});

router.post("/admin/codes", async (req, res): Promise<void> => {
  const parsed = CreateCodeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const code = await createCode(parsed.data);
    res.status(201).json(code);
  } catch (err: unknown) {
    const pgCode =
      (err as { code?: string })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "That code already exists." });
      return;
    }
    throw err;
  }
});

router.get("/admin/codes", async (_req, res): Promise<void> => {
  res.json(await listCodes());
});

router.patch("/admin/codes/:id/revoke", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid code id" });
    return;
  }

  const updated = await revokeCode(id);
  if (!updated) {
    res.status(404).json({ error: "Code not found" });
    return;
  }
  res.json(updated);
});

export default router;
