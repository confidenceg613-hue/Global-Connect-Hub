/**
 * Location data repository — all queries the RAG pipeline uses.
 */
import type { SQLiteBindParams } from 'expo-sqlite';
import { dbAll, dbFirst, dbRun, dbBulkInsert } from './database';
import type { LocalLocationPoint, LocalRoute, LocalNote, RagDocument } from './schema';
import { haversineM } from '../utils/geo';

// ─── Sync helpers ─────────────────────────────────────────────────────────────

/** Upsert a batch of location points from the server. */
export async function syncLocationPoints(
  contactToken: string,
  contactName: string | null,
  points: Array<{
    latitude: number;
    longitude: number;
    accuracy?: number | null;
    address?: string | null;
    status: string;
    source?: string | null;
    createdAt: string;
  }>,
): Promise<void> {
  const sql = `
    INSERT OR IGNORE INTO location_points
      (contact_token, contact_name, latitude, longitude, accuracy,
       address, status, source, timestamp, day_of_week, hour_of_day)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  const rows = points.map((p) => {
    const d = new Date(p.createdAt);
    return [
      contactToken, contactName,
      p.latitude, p.longitude, p.accuracy ?? null,
      p.address ?? null, p.status, p.source ?? null,
      p.createdAt, d.getDay(), d.getHours(),
    ];
  });
  await dbBulkInsert(sql, rows);
}

// ─── RAG document builders ───────────────────────────────────────────────────

/** Build day-level summary documents for BM25 indexing. */
export async function buildDaySummaries(contactToken: string): Promise<void> {
  // Remove old summaries for this contact to rebuild fresh
  await dbRun(`DELETE FROM rag_documents WHERE doc_type='day' AND contact_token=?`, [contactToken]);

  // Group by calendar date
  const days = await dbAll<{ date_key: string; contact_name: string | null }>(
    `SELECT DISTINCT strftime('%Y-%m-%d', timestamp) AS date_key, contact_name
     FROM location_points
     WHERE contact_token=? AND status='active'
     ORDER BY date_key`,
    [contactToken],
  );

  for (const { date_key, contact_name } of days) {
    const pts = await dbAll<LocalLocationPoint>(
      `SELECT * FROM location_points
       WHERE contact_token=? AND strftime('%Y-%m-%d', timestamp)=? AND status='active'
       ORDER BY timestamp`,
      [contactToken, date_key],
    );
    if (pts.length === 0) continue;

    const totalDist = computeTotalDistance(pts);
    const uniqueAddrs = uniqueList(pts.map((p) => p.address).filter(Boolean) as string[]);
    const firstAddr = pts[0].address ?? `${pts[0].latitude.toFixed(4)},${pts[0].longitude.toFixed(4)}`;
    const lastAddr = pts[pts.length - 1].address ?? `${pts[pts.length - 1].latitude.toFixed(4)},${pts[pts.length - 1].longitude.toFixed(4)}`;
    const hours = pts.map((p) => p.hour_of_day);
    const dayName = dayOfWeekName(new Date(date_key).getDay());

    const content = [
      `${dayName} ${date_key} (${contact_name ?? contactToken}):`,
      `Locations visited: ${uniqueAddrs.join(', ') || 'unknown'}.`,
      `Started at ${firstAddr}, ended at ${lastAddr}.`,
      `${pts.length} GPS fixes, total distance ${(totalDist / 1000).toFixed(1)} km.`,
      `Active from ${formatHour(Math.min(...hours))} to ${formatHour(Math.max(...hours))}.`,
    ].join(' ');

    await dbRun(
      `INSERT INTO rag_documents (doc_type, content, metadata, contact_token, date_key)
       VALUES ('day', ?, ?, ?, ?)`,
      [
        content,
        JSON.stringify({ point_count: pts.length, distance_m: totalDist, addresses: uniqueAddrs }),
        contactToken,
        date_key,
      ],
    );
  }
}

/** Build route documents. */
export async function buildRouteDocuments(contactToken: string): Promise<void> {
  await dbRun(`DELETE FROM rag_documents WHERE doc_type='route' AND contact_token=?`, [contactToken]);

  const routes = await dbAll<LocalRoute>(
    `SELECT * FROM routes WHERE contact_token=? ORDER BY start_time`,
    [contactToken],
  );
  for (const r of routes) {
    const content = [
      `Route on ${r.start_time.slice(0, 10)}: from ${r.start_address ?? 'unknown'} to ${r.end_address ?? 'unknown'}.`,
      `Distance ${(r.distance_m / 1000).toFixed(1)} km, ${r.point_count} GPS points.`,
      r.summary ? `Summary: ${r.summary}.` : '',
    ].join(' ');
    await dbRun(
      `INSERT INTO rag_documents (doc_type, content, metadata, contact_token, date_key)
       VALUES ('route', ?, ?, ?, ?)`,
      [content, JSON.stringify(r), contactToken, r.start_time.slice(0, 10)],
    );
  }
}

/** Build note documents. */
export async function buildNoteDocuments(): Promise<void> {
  await dbRun(`DELETE FROM rag_documents WHERE doc_type='note'`);
  const notes = await dbAll<LocalNote>(`SELECT * FROM notes ORDER BY created_at`);
  for (const n of notes) {
    const locPart = n.address ? `at ${n.address}` : (n.latitude != null && n.longitude != null) ? `at (${n.latitude.toFixed(4)},${n.longitude.toFixed(4)})` : '';
    const content = `Note ${n.created_at.slice(0, 10)}${locPart ? ' ' + locPart : ''}: ${n.note}`;
    await dbRun(
      `INSERT INTO rag_documents (doc_type, content, metadata, date_key)
       VALUES ('note', ?, ?, ?)`,
      [content, JSON.stringify(n), n.created_at.slice(0, 10)],
    );
  }
}

// ─── Query helpers ───────────────────────────────────────────────────────────

/** All RAG documents, optionally filtered by date range and/or token. */
export async function getRagDocuments(opts: {
  docTypes?: string[];
  contactToken?: string;
  fromDate?: string;   // YYYY-MM-DD
  toDate?: string;
  limit?: number;
} = {}): Promise<RagDocument[]> {
  const clauses: string[] = [];
  const args: SQLiteBindParams = [];

  if (opts.docTypes?.length) {
    clauses.push(`doc_type IN (${opts.docTypes.map(() => '?').join(',')})`);
    (args as string[]).push(...opts.docTypes);
  }
  if (opts.contactToken) { clauses.push('contact_token=?'); (args as string[]).push(opts.contactToken); }
  if (opts.fromDate)     { clauses.push('date_key>=?');     (args as string[]).push(opts.fromDate); }
  if (opts.toDate)       { clauses.push('date_key<=?');     (args as string[]).push(opts.toDate); }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = opts.limit ? `LIMIT ${opts.limit}` : 'LIMIT 500';

  return dbAll<RagDocument>(`SELECT * FROM rag_documents ${where} ORDER BY date_key DESC ${limit}`, args);
}

/** Location points in a time window. */
export async function getLocationPoints(opts: {
  contactToken?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<LocalLocationPoint[]> {
  const clauses: string[] = ['status=\'active\''];
  const args: SQLiteBindParams = [];
  if (opts.contactToken) { clauses.push('contact_token=?'); (args as string[]).push(opts.contactToken); }
  if (opts.from) { clauses.push('timestamp>=?'); (args as string[]).push(opts.from); }
  if (opts.to)   { clauses.push('timestamp<=?'); (args as string[]).push(opts.to); }
  const where = `WHERE ${clauses.join(' AND ')}`;
  return dbAll<LocalLocationPoint>(
    `SELECT * FROM location_points ${where} ORDER BY timestamp LIMIT ${opts.limit ?? 2000}`,
    args,
  );
}

/** Aggregate pattern stats for a contact. */
export async function getPatternStats(contactToken: string): Promise<{
  topAddresses: Array<{ address: string; visits: number }>;
  activeHourDist: number[];   // 24-element array of hit counts
  dayOfWeekDist: number[];    // 7-element
  totalDays: number;
  totalDistanceKm: number;
}> {
  // Top addresses by visit count
  const addrRows = await dbAll<{ address: string; visits: number }>(
    `SELECT address, COUNT(*) AS visits
     FROM location_points
     WHERE contact_token=? AND address IS NOT NULL AND status='active'
     GROUP BY address ORDER BY visits DESC LIMIT 10`,
    [contactToken],
  );

  // Hour distribution
  const hourRows = await dbAll<{ hour_of_day: number; cnt: number }>(
    `SELECT hour_of_day, COUNT(*) AS cnt FROM location_points
     WHERE contact_token=? AND status='active' GROUP BY hour_of_day`,
    [contactToken],
  );
  const activeHourDist = Array(24).fill(0);
  for (const r of hourRows) activeHourDist[r.hour_of_day] = r.cnt;

  // Day-of-week distribution
  const dayRows = await dbAll<{ day_of_week: number; cnt: number }>(
    `SELECT day_of_week, COUNT(*) AS cnt FROM location_points
     WHERE contact_token=? AND status='active' GROUP BY day_of_week`,
    [contactToken],
  );
  const dayOfWeekDist = Array(7).fill(0);
  for (const r of dayRows) dayOfWeekDist[r.day_of_week] = r.cnt;

  // Total days with data
  const dayCount = await dbFirst<{ n: number }>(
    `SELECT COUNT(DISTINCT strftime('%Y-%m-%d', timestamp)) AS n
     FROM location_points WHERE contact_token=? AND status='active'`,
    [contactToken],
  );

  // Distance (approximate — between consecutive points per day)
  const pts = await getLocationPoints({ contactToken, limit: 5000 });
  const totalDist = computeTotalDistance(pts);

  return {
    topAddresses: addrRows,
    activeHourDist,
    dayOfWeekDist,
    totalDays: dayCount?.n ?? 0,
    totalDistanceKm: totalDist / 1000,
  };
}

/** Return the first synced contact token, or null if no data exists. */
export async function getFirstContactToken(): Promise<string | null> {
  const row = await dbFirst<{ contact_token: string }>(
    `SELECT contact_token FROM location_points LIMIT 1`,
  );
  return row?.contact_token ?? null;
}

/** Save a user note. */
export async function saveNote(note: {
  latitude?: number;
  longitude?: number;
  address?: string;
  text: string;
  tags?: string[];
}): Promise<void> {
  await dbRun(
    `INSERT INTO notes (latitude, longitude, address, note, created_at, tags)
     VALUES (?,?,?,?,?,?)`,
    [
      note.latitude ?? null,
      note.longitude ?? null,
      note.address ?? null,
      note.text,
      new Date().toISOString(),
      note.tags ? JSON.stringify(note.tags) : null,
    ],
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function computeTotalDistance(pts: LocalLocationPoint[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += haversineM(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
  }
  return total;
}

function uniqueList(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((s) => { if (seen.has(s)) return false; seen.add(s); return true; });
}

function dayOfWeekName(d: number) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d] ?? '';
}

function formatHour(h: number) {
  return h < 12 ? `${h || 12}am` : `${h === 12 ? 12 : h - 12}pm`;
}
