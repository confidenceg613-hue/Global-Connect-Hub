import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { subscriptionCodesTable } from "./subscription-codes";

// One row per user, created lazily on first access check. Tracks the free
// trial counter and the currently active paid grant (if any).
export const userAccessTable = pgTable("user_access", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  freeAccessesUsed: integer("free_accesses_used").notNull().default(0),
  freeAccessLimit: integer("free_access_limit").notNull().default(3),
  activeCodeId: integer("active_code_id").references(
    () => subscriptionCodesTable.id,
    { onDelete: "set null" },
  ),
  // Null => no active paid subscription right now.
  accessExpiresAt: timestamp("access_expires_at"),
  // Dev/internal bypass — ignores accessExpiresAt and the free counter.
  hasUnlimitedAccess: boolean("has_unlimited_access").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type UserAccess = typeof userAccessTable.$inferSelect;
