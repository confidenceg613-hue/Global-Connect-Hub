/**
 * PhoneLink local SQLite schema for offline AI / RAG
 *
 * All data stays 100% on-device. The tables mirror the server's data model
 * so a sync pass can populate them while online; the AI works entirely from
 * the cached copy when offline.
 */

// ─── TypeScript types ─────────────────────────────────────────────────────────

export interface LocalLocationPoint {
  id: number;
  contact_token: string;
  contact_name: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: 'active' | 'offline';
  source: string | null;
  timestamp: string;         // ISO-8601
  day_of_week: number;       // 0=Sun … 6=Sat
  hour_of_day: number;       // 0-23
}

export interface LocalRoute {
  id: number;
  contact_token: string;
  contact_name: string | null;
  start_time: string;
  end_time: string;
  distance_m: number;
  point_count: number;
  start_address: string | null;
  end_address: string | null;
  summary: string | null;
}

export interface LocalNote {
  id: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  note: string;
  created_at: string;
  tags: string | null;        // JSON array
}

export interface RagDocument {
  id: number;
  doc_type: string;          // 'location_summary' | 'route' | 'note' | 'pattern' | 'day'
  content: string;           // plain text, indexed by BM25
  metadata: string | null;   // JSON blob
  contact_token: string | null;
  created_at: string;
  date_key: string | null;   // YYYY-MM-DD for date filtering
}

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
  metadata: string | null;   // JSON (actions parsed from response, etc.)
}

// ─── DDL ─────────────────────────────────────────────────────────────────────

export const DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS location_points (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_token   TEXT    NOT NULL,
  contact_name    TEXT,
  latitude        REAL    NOT NULL,
  longitude       REAL    NOT NULL,
  accuracy        REAL,
  address         TEXT,
  status          TEXT    NOT NULL DEFAULT 'active',
  source          TEXT,
  timestamp       TEXT    NOT NULL,
  day_of_week     INTEGER NOT NULL DEFAULT 0,
  hour_of_day     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lp_token ON location_points (contact_token);
CREATE INDEX IF NOT EXISTS idx_lp_ts    ON location_points (timestamp);

CREATE TABLE IF NOT EXISTS routes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_token   TEXT    NOT NULL,
  contact_name    TEXT,
  start_time      TEXT    NOT NULL,
  end_time        TEXT    NOT NULL,
  distance_m      REAL    NOT NULL DEFAULT 0,
  point_count     INTEGER NOT NULL DEFAULT 0,
  start_address   TEXT,
  end_address     TEXT,
  summary         TEXT
);
CREATE INDEX IF NOT EXISTS idx_routes_token ON routes (contact_token);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  latitude   REAL,
  longitude  REAL,
  address    TEXT,
  note       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  tags       TEXT
);

CREATE TABLE IF NOT EXISTS rag_documents (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type       TEXT    NOT NULL,
  content        TEXT    NOT NULL,
  metadata       TEXT,
  contact_token  TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  date_key       TEXT
);
CREATE INDEX IF NOT EXISTS idx_rag_type     ON rag_documents (doc_type);
CREATE INDEX IF NOT EXISTS idx_rag_date     ON rag_documents (date_key);
CREATE INDEX IF NOT EXISTS idx_rag_contact  ON rag_documents (contact_token);

CREATE TABLE IF NOT EXISTS chat_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  metadata   TEXT
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL
);
`;
