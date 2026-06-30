import {
  pgTable,
  serial,
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
