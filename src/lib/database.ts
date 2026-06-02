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

export interface ThreadRecord {
  id: number;
  stringId: string;
  codexThreadId: string | null;
}

interface StoredThreadEventRow {
  id: number;
  threadId: number;
  type: string;
  timestamp: string;
  event: ThreadEvent;
}

export function getThreadByStringId(stringId: string): ThreadRecord | undefined {
  return db.select({
    id: threadsTable.id,
    stringId: threadsTable.stringId,
    codexThreadId: threadsTable.codexThreadId,
  })
    .from(threadsTable)
    .where(eq(threadsTable.stringId, stringId))
    .get();
}

export function getOrCreateThread(stringId: string): ThreadRecord {
  const now = new Date().toISOString();
  return db.insert(threadsTable)
    .values({
      stringId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadsTable.stringId,
      set: { updatedAt: now },
    })
    .returning({
      id: threadsTable.id,
      stringId: threadsTable.stringId,
      codexThreadId: threadsTable.codexThreadId,
    })
    .get();
}

export function setCodexThreadId(id: number, codexThreadId: string) {
  db.update(threadsTable)
    .set({
      codexThreadId,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(threadsTable.id, id))
    .run();
}

export function recordThreadEvent(threadId: number, event: ThreadEvent) {
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
