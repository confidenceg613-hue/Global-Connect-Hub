import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
  integer,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const geoVideosTable = pgTable("geo_videos", {
  id: serial("id").primaryKey(),
  inviteToken: text("invite_token").notNull(),
  videoData: text("video_data").notNull(), // base64-encoded WebM
  mimeType: text("mime_type").notNull().default("video/webm"),
  durationMs: integer("duration_ms"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  address: text("address"),
  takenAt: timestamp("taken_at").defaultNow().notNull(),
});

export type GeoVideo = typeof geoVideosTable.$inferSelect;

export const SaveGeoVideoBody = z.object({
  token: z.string(),
  videoData: z.string(),
  mimeType: z.string().optional(),
  durationMs: z.number().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  address: z.string().optional(),
});
