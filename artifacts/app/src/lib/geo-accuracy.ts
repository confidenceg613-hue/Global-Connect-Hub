// GPS accuracy priority enforcer (installed once at app boot).
//
// Wraps navigator.geolocation.watchPosition/getCurrentPosition so every
// consumer — consent-page tracking, group share, live map — always requests
// the device's most accurate, freshest fixes regardless of per-call options:
//   • enableHighAccuracy forced on  (GPS chip, not coarse network/cell fix)
//   • maximumAge capped at 5 s      (never serve a stale cached position)
//   • timeout raised to ≥15 s       (give the GPS lock time to converge
//                                    before the error callback fires)
//
// TODO(offline-consent): coordinates still need the hosted API to reach the
// owner's map; this guarantees the fixes themselves are as precise as the
// device can provide once that pipe exists.

type GeoPositionOptions = PositionOptions;

function hardenOptions(opts?: GeoPositionOptions): GeoPositionOptions {
  const o = opts ?? {};
  return {
    ...o,
    enableHighAccuracy: true,
    maximumAge: Math.min(o.maximumAge ?? 5000, 5000),
    timeout: Math.max(o.timeout ?? 15000, 15000),
  };
}

let installed = false;

export function installHighAccuracyGeo(): void {
  if (installed || typeof navigator === "undefined" || !navigator.geolocation) return;
  installed = true;

  const geo = navigator.geolocation;
  const proto = Object.getPrototypeOf(geo) as Geolocation;

  const origWatch = geo.watchPosition.bind(geo);
  const origCurrent = geo.getCurrentPosition.bind(geo);

  proto.watchPosition = function watchPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: GeoPositionOptions,
  ): number {
    return origWatch(success, error ?? undefined, hardenOptions(options));
  };

  proto.getCurrentPosition = function getCurrentPosition(
    success: PositionCallback,
    error?: PositionErrorCallback | null,
    options?: GeoPositionOptions,
  ): void {
    origCurrent(success, error ?? undefined, hardenOptions(options));
  };
}
