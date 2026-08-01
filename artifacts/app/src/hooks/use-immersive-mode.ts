import { useEffect } from "react";

/**
 * Requests fullscreen + locks portrait orientation when the app is running as
 * an installed PWA. Fullscreen is re-requested on the first user gesture after
 * the browser exits it (e.g. after a back-gesture dismisses it temporarily).
 */
export function useImmersiveMode() {
  useEffect(() => {
    // Only activate inside an installed PWA shell
    const isPwa =
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (!isPwa) return;

    const lockOrientation = () => {
      const orient = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (orient?.lock) {
        orient.lock("portrait").catch(() => {/* non-critical */});
      }
    };

    const requestFs = () => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement
          .requestFullscreen({ navigationUI: "hide" })
          .then(lockOrientation)
          .catch(() => {/* browser may reject without gesture */});
      } else {
        lockOrientation();
      }
    };

    // Re-arm on next gesture whenever fullscreen is lost
    let armed = false;
    const arm = () => {
      if (armed) return;
      armed = true;
      const onGesture = () => {
        armed = false;
        requestFs();
      };
      document.addEventListener("touchstart", onGesture, { once: true, passive: true });
      document.addEventListener("click", onGesture, { once: true });
    };

    const onFsChange = () => {
      if (!document.fullscreenElement) arm();
    };
    document.addEventListener("fullscreenchange", onFsChange);

    // Kick off immediately (will succeed if there's already a gesture in flight)
    requestFs();
    // Also arm so the very first tap finishes the job if requestFs was too early
    arm();

    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, []);
}
