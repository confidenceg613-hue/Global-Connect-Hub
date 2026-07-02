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

export type LocationSource = "network" | "gps" | "fused";

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
      return;
    }
    setIsResolving(true);

    // 1. Fast, low-power fix (network/WiFi/cell) — usually resolves in <1s.
    navigator.geolocation.getCurrentPosition(
      (pos) => ingest(pos, false),
      (err) => { if (!bestRef.current) setError(err); },
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60000 },
    );

    // 2. High-accuracy GPS fix in parallel — refines the fused reading once it lands.
    navigator.geolocation.getCurrentPosition(
      (pos) => ingest(pos, true),
      (err) => { if (!bestRef.current) setError(err); },
      { enableHighAccuracy: true, timeout: 15000 },
    );

    // 3. Continuous refinement stream, mirroring FLP's PRIORITY_HIGH_ACCURACY
    //    behavior once tracking is underway.
    if (watch) {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => ingest(pos, true),
        (err) => setError(err),
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 },
      );
    }
  }, [ingest, watch]);

  const stop = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => () => stop(), [stop]);

  return { position, error, isResolving, start, stop };
}
