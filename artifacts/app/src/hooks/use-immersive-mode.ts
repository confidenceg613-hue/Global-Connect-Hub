import { useEffect } from "react";

/**
 * Immersive-mode hook — CSS/manifest-only approach.
 *
 * We deliberately do NOT call requestFullscreen() because:
 *  • It triggers the browser's "To exit full screen, swipe up / press Esc"
 *    notification banner on every launch, which is jarring and unwanted.
 *  • The PWA manifest already sets `"display": "fullscreen"` so installed
 *    apps get real fullscreen without any JS call or popup.
 *  • For non-installed browser sessions, 100dvh + overflow:hidden gives a
 *    visually full-screen experience without any notification.
 *
 * This hook only locks portrait orientation (no visible side-effects).
 */
export function useImmersiveMode() {
  useEffect(() => {
    const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    orient?.lock?.("portrait").catch(() => {});
  }, []);
}
