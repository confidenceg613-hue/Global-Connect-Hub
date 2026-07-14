import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// A code activates access for `durationDays` days from the moment a user
// redeems it. `durationDays: null` means the grant never expires — reserved
// for internal/dev bypass codes, never for paid weekly codes.
// `maxRedemptions: null` means the code can be redeemed by an unlimited
// number of users (the normal case: one weekly code is handed to every user
// who paid that week).
export const subscriptionCodesTable = pgTable("subscription_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  // Admin-only reference note (e.g. "Week 1", "Dev bypass — do not share").
  // Never returned by any public-facing endpoint.
  label: text("label"),
  durationDays: integer("duration_days"),
  maxRedemptions: integer("max_redemptions"),
  // Naira price this code was sold for. Null for internal/dev bypass codes
  // that were never actually paid for — kept out of revenue totals.
  priceNaira: integer("price_naira"),
  redemptionCount: integer("redemption_count").notNull().default(0),
  isRevoked: boolean("is_revoked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSubscriptionCodeSchema = createInsertSchema(
  subscriptionCodesTable,
).omit({
  id: true,
  redemptionCount: true,
  isRevoked: true,
  createdAt: true,
});
export type InsertSubscriptionCode = z.infer<
  typeof insertSubscriptionCodeSchema
>;
export type SubscriptionCode = typeof subscriptionCodesTable.$inferSelect;
