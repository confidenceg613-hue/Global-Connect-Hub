// Browser-based approximation of Android's Fused Location Provider (FLP).
//
// True FLP is a native Google Play Services API — it isn't reachable from a
// website. What we *can* do in a browser is replicate its core idea: blend a
// fast, low-power network/WiFi fix with a slower, high-accuracy GPS fix, and
// always surface whichever reading currently has the best (lowest) accuracy
// radius — the same "fusion" behavior FLP performs internally.
//
// This hook exposes a single `FusedPosition` that upgrades over time as
// better fixes arrive, plus a `source` label so the UI can show where the
// current reading came from.

import { useCallback, useEffect, useRef, useState } from "react";

export type LocationSource = "network" | "gps" | "fused" | "ip_geo";

export interface FusedPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
  source: LocationSource;
  timestamp: number;
}

// Accuracy radius (meters) under which we consider a fix "GPS-grade".
const GPS_ACCURACY_THRESHOLD_M = 30;

export function classifySource(accuracy: number, sawNetworkFix: boolean, sawGpsFix: boolean): LocationSource {
  if (sawNetworkFix && sawGpsFix) return "fused";
  if (accuracy <= GPS_ACCURACY_THRESHOLD_M) return "gps";
  return "network";
}

export interface UseFusedLocationOptions {
  /** Continuously refine via watchPosition once the first fix lands. Default true. */
  watch?: boolean;
  /**
   * Optional async function called when GPS fails with no cached fix.
   * Should return a coarse position from server-side IP geolocation, or null.
   * The result will be surfaced with source = "ip_geo" and typically carries
   * a very large accuracy radius (5 000–50 000 m).
   */
  ipGeoFallback?: () => Promise<{ latitude: number; longitude: number; accuracy: number } | null>;
}

export function useFusedLocation(options: UseFusedLocationOptions = {}) {
  const { watch = true } = options;
  const [position, setPosition] = useState<FusedPosition | null>(null);
  const [error, setError] = useState<GeolocationPositionError | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  const bestRef = useRef<FusedPosition | null>(null);
  const sawNetworkRef = useRef(false);
  const sawGpsRef = useRef(false);
  const watchIdRef = useRef<number | null>(null);
  const ipGeoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep ipGeoFallback in a ref so the start() callback doesn't go stale
  const ipGeoFallbackRef = useRef(options.ipGeoFallback);
  useEffect(() => { ipGeoFallbackRef.current = options.ipGeoFallback; }, [options.ipGeoFallback]);

  const ingest = useCallback((pos: GeolocationPosition, isHighAccuracyRequest: boolean) => {
    const { latitude, longitude, accuracy } = pos.coords;
    if (isHighAccuracyRequest) sawGpsRef.current = true;
    else sawNetworkRef.current = true;

    const prev = bestRef.current;
    // Only accept the new fix if we don't have one yet, or it's more precise
    // (smaller accuracy radius) than what we're currently showing — this is
    // the core "fusion" rule: always trust the tightest available reading.
    if (!prev || accuracy <= prev.accuracy) {
      const next: FusedPosition = {
        latitude,
        longitude,
        accuracy,
        source: classifySource(accuracy, sawNetworkRef.current, sawGpsRef.current),
        timestamp: pos.timestamp,
      };
      bestRef.current = next;
      setPosition(next);
    } else if (sawNetworkRef.current && sawGpsRef.current && prev.source !== "fused") {
      // Both provider types have now reported at least once — relabel as fused
      // even if this particular reading wasn't itself the best.
      const relabeled: FusedPosition = { ...prev, source: "fused" };
      bestRef.current = relabeled;
      setPosition(relabeled);
    }
    setIsResolving(false);
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) {
      setError({ code: 2, message: "Geolocation not supported", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
      // Still try IP geo as a last resort when the API is completely absent
      if (ipGeoFallbackRef.current) {
        ipGeoFallbackRef.current().then((fb) => {
          if (!fb || bestRef.current) return;
          const next: FusedPosition = { latitude: fb.latitude, longitude: fb.longitude, accuracy: fb.accuracy, source: "ip_geo", timestamp: Date.now() };
          bestRef.current = next;
          setPosition(next);
        }).catch(() => {});
      }
      return;
    }
    setIsResolving(true);
    // After 8 s with no GPS result, try the IP geo fallback as a coarse stand-in
    if (ipGeoFallbackRef.current) {
      if (ipGeoTimerRef.current !== null) clearTimeout(ipGeoTimerRef.current);
      ipGeoTimerRef.current = setTimeout(async () => {
        if (bestRef.current) return; // GPS won the race — nothing to do
        try {
          const fb = await ipGeoFallbackRef.current?.();
          if (!fb || bestRef.current) return;
          const next: FusedPosition = { latitude: fb.latitude, longitude: fb.longitude, accuracy: fb.accuracy, source: "ip_geo", timestamp: Date.now() };
          bestRef.current = next;
          setPosition(next);
          setIsResolving(false);
        } catch { /* non-critical */ }
      }, 8_000);
    }

    // 1. Instant: accept any cached position the browser holds (super-fast path).
    //    Android caches the last known fix from any app — often < 100 ms.
    navigator.geolocation.getCurrentPosition(
      (pos) => ingest(pos, false),
      () => {},
      { enableHighAccuracy: false, timeout: 200, maximumAge: Infinity },
    );

    // 2. Fast, low-power fix (network/WiFi/cell) — accept up to 10-s-old cache
    //    for near-instant delivery while the GPS radio warms up.
    navigator.geolocation.getCurrentPosition(
      (pos) => ingest(pos, false),
      (err) => { if (!bestRef.current) setError(err); },
      { enableHighAccuracy: false, timeout: 500, maximumAge: 10_000 },
    );

    // 3. High-accuracy GPS fix in parallel — aggressive 5 s timeout, no cache.
    navigator.geolocation.getCurrentPosition(
      (pos) => ingest(pos, true),
      (err) => { if (!bestRef.current) setError(err); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );

    // 4. Continuous high-accuracy stream — 0 ms interval, 0 ms maximumAge for
    //    maximum update rate (device-limited, typically 1 Hz GPS or faster).
    if (watch) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => ingest(pos, true),
        (err) => setError(err),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
      );
    }
  }, [ingest, watch]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (ipGeoTimerRef.current !== null) {
      clearTimeout(ipGeoTimerRef.current);
      ipGeoTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { position, error, isResolving, start, stop };
}
