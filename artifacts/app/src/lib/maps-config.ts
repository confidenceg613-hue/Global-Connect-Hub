/**
 * Fetches and caches the Google Maps API key from the backend.
 * The key is needed client-side for Maps Embed API iframe URLs.
 */

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

let _cached: string | null = null;
let _fetched = false;

async function fetchMapsKey(): Promise<string | null> {
  if (_fetched) return _cached;
  try {
    const r = await fetch(`${API_BASE}/api/config`);
    if (r.ok) {
      const json = await r.json();
      _cached = typeof json.googleMapsApiKey === "string" ? json.googleMapsApiKey : null;
    }
  } catch {
    _cached = null;
  }
  _fetched = true;
  return _cached;
}

/** Build a Maps Embed API Street View src URL, falling back to the old svembed URL if no key. */
export async function streetViewSrc(lat: number, lng: number): Promise<string> {
  const key = await fetchMapsKey();
  if (key) {
    return `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${lat},${lng}&heading=0&pitch=0&fov=90`;
  }
  // Fallback: old-style embed (no key required, but may be rate-limited by Google)
  return `https://maps.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&z=17&output=svembed`;
}

/** Build a Maps Embed API Satellite view src URL, falling back to the old embed URL if no key. */
export async function satelliteSrc(lat: number, lng: number): Promise<string> {
  const key = await fetchMapsKey();
  if (key) {
    return `https://www.google.com/maps/embed/v1/view?key=${encodeURIComponent(key)}&center=${lat},${lng}&zoom=17&maptype=satellite`;
  }
  return `https://maps.google.com/maps?q=${lat},${lng}&t=k&z=16&output=embed`;
}

/** Build a Street View external link (opens in browser, no key needed). */
export function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}&cbp=11,0,0,0,0&z=17`;
}
