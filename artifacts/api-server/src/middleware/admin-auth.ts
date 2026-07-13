import type { Request, Response, NextFunction } from "express";

// Gates admin-only routes (subscription code management) behind a shared
// secret sent as `x-admin-secret`. Never logs or echoes the secret back.
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    res
      .status(503)
      .json({ error: "Admin access is not configured on this server." });
    return;
  }

  const provided = req.header("x-admin-secret");
  if (!provided || provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}
