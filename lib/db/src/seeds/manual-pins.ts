/**
 * Optional manual pin seeds.
 * Keep this empty by default: pins represent user location data and must only
 * be created by the user through the application.
 */

import { db } from "../index";
import { manualPinsTable } from "../schema/manual-pins";
import { sql } from "drizzle-orm";

export interface SeedPin {
  userId: number;
  name: string;
  latitude: number;
  longitude: number;
}

export const SEED_PINS: SeedPin[] = [
];

/**
 * Upsert all seed pins.  Uses (userId, name) as the natural key so
 * re-running is idempotent — it won't create duplicates.
 */
export async function seedManualPins(): Promise<void> {
  if (SEED_PINS.length === 0) return;

  for (const pin of SEED_PINS) {
    await db.execute(sql`
      INSERT INTO manual_pins (user_id, name, latitude, longitude)
      VALUES (${pin.userId}, ${pin.name}, ${pin.latitude}, ${pin.longitude})
      ON CONFLICT DO NOTHING
    `);
  }

  console.log(`[seed] manual_pins: ${SEED_PINS.length} pin(s) ensured`);
}
