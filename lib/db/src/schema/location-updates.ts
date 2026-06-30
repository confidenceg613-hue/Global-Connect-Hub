import { pgTable, serial, text, doublePrecision, timestamp } from "drizzle-orm/pg-core";

export const locationUpdatesTable = pgTable("location_updates", {
  id: serial("id").primaryKey(),
  token: text("token").notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  accuracy: doublePrecision("accuracy"),
  address: text("address"),
  status: text("status", { enum: ["active", "offline"] }).notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LocationUpdate = typeof locationUpdatesTable.$inferSelect;
