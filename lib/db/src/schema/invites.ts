import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
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
  token: text("token").notNull().unique(),
  consentPageUrl: text("consent_page_url"),
  grantedLatitude: doublePrecision("granted_latitude"),
  grantedLongitude: doublePrecision("granted_longitude"),
  grantedAddress: text("granted_address"),
  grantedAt: timestamp("granted_at"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
  // Captured when the contact first opens the consent page
  openedIp: text("opened_ip"),
  openedAt: timestamp("opened_at"),
  openedUserAgent: text("opened_user_agent"),
  // JSON blob from ip-api.com lookup — city, ISP, org, timezone, etc.
  ipInfo: jsonb("ip_info"),
  // IP at the moment they actually tap "Grant"
  grantedIp: text("granted_ip"),
});

export const insertInviteSchema = createInsertSchema(invitesTable).omit({
  id: true,
  sentAt: true,
  status: true,
  grantedLatitude: true,
  grantedLongitude: true,
  grantedAddress: true,
  grantedAt: true,
});
export type InsertInvite = z.infer<typeof insertInviteSchema>;
export type Invite = typeof invitesTable.$inferSelect;
