/**
 * Singleton SQLite database connection for offline AI / RAG.
 * Uses expo-sqlite v15 async API (SDK 53+).
 */
import * as SQLite from 'expo-sqlite';
import { DDL } from './schema';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('phonelink_ai.db');
  await _db.execAsync(DDL);
  return _db;
}

/** Convenience wrappers ─────────────────────────────────────────────────── */

export async function dbRun(sql: string, args: unknown[] = []): Promise<void> {
  const db = await getDb();
  await db.runAsync(sql, args);
}

export async function dbAll<T>(sql: string, args: unknown[] = []): Promise<T[]> {
  const db = await getDb();
  return db.getAllAsync<T>(sql, args);
}

export async function dbFirst<T>(sql: string, args: unknown[] = []): Promise<T | null> {
  const db = await getDb();
  return db.getFirstAsync<T>(sql, args);
}

/** Bulk insert inside a single transaction for performance. */
export async function dbBulkInsert(
  sql: string,
  rows: unknown[][],
): Promise<void> {
  if (rows.length === 0) return;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const row of rows) {
      await db.runAsync(sql, row);
    }
  });
}
