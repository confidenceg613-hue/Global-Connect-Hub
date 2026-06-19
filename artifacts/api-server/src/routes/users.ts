import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import {
  CreateUserBody,
  GetUserParams,
  GetUserResponse,
  UpdateUserParams,
  UpdateUserBody,
  UpdateUserResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/users", async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { name, phoneNumber, countryCode, countryIso } = parsed.data;
  const fullPhone = `${countryCode}${phoneNumber}`.replace(/\s+/g, "");

  // Return existing user if this phone is already registered (login flow)
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.fullPhone, fullPhone));

  if (existing) {
    res.status(200).json({ ...GetUserResponse.parse(existing), isExistingUser: true });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({ name, phoneNumber, countryCode, countryIso, fullPhone })
    .returning();

  res.status(201).json({ ...GetUserResponse.parse(user), isExistingUser: false });
});

router.get("/users/:id", async (req, res): Promise<void> => {
  const params = GetUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, params.data.id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(GetUserResponse.parse(user));
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = UpdateUserParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.phoneNumber || parsed.data.countryCode) {
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, params.data.id));
    if (existing) {
      const code = parsed.data.countryCode ?? existing.countryCode;
      const phone = parsed.data.phoneNumber ?? existing.phoneNumber;
      updates.fullPhone = `${code}${phone}`.replace(/\s+/g, "");
    }
  }
  updates.updatedAt = new Date();

  const [user] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, params.data.id))
    .returning();

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json(UpdateUserResponse.parse(user));
});

export default router;
