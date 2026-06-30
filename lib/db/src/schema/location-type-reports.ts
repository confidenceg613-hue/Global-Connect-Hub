import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const locationTypeReportsTable = pgTable("location_type_reports", {
  id: serial("id").primaryKey(),
  inviteToken: text("invite_token").notNull(), // references invites.token (no FK — token is not unique-indexed)
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  reportedType: text("reported_type").notNull(), // the auto-detected type that was flagged
  suggestedType: text("suggested_type").notNull(), // what the reporter says it should be
  comment: text("comment"),
  status: text("status").notNull().default("pending"), // pending | resolved | dismissed
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LocationTypeReport = typeof locationTypeReportsTable.$inferSelect;

export const CreateLocationTypeReportBody = z.object({
  token: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  reportedType: z.string(),
  suggestedType: z.string(),
  comment: z.string().optional(),
});

// Overrides applied to the map once an admin accepts a report's suggested type.
// Keyed by invite token + rounded coordinates (~11m precision) so re-detections at
// the same spot keep matching even if exact GPS jitter occurs.
export const locationTypeOverridesTable = pgTable("location_type_overrides", {
  id: serial("id").primaryKey(),
  inviteToken: text("invite_token").notNull(),
  latKey: doublePrecision("lat_key").notNull(),
  lngKey: doublePrecision("lng_key").notNull(),
  overrideType: text("override_type").notNull(),
  sourceReportId: integer("source_report_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LocationTypeOverride = typeof locationTypeOverridesTable.$inferSelect;

export function roundCoordKey(value: number): number {
  return Math.round(value * 10000) / 10000;
}
