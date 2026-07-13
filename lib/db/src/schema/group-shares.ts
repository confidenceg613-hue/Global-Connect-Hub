import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const groupSharesTable = pgTable(
  "group_shares",
  {
    id: serial("id").primaryKey(),
    groupId: text("group_id").notNull(), // 12-char URL-safe token, used in share links
    ownerUserId: integer("owner_user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("group_shares_group_id_idx").on(t.groupId)],
);

export const groupShareMembersTable = pgTable("group_share_members", {
  id: serial("id").primaryKey(),
  groupShareId: integer("group_share_id")
    .notNull()
    .references(() => groupSharesTable.id, { onDelete: "cascade" }),
  memberToken: text("member_token").notNull(), // unique per-member push token
  displayName: text("display_name"),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  lastLat: doublePrecision("last_lat"),
  lastLng: doublePrecision("last_lng"),
  lastAddress: text("last_address"),
  lastSeen: timestamp("last_seen"),
});

export type GroupShare = typeof groupSharesTable.$inferSelect;
export type GroupShareMember = typeof groupShareMembersTable.$inferSelect;
