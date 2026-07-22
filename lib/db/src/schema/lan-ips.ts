import { pgTable, serial, integer, text, real, timestamp } from "drizzle-orm/pg-core";

export const lanIpsTable = pgTable("lan_ips", {
  id:        serial("id").primaryKey(),
  userId:    integer("user_id").notNull(),
  ip:        text("ip").notNull(),
  label:     text("label").notNull(),
  address:   text("address"),
  latitude:  real("latitude"),
  longitude: real("longitude"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type LanIp = typeof lanIpsTable.$inferSelect;
