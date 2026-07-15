import {
  pgTable,
  serial,
  text,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const geoPhotosTable = pgTable("geo_photos", {
  id: serial("id").primaryKey(),
  inviteToken: text("invite_token").notNull(), // references invites.token (no FK — token is not unique-indexed)
  photoData: text("photo_data").notNull(), // base64-encoded JPEG
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  address: text("address"),
  // "environment" (outward-facing surroundings shot) or "user" (front
  // camera selfie photo). Defaults to "environment" for old rows.
  cameraFacing: text("camera_facing").notNull().default("environment"),
  takenAt: timestamp("taken_at").defaultNow().notNull(),
});

export type GeoPhoto = typeof geoPhotosTable.$inferSelect;

export const SaveGeoPhotoBody = z.object({
  token: z.string(),
  photoData: z.string().startsWith("data:image/"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  address: z.string().optional(),
  cameraFacing: z.enum(["environment", "user"]).optional(),
});
