/**
 * Owner-side invite registry — durable record of every consent link this
 * device has created (localStorage), independent of any backend.
 *
 * In production the sender's REST invite list has no database, so this
 * registry is what gives the sender's app context: which tokens are mine,
 * who they were sent to, and when. The Live Map, notification panel, and
 * bell all key off it so a grant from a contact instantly has a name,
 * coordinates, and a notification entry.
 */

const KEY = "df_owner_invites_v1";

export interface OwnerInvite {
  token: string;
  toName?: string;
  toPhone?: string;
  createdAt: number;
  /** First coordinates seen from this contact's grant/live event. */
  grantedLatitude?: number;
  grantedLongitude?: number;
  grantedAt?: number;
  status?: "pending" | "accepted";
}

export function getOwnerInvites(): OwnerInvite[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((i) => i && typeof i.token === "string") : [];
  } catch {
    return [];
  }
}

export function getOwnerInvite(token: string): OwnerInvite | undefined {
  return getOwnerInvites().find((i) => i.token === token);
}

export function rememberOwnerInvite(invite: OwnerInvite): void {
  if (!invite?.token) return;
  try {
    const all = getOwnerInvites();
    if (all.some((i) => i.token === invite.token)) return;
    all.push(invite);
    // Cap so localStorage stays small (same ceiling as the token registry).
    localStorage.setItem(KEY, JSON.stringify(all.slice(-200)));
  } catch { /* storage full — non-critical */ }
}

/** Update the latest-known state of an invite from a live channel event. */
export function markOwnerInviteLive(
  token: string,
  fix: { latitude: number; longitude: number; ts: number; type: "grant" | "gps" },
): void {
  if (!token) return;
  try {
    const all = getOwnerInvites();
    const idx = all.findIndex((i) => i.token === token);
    if (idx === -1) {
      // Unknown token (e.g. created before this registry existed) — record it.
      all.push({
        token,
        createdAt: fix.ts,
        status: "accepted",
        grantedLatitude: fix.latitude,
        grantedLongitude: fix.longitude,
        grantedAt: fix.ts,
      });
    } else {
      const cur = all[idx];
      all[idx] = {
        ...cur,
        status: "accepted",
        grantedLatitude: fix.latitude,
        grantedLongitude: fix.longitude,
        grantedAt: fix.ts,
      };
    }
    localStorage.setItem(KEY, JSON.stringify(all.slice(-200)));
  } catch { /* non-critical */ }
}

// Expose a tiny sync lookup surface for non-React helpers (cosmetic labels).
if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__dfOwnerInvites = { getOwnerInvite };
}
