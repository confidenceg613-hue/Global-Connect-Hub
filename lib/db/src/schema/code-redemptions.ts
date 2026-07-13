import { pgTable, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { subscriptionCodesTable } from "./subscription-codes";

// Append-only audit trail of every successful code redemption, kept even
// after the grant it created has expired or been superseded.
export const codeRedemptionsTable = pgTable("code_redemptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  codeId: integer("code_id")
    .notNull()
    .references(() => subscriptionCodesTable.id, { onDelete: "cascade" }),
  redeemedAt: timestamp("redeemed_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CodeRedemption = typeof codeRedemptionsTable.$inferSelect;
