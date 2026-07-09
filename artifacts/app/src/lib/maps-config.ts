/**
 * Free, no-card map services replacing the Google Maps-dependent features:
 * - Satellite imagery: Esri World Imagery (no key required)
 * - Street-level photos: Mapillary via backend proxy (needs MAPILLARY_ACCESS_TOKEN)
 * - Address links: OpenStreetMap
 */

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface StreetViewResult {
  available: boolean;
  embedUrl?: string;
  imageUrl?: string;
}

/** Look up the nearest Mapillary street-level photo near a coordinate. */
export async function fetchStreetView(lat: number, lng: number): Promise<StreetViewResult> {
  try {
    const r = await fetch(`${API_BASE}/api/maps/street-view?lat=${lat}&lng=${lng}`);
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { available: false };
    return { available: !!json.available, embedUrl: json.embedUrl, imageUrl: json.imageUrl };
  } catch {
    return { available: false };
  }
}

/** Esri World Imagery static export — free, no API key or billing required. */
export function satelliteImageUrl(lat: number, lng: number, spanDeg = 0.006): string {
  const minLon = lng - spanDeg;
  const maxLon = lng + spanDeg;
  const minLat = lat - spanDeg * 0.7;
  const maxLat = lat + spanDeg * 0.7;
  const bbox = `${minLon},${minLat},${maxLon},${maxLat}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=600,400&imageSR=3857&format=png&f=image`;
}

/** External map link (opens in browser) — OpenStreetMap, no key needed. */
export function streetViewUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
