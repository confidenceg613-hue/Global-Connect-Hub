import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { invitesTable } from "./invites";

export const inviteSessionsTable = pgTable("invite_sessions", {
  id: serial("id").primaryKey(),
  // The parent invite this session belongs to
  inviteToken: text("invite_token")
    .notNull()
    .references(() => invitesTable.token, { onDelete: "cascade" }),
  // Unique token for THIS session — used for all location pushes, SSE, media uploads
  sessionToken: text("session_token").notNull().unique(),
  // Set when the recipient taps "Grant"
  grantedAt: timestamp("granted_at"),
  grantedLatitude: doublePrecision("granted_latitude"),
  grantedLongitude: doublePrecision("granted_longitude"),
  grantedAddress: text("granted_address"),
  grantedIp: text("granted_ip"),
  // GPS sharing is intentionally short-lived. The API refuses further pushes
  // against this session after this moment, even if a client stays running.
  expiresAt: timestamp("expires_at"),
  status: text("status", { enum: ["active", "ended"] })
    .notNull()
    .default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type InviteSession = typeof inviteSessionsTable.$inferSelect;
