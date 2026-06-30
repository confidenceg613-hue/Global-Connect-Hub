import { pgTable, serial, integer, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const geofencesTable = pgTable("geofences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  radiusMeters: doublePrecision("radius_meters").notNull().default(200),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type Geofence = typeof geofencesTable.$inferSelect;
