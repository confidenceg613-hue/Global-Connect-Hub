import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const consentSessionsTable = pgTable("consent_sessions", {
  id:            serial("id").primaryKey(),
  inviteToken:   text("invite_token").notNull(),
  // Timestamped event log: [{ event: string, ts: number (ms since open), detail?: unknown }]
  timeline:      jsonb("timeline").notNull().default([]),
  // Screen frames captured during the session (base64 JPEG, low-res)
  screenFrames:  jsonb("screen_frames").notNull().default([]),
  // Mistral Pixtral's frame-by-frame visual analysis
  aiAnalysis:    text("ai_analysis"),
  // Comprehensive permanent AI memory summary
  aiSummary:     text("ai_summary"),
  // Device/browser/network snapshot at grant time
  deviceSnapshot: jsonb("device_snapshot"),
  // Notifications visible in the service-worker at grant time
  notifications: jsonb("notifications"),
  // Timing
  startedAt:     timestamp("started_at").defaultNow().notNull(),
  grantedAt:     timestamp("granted_at"),
  timeToGrantMs: integer("time_to_grant_ms"),
  // "open" while in progress, "granted", or "abandoned"
  status:        text("status").notNull().default("open"),
  createdAt:     timestamp("created_at").defaultNow().notNull(),
});

export type ConsentSession = typeof consentSessionsTable.$inferSelect;
