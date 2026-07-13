import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  getAccessStatus,
  consumeAccess,
  redeemCode,
  BANK_DETAILS,
} from "../lib/access-control";

const router: IRouter = Router();

const UserIdParams = z.object({ userId: z.coerce.number().int().positive() });
const RedeemBody = z.object({ code: z.string().min(1).max(32) });

// Payment instructions — safe to show publicly, unlike the codes themselves.
router.get("/access/payment-info", (_req, res) => {
  res.json(BANK_DETAILS);
});

// Read-only status check. Does not consume a free access.
router.get("/access/:userId/status", async (req, res): Promise<void> => {
  const params = UserIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const status = await getAccessStatus(params.data.userId);
  res.json(status.allowed ? status : { ...status, payment: BANK_DETAILS });
});

// Call once per app open/session to consume a free access (if applicable)
// and confirm the user is allowed in.
router.post("/access/:userId/check-in", async (req, res): Promise<void> => {
  const params = UserIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const status = await consumeAccess(params.data.userId);
  if (!status.allowed) {
    res.status(402).json({ ...status, payment: BANK_DETAILS });
    return;
  }
  res.json(status);
});

// Submit a code received from the admin after payment verification.
router.post("/access/:userId/redeem", async (req, res): Promise<void> => {
  const params = UserIdParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = RedeemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const result = await redeemCode(params.data.userId, body.data.code);
  if (!result.success) {
    res
      .status(402)
      .json({ error: result.message, reason: result.reason, payment: BANK_DETAILS });
    return;
  }
  res.json(result.status);
});

export default router;
