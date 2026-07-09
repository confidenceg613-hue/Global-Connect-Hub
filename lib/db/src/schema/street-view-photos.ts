import { pgTable, serial, text, timestamp, doublePrecision, uniqueIndex, index } from "drizzle-orm/pg-core";

// Permanent cache of Mapillary street-level imagery so that once a location's
// street view has been resolved, it's stored forever and future lookups near
// the same spot don't need to hit the Mapillary API again.
export const streetViewPhotosTable = pgTable(
  "street_view_photos",
  {
    id: serial("id").primaryKey(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    mapillaryImageId: text("mapillary_image_id").notNull(),
    imageUrl: text("image_url"),
    embedUrl: text("embed_url").notNull(),
    savedAt: timestamp("saved_at").defaultNow().notNull(),
  },
  (t) => [
    index("street_view_photos_lat_lng_idx").on(t.latitude, t.longitude),
    // Prevent duplicate rows for the same Mapillary photo under concurrent cache misses.
    uniqueIndex("street_view_photos_image_id_idx").on(t.mapillaryImageId),
  ],
);

export type StreetViewPhoto = typeof streetViewPhotosTable.$inferSelect;
