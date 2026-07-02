import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const assistantMessagesTable = pgTable("assistant_messages", {
  id: text("id").primaryKey(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
