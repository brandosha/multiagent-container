import Database from "better-sqlite3";
import { ThreadEvent } from "@openai/codex-sdk";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";

import { agentsDir, appDir } from "./paths.js";
import { threadEventsTable, threadsTable } from "./db/schema.js";

const dbPath = path.join(agentsDir, "multiagent-container.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(appDir, "drizzle") });

export interface StoredThreadEvent {
  id: number;
  threadId: number;
  type: string;
  timestamp: string;
  event: ThreadEvent;
}

interface StoredThreadEventRow {
  id: number;
  threadId: number;
  type: string;
  timestamp: string;
  event: ThreadEvent;
}

export function ensureThread(id: number) {
  const now = new Date().toISOString();
  db.insert(threadsTable)
    .values({
      id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadsTable.id,
      set: { updatedAt: now },
    })
    .run();
}

export function setCodexThreadId(id: number, codexThreadId: string) {
  ensureThread(id);
  db.update(threadsTable)
    .set({
      codexThreadId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(threadsTable.id, id))
    .run();
}

export function recordThreadEvent(threadId: number, event: ThreadEvent) {
  ensureThread(threadId);
  db.insert(threadEventsTable)
    .values({
      threadId,
      type: event.type,
      event,
      timestamp: new Date().toISOString(),
    })
    .run();
}

export function getThreadEvents(threadId: number, options: { limit?: number; offset?: number } = {}): StoredThreadEvent[] {
  ensureThread(threadId);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = db.select({
    id: threadEventsTable.id,
    threadId: threadEventsTable.threadId,
    type: threadEventsTable.type,
    timestamp: threadEventsTable.timestamp,
    event: threadEventsTable.event,
  })
    .from(threadEventsTable)
    .where(eq(threadEventsTable.threadId, threadId))
    .orderBy(asc(threadEventsTable.id))
    .limit(limit)
    .offset(offset)
    .all() as StoredThreadEventRow[];

  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    type: row.type,
    timestamp: row.timestamp,
    event: row.event,
  }));
}
