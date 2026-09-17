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
      if (tokens.length === 0) return;

      const seenGrant = new Set<string>();
      unsubscribeRef.current = subscribeLiveGps(tokens, (ev) => {
        // Always tell the Live Map (it subscribes via window event)
        emitLiveGpsEvent(ev);
        // Raise the bell badge (panel listens for this event)
        window.dispatchEvent(new Event(LIVE_GPS_BELL_EVENT));

        const coords = `${ev.latitude.toFixed(5)}, ${ev.longitude.toFixed(5)}`;

        if (ev.type === "grant" && !seenGrant.has(ev.token)) {
          seenGrant.add(ev.token);
          const title = "📍 Location access accepted!";
          const body = `Live GPS is streaming: ${coords} — open Live Map`;

          toast({ title, description: "Open Live Map to see them in real time." });
          try {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(title, { body, icon: "/falcon-logo.png", tag: `grant-${ev.token}` });
            }
          } catch { /* notifications unavailable — toast already shown */ }
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
