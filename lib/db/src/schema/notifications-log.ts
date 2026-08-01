import { pgTable, serial, integer, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const notificationsLogTable = pgTable("notifications_log", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type", {
    enum: ["geofence_enter", "geofence_exit", "location_offline", "location_online", "location_stale", "sos", "grant", "location_type_report", "admin_message", "location_request"],
  }).notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data"),
  read: boolean("read").notNull().default(false),
  // Admin-sent messages are pinned so they stay at the top of a user's
  // notification panel instead of scrolling away with regular activity.
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type NotificationLog = typeof notificationsLogTable.$inferSelect;
