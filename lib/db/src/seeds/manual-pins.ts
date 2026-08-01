/**
 * Permanent manual pin seeds.
 * These are inserted (upserted) on every server start so they survive
 * push/pull to a new environment.  Add new pins here to persist them
 * permanently in the repository.
 *
 * userId references the first registered user (id = 1).  Adjust the
 * userId field if pins belong to a specific account.
 */

import { db } from "../index";
import { manualPinsTable } from "../schema/manual-pins";
import { usersTable } from "../schema/users";
import { eq, sql } from "drizzle-orm";

export interface SeedPin {
  userId: number;
  name: string;
  latitude: number;
  longitude: number;
}

export const SEED_PINS: SeedPin[] = [
  // ── Add or edit pins here ────────────────────────────────────────────────
  { userId: 1, name: "Sarah's Home - London", latitude: 51.5074, longitude: -0.1278 },
  // ────────────────────────────────────────────────────────────────────────
];

/**
 * Upsert all seed pins.  Uses (userId, name) as the natural key so
 * re-running is idempotent — it won't create duplicates.
 */
export async function seedManualPins(): Promise<void> {
  if (SEED_PINS.length === 0) return;

  for (const pin of SEED_PINS) {
    const [owner] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, pin.userId))
      .limit(1);

    if (!owner) {
      console.info(`[seed] manual_pins: skipped "${pin.name}" because user ${pin.userId} does not exist`);
      continue;
    }

    await db.execute(sql`
      INSERT INTO manual_pins (user_id, name, latitude, longitude)
      VALUES (${pin.userId}, ${pin.name}, ${pin.latitude}, ${pin.longitude})
      ON CONFLICT DO NOTHING
    `);
  }

  console.log(`[seed] manual_pins: ${SEED_PINS.length} pin(s) ensured`);
}
