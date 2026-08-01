import { useEffect } from "react";

/**
 * Permanent immersive / kiosk fullscreen.
 *
 * Strategy:
 * 1. Try requestFullscreen immediately on mount (works if there is already a
 *    gesture in flight, e.g. the PWA launch tap).
 * 2. Arm a listener on the first touchstart/click so the very first tap after
 *    mount also triggers it.
 * 3. On every fullscreenchange (user swiped down status bar, pressed back,
 *    etc.) re-arm immediately — the next tap re-enters fullscreen.
 * 4. Runs unconditionally (not gated on display-mode) so it works whether the
 *    user installed the PWA or opened it directly.
 * 5. Locks portrait orientation as a side effect.
 */
export function useImmersiveMode() {
  useEffect(() => {
    const lockOrientation = () => {
      const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      orient?.lock?.("portrait").catch(() => {});
    };

    const enterFullscreen = () => {
      if (document.fullscreenElement) {
        lockOrientation();
        return;
      }
      const el = document.documentElement;
      if (!el.requestFullscreen) return;
      el.requestFullscreen({ navigationUI: "hide" })
        .then(lockOrientation)
        .catch(() => {});
    };

    // Arm: add one-shot listeners so the NEXT gesture calls enterFullscreen.
    // Returns a cleanup that removes those listeners.
    let cleanupArm: (() => void) | null = null;
    const arm = () => {
      cleanupArm?.();
      const handler = () => {
        cleanupArm = null;
        enterFullscreen();
        // Re-arm immediately after so subsequent gestures keep it fullscreen
        arm();
      };
      document.addEventListener("touchstart", handler, { once: true, passive: true });
      document.addEventListener("click",      handler, { once: true });
      cleanupArm = () => {
        document.removeEventListener("touchstart", handler);
        document.removeEventListener("click",      handler);
      };
    };

    // When fullscreen is lost, re-arm so the very next gesture re-enters it
    const onFsChange = () => {
      if (!document.fullscreenElement) arm();
    };
    document.addEventListener("fullscreenchange", onFsChange);

    // Attempt immediately (succeeds if a gesture is already in flight at mount)
    enterFullscreen();
    // Also arm for the first real tap
    arm();

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      cleanupArm?.();
    };
  }, []);
}
