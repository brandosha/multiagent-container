import Database from "better-sqlite3";
import { ThreadEvent } from "@openai/codex-sdk";
import path from "path";

import { agentsDir } from "./paths.js";

const dbPath = path.join(agentsDir, "multiagent-container.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY,
    codex_thread_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS thread_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    event_json TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (thread_id) REFERENCES threads(id)
  );

  CREATE INDEX IF NOT EXISTS thread_events_thread_id_id_idx
    ON thread_events(thread_id, id);
`);

const ensureThreadStatement = db.prepare(`
  INSERT INTO threads (id)
  VALUES (@id)
  ON CONFLICT(id) DO UPDATE SET updated_at = datetime('now')
`);

const setCodexThreadIdStatement = db.prepare(`
  UPDATE threads
  SET codex_thread_id = @codexThreadId,
      updated_at = datetime('now')
  WHERE id = @id
`);

const recordEventStatement = db.prepare(`
  INSERT INTO thread_events (thread_id, type, event_json)
  VALUES (@threadId, @type, @eventJson)
`);

const getEventsStatement = db.prepare(`
  SELECT id, thread_id AS threadId, type, event_json AS eventJson, timestamp
  FROM thread_events
  WHERE thread_id = @threadId
  ORDER BY id ASC
  LIMIT @limit OFFSET @offset
`);

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
  eventJson: string;
}

export function ensureThread(id: number) {
  ensureThreadStatement.run({ id });
}

export function setCodexThreadId(id: number, codexThreadId: string) {
  ensureThread(id);
  setCodexThreadIdStatement.run({ id, codexThreadId });
}

export function recordThreadEvent(threadId: number, event: ThreadEvent) {
  ensureThread(threadId);
  recordEventStatement.run({
    threadId,
    type: event.type,
    eventJson: JSON.stringify(event),
  });
}

export function getThreadEvents(threadId: number, options: { limit?: number; offset?: number } = {}): StoredThreadEvent[] {
  ensureThread(threadId);
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = getEventsStatement.all({ threadId, limit, offset }) as StoredThreadEventRow[];

  return rows.map((row) => ({
    id: row.id,
    threadId: row.threadId,
    type: row.type,
    timestamp: row.timestamp,
    event: JSON.parse(row.eventJson) as ThreadEvent,
  }));
}
