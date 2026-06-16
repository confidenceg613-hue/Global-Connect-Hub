import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const invitesTable = pgTable("invites", {
  id: serial("id").primaryKey(),
  fromUserId: integer("from_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  toPhone: text("to_phone").notNull(),
  toName: text("to_name"),
  message: text("message").notNull(),
  status: text("status", {
    enum: ["pending", "accepted", "declined"],
  })
    .notNull()
    .default("pending"),
  whatsappLink: text("whatsapp_link").notNull(),
  consentType: text("consent_type", {
    enum: ["location", "notification", "messaging"],
  }),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
});

export const insertInviteSchema = createInsertSchema(invitesTable).omit({
  id: true,
  sentAt: true,
  status: true,
});
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invitesTable.$inferSelect;
