import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  phoneNumber: text("phone_number"),
  countryCode: text("country_code"),
  countryIso: text("country_iso"),
  fullPhone: text("full_phone").unique(),
  // Google account link — lets a user recover their account (and all their
  // invites/data, which already live server-side keyed by userId) on a new
  // device or after reinstalling, without relying on localStorage.
  googleId: text("google_id").unique(),
  googleEmail: text("google_email"),
  googleName: text("google_name"),
  googlePicture: text("google_picture"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
