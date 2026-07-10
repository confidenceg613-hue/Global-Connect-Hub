import { pgTable, serial, text, doublePrecision, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const locationUpdatesTable = pgTable("location_updates", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracy: doublePrecision("accuracy"),
  source: text("source", { enum: ["gps", "network", "fused"] }),
  address: text("address"),
  status: text("status", { enum: ["active", "offline"] }).notNull().default("active"),
  // Device telemetry — captured on the contact's device but only ever
  // surfaced to the owner (via /api/sessions, which is scoped to
  // fromUserId). Never returned by any token-authenticated/public route.
  batteryLevel: integer("battery_level"),
  batteryCharging: boolean("battery_charging"),
  activityType: text("activity_type", { enum: ["stationary", "walking", "running", "driving"] }),
  // Freeform bag of everything else the contact's device exposes (raw GPS
  // fields, browser/OS/network info, etc). Same visibility rule as above:
  // owner-only, via /api/sessions, never a public/token route.
  deviceInfo: jsonb("device_info"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LocationUpdate = typeof locationUpdatesTable.$inferSelect;
