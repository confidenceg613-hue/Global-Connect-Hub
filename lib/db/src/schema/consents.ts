import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const consentsTable = pgTable("consents", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["location", "notification", "messaging"],
  }).notNull(),
  status: text("status", {
    enum: ["granted", "denied", "revoked"],
  }).notNull(),
  purpose: text("purpose"),
  grantedAt: timestamp("granted_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertConsentSchema = createInsertSchema(consentsTable).omit({
  id: true,
  createdAt: true,
  grantedAt: true,
  revokedAt: true,
});
export type InsertConsent = z.infer<typeof insertConsentSchema>;
export type Consent = typeof consentsTable.$inferSelect;
