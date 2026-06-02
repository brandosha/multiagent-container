import type { ThreadEvent } from "@openai/codex-sdk";
import { index, int, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const threadsTable = sqliteTable("threads", {
  id: int("id").primaryKey({ autoIncrement: true }),
  stringId: text("string_id").notNull(),
  codexThreadId: text("codex_thread_id"),
  createdAt: text("created_at").notNull().$default(() => new Date().toISOString()),
  updatedAt: text("updated_at").notNull().$default(() => new Date().toISOString()),
}, (table) => [
  uniqueIndex("threads_string_id_idx").on(table.stringId),
]);

export const threadEventsTable = sqliteTable("thread_events", {
  id: int("id").primaryKey({ autoIncrement: true }),
  threadId: int("thread_id").notNull().references(() => threadsTable.id),
  type: text("type").notNull(),
  event: text("event_json", { mode: "json" }).$type<ThreadEvent>().notNull(),
  timestamp: text("timestamp").notNull().$default(() => new Date().toISOString()),
}, (table) => [
  index("thread_events_thread_id_id_idx").on(table.threadId, table.id),
]);
