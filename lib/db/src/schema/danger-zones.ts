import { pgTable, serial, integer, text, timestamp, decimal, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface DangerZone {
  id: number;
  name: string;
  description?: string;
  severity: "low" | "medium" | "high" | "critical";
  coordinates: Coordinate[];
  radius?: number;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

export const dangerZonesTable = pgTable("danger_zones", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  severity: text("severity", {
    enum: ["low", "medium", "high", "critical"],
  })
    .notNull()
    .default("medium"),
  coordinates: json("coordinates").notNull().$type<Coordinate[]>(),
  radius: decimal("radius", { precision: 10, scale: 2 }),
  createdBy: integer("created_by")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDangerZoneSchema = createInsertSchema(dangerZonesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDangerZone = z.infer<typeof insertDangerZoneSchema>;
export type DangerZoneRecord = typeof dangerZonesTable.$inferSelect;
