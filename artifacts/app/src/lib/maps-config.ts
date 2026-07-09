/**
 * Free, no-card map services replacing the Google Maps-dependent features:
 * - Satellite imagery: Esri World Imagery (no key required)
 * - Street-level photos: Mapillary via backend proxy (needs MAPILLARY_ACCESS_TOKEN)
 * - External "open in Maps" links: Google Maps satellite view (documented URLs API)
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

/**
 * A single Google Maps "hybrid" tile (satellite imagery + roads/labels)
 * centered on the given coordinate — used as a lightweight thumbnail image
 * wherever a full interactive map isn't needed. Uses Google's public tile
 * endpoint directly, same as the live map, so no API key/billing is needed.
 */
export function googleTileImageUrl(lat: number, lng: number, zoom = 16): string {
  const n = Math.pow(2, zoom);
  const xtile = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const ytile = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  const s = (xtile + ytile) % 4;
  return `https://mt${s}.google.com/vt/lyrs=y&x=${xtile}&y=${ytile}&z=${zoom}`;
}

/**
 * External map link (opens in browser or the Google Maps app) — uses the
 * documented Google Maps URLs API (https://developers.google.com/maps/documentation/urls/get-started)
 * with an explicit `basemap=satellite` param, which is the officially
 * supported way to force satellite imagery. Satellite is used here (instead
 * of the plain OpenStreetMap vector map) so the link always shows real
 * imagery with visible streets, not a bare schematic.
 */
export function streetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/@?api=1&map_action=map&center=${lat},${lng}&zoom=18&basemap=satellite`;
}
