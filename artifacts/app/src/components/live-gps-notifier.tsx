/**
 * LiveGpsNotifier — app-wide listener for the live GPS channel.
 *
 * Owner experience: the moment someone opens their share link and accepts,
 * this component:
 *   1. Raises the bell badge (same counter the panel uses)
 *   2. Fires an in-app toast  "📍 Your contact started sharing location"
 *   3. Fires a system notification (if permission granted)
 *   4. Dispatches a window event that the Live Map listens to
 *      so the marker appears instantly without polling.
 *
 * The mqtt client is dynamically imported — never in the boot bundle.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { LIVE_GPS_BELL_EVENT } from "@/lib/live-gps";

export const LIVE_GPS_EVENT = "df:live-gps";

// Per-browser-session dedupe: a token whose FIRST live event we have already
// notified about in this tab session. Session-scoped on purpose — unlike the
// old permanent localStorage set, accepting the same link again on a new day
// notifies again, and a page reload during active streaming does not spam.
// The 90s grace window covers reloads within an active sharing session.
const SESSION_NOTIFIED_KEY = "df_session_notified_v1";
const GRACE_MS = 90_000;

function getSessionNotified(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(SESSION_NOTIFIED_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch { return {}; }
}

function markSessionNotified(token: string): void {
  try {
    const obj = getSessionNotified();
    obj[token] = Date.now();
    sessionStorage.setItem(SESSION_NOTIFIED_KEY, JSON.stringify(obj));
  } catch { /* non-critical */ }
}

function wasRecentlyNotified(token: string): boolean {
  const ts = getSessionNotified()[token];
  return typeof ts === "number" && Date.now() - ts < GRACE_MS;
}

// ── Durable grant notifications (sender side, no backend needed) ────────────
const NOTIFS_KEY = "df_owner_notifs_v1";

export interface OwnerNotifEntry {
  id: number;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export function getOwnerNotifs(): OwnerNotifEntry[] {
  try {
    const raw = localStorage.getItem(NOTIFS_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

export function saveNotifEntry(entry: OwnerNotifEntry): void {
  try {
    const all = getOwnerNotifs();
    if (all.some((n) => n.id === entry.id)) return;
    all.push(entry);
    localStorage.setItem(NOTIFS_KEY, JSON.stringify(all.slice(-200)));
  } catch { /* non-critical */ }
}

function contactLabel(token: string): string {
  // Look up a friendly name from the durable owner registry (async best-effort
  // is fine — the label is cosmetic; coordinates are always shown).
  try {
    const mod = (window as unknown as { __dfOwnerInvites?: { getOwnerInvite(t: string): { toName?: string; toPhone?: string } | undefined } }).__dfOwnerInvites;
    const inv = mod?.getOwnerInvite(token);
    return inv?.toName || inv?.toPhone || "Your contact";
  } catch { return "Your contact"; }
}

export function emitLiveGpsEvent(ev: unknown) {
  window.dispatchEvent(new CustomEvent(LIVE_GPS_EVENT, { detail: ev }));
}

export default function LiveGpsNotifier() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!userId) return;
    let disposed = false;

    void import("@/lib/live-gps").then(({ subscribeLiveGps, getOwnerTokens }) => {
      if (disposed) return;
      const tokens = getOwnerTokens();

      const firstContact = new Set<string>();
      unsubscribeRef.current = subscribeLiveGps(tokens, (ev) => {
        // Update the durable owner-invite registry so the sender's list/map
        // keep the contact's latest coordinates across reloads.
        void import("@/lib/owner-invites").then(({ markOwnerInviteLive }) =>
          markOwnerInviteLive(ev.token, { latitude: ev.latitude, longitude: ev.longitude, ts: ev.ts, type: ev.type }));

        // ALWAYS tell the Live Map and raise the bell badge first — the map
        // needs every GPS fix, and the bell counts activity even when we have
        // already toasted this token recently.
        emitLiveGpsEvent(ev);
        window.dispatchEvent(new Event(LIVE_GPS_BELL_EVENT));

        // Grant-or-first-GPS detection: notify exactly once per acceptance.
        // A "grant" event is the invitee's explicit consent; an early "gps"
        // event (grant published before the sender's app reopened, or MQTT
        // grant lost) is the catch-up signal so an offline sender still learns
        // their contact is now sharing.
        const isGrant = ev.type === "grant";
        const alreadyInSession = firstContact.has(ev.token);
        if (!alreadyInSession) {
          firstContact.add(ev.token);
          if (!isGrant && wasRecentlyNotified(ev.token)) {
            // Grant toast already delivered for this acceptance (reload
            // during active streaming) — do not toast again.
          } else {
            markSessionNotified(ev.token);
            const coords = `${ev.latitude.toFixed(5)}, ${ev.longitude.toFixed(5)}`;
            const label = contactLabel(ev.token);

            // Durable entry — survives reload, shows in the drawer even
            // without a database.
            saveNotifEntry({
              id: ev.ts,
              type: "location_granted",
              title: "📍 Location access granted",
              body: `${label} shared their location: ${coords}`,
              data: { token: ev.token, latitude: ev.latitude, longitude: ev.longitude, accuracy: ev.accuracy },
              createdAt: new Date(ev.ts).toISOString(),
            });

            const title = isGrant ? "📍 Location access accepted!" : "📍 Live location started";
            const body = `${label} — live GPS streaming: ${coords}`;
            toast({ title, description: "Open Live Map to see them in real time." });
            try {
              if (typeof Notification !== "undefined" && Notification.permission === "granted") {
                new Notification(title, { body, icon: "/falcon-logo.png", tag: `grant-${ev.token}` });
              }
            } catch { /* notifications unavailable — toast already shown */ }
          }
        }
      });
    }).catch(() => { /* module load failure — non-critical */ });

    return () => {
      disposed = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [userId, toast]);

  return null;
}
