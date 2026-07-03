import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAssistantMessageSchema = createInsertSchema(assistantMessagesTable).omit({
  createdAt: true,
});
export type InsertAssistantMessage = z.infer<typeof insertAssistantMessageSchema>;
export type AssistantMessage = typeof assistantMessagesTable.$inferSelect;
