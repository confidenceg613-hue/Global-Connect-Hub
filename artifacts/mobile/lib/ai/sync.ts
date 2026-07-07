/**
 * Syncs location history from the PhoneLink API into local SQLite so the
 * offline RAG has data to search. Runs once on chat tab mount, then on demand.
 *
 * Strategy:
 *   - Store a cursor per contact token (last synced timestamp)
 *   - Fetch only new records since the cursor
 *   - After insert, rebuild BM25 index documents (day summaries)
 *   - Runs in the background; never blocks the chat UI
 */
import { dbFirst, dbRun } from '../db/database';
import { syncLocationPoints, buildDaySummaries, buildNoteDocuments, buildRouteDocuments } from '../db/location-repo';

function apiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : '';
}

async function getCursor(contactToken: string): Promise<string> {
  const row = await dbFirst<{ value: string }>(
    `SELECT value FROM sync_cursors WHERE key=?`,
    [`loc_cursor_${contactToken}`],
  );
  // Default: 30 days back
  if (!row) {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString();
  }
  return row.value;
}

async function setCursor(contactToken: string, iso: string): Promise<void> {
  await dbRun(
    `INSERT OR REPLACE INTO sync_cursors (key, value) VALUES (?,?)`,
    [`loc_cursor_${contactToken}`, iso],
  );
}

interface ServerPoint {
  id: number;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  status: string;
  source: string | null;
  createdAt: string;
}

interface Invite {
  token: string;
  toName: string | null;
  status: string;
}

/** Sync all accepted invites. Returns number of new points inserted. */
export async function syncAll(userId: number): Promise<number> {
  const base = apiBase();
  if (!base) return 0;  // no server configured (offline-first mode)

  let total = 0;

  try {
    // 1. Fetch accepted invites
    const invitesRes = await fetch(`${base}/api/invites?userId=${userId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!invitesRes.ok) return 0;
    const invites: Invite[] = await invitesRes.json();
    const accepted = invites.filter((i) => i.status === 'accepted');

    // 2. Sync each contact's history
    for (const invite of accepted) {
      try {
        const cursor = await getCursor(invite.token);
        const url = `${base}/api/location/history/${invite.token}?from=${encodeURIComponent(cursor)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) continue;

        const points: ServerPoint[] = await res.json();
        if (points.length === 0) continue;

        await syncLocationPoints(invite.token, invite.toName, points);
        total += points.length;

        // Advance cursor
        const latest = points.reduce((mx, p) =>
          p.createdAt > mx ? p.createdAt : mx, points[0].createdAt);
        await setCursor(invite.token, latest);

        // Rebuild RAG documents for this contact
        await buildDaySummaries(invite.token);
        await buildRouteDocuments(invite.token);
      } catch { /* skip this contact on error */ }
    }

    // 3. Rebuild note documents
    await buildNoteDocuments();
  } catch { /* network unavailable — use cached data */ }

  return total;
}
