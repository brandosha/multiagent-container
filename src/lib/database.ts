import Database from "better-sqlite3";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "path";

import { agentsDir, appDir } from "./paths.js";
import { threadEventsTable, threadsTable } from "./db/schema.js";
import type { SharedThreadEvent } from "./thread-events.js";

const dbPath = path.join(agentsDir, "multiagent-container.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);
migrate(db, { migrationsFolder: path.join(appDir, "drizzle") });

export interface ThreadRecord {
  id: number;
  stringId: string;
  codexThreadId: string | null;
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

export function recordThreadEvent(threadId: number, event: SharedThreadEvent) {
  db.insert(threadEventsTable)
    .values({
      threadId,
      turnId: "turnId" in event ? event.turnId : null,
      type: event.type,
      event,
      timestamp: new Date().toISOString(),
    })
    .run();
}

export function getThreadEvents(threadId: number, options: { limit?: number; offset?: number } = {}): SharedThreadEvent[] {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const offset = Math.max(0, options.offset ?? 0);
  // Offset is from the newest end so initial load returns the latest events.
  const rows = db.select({
    event: threadEventsTable.event,
  })
    .from(threadEventsTable)
    .where(eq(threadEventsTable.threadId, threadId))
    .orderBy(desc(threadEventsTable.id))
    .limit(limit)
    .offset(offset)
    .all() as { event: SharedThreadEvent }[];

  // Return events oldest -> newest within the page.
  return rows.map((row) => row.event).reverse();
}
