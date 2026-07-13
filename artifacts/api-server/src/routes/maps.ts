import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { db, streetViewPhotosTable } from "@workspace/db";
import { and, gte, lte } from "drizzle-orm";

const router: IRouter = Router();

// ── Nominatim (OpenStreetMap) — free geocoding, no API key or billing required ──
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
// Max ~1 request/sec, must send an identifying User-Agent. We serialize calls below.
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "PhoneLink/1.0 (location-sharing app; contact via app support)";

let nominatimQueue: Promise<void> = Promise.resolve();
function throttledNominatim<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(fn, fn);
  nominatimQueue = run.then(
    () => new Promise((r) => setTimeout(r, 1000)),
    () => new Promise((r) => setTimeout(r, 1000)),
  );
  return run;
}

// ── Mapillary — free crowdsourced street-level imagery, no billing required ───
const MAPILLARY_TOKEN = process.env.MAPILLARY_ACCESS_TOKEN;
if (!MAPILLARY_TOKEN) {
  console.warn("[maps] MAPILLARY_ACCESS_TOKEN is not set — street-level imagery will be unavailable");
}

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 20;
const requestCounts = new Map<string, { count: number; reset: number }>();

function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress
    ?? "unknown";
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.reset) {
    requestCounts.set(ip, { count: 1, reset: now + WINDOW_MS });
    next();
    return;
  }
  if (entry.count >= MAX_REQUESTS) {
    res.status(429).json({ error: "Too many requests — try again in a minute." });
    return;
  }
  entry.count += 1;
  next();
}

// ── Types ─────────────────────────────────────────────────────────────────────

const NominatimAddressSchema = z
  .object({
    road: z.string().optional(),
    neighbourhood: z.string().optional(),
    suburb: z.string().optional(),
    city: z.string().optional(),
    town: z.string().optional(),
    village: z.string().optional(),
    county: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    postcode: z.string().optional(),
  })
  .partial();

const NominatimResultSchema = z.object({
  place_id: z.number(),
  lat: z.string(),
  lon: z.string(),
  display_name: z.string(),
  type: z.string().optional(),
  class: z.string().optional(),
  address: NominatimAddressSchema.optional(),
  boundingbox: z.array(z.string()).optional(),
});

function humanisePlaceTypes(type?: string, cls?: string): string[] {
  return [type, cls].filter((v): v is string => !!v).map((t) => t.replace(/_/g, " "));
}

async function nominatimFetch(path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`${NOMINATIM_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");

  return throttledNominatim(async () => {
    const resp = await fetch(url.toString(), { headers: { "User-Agent": USER_AGENT } });
    if (!resp.ok) throw new Error(`Nominatim HTTP ${resp.status}`);
    return resp.json();
  });
}

// ── GET /maps/geocode?place=... ───────────────────────────────────────────────

router.get("/maps/geocode", rateLimiter, async (req: Request, res: Response) => {
  const place = z.string().min(1).max(500).safeParse(req.query.place);
  if (!place.success) {
    res.status(400).json({ error: "Missing or invalid `place` query param" });
    return;
  }

  try {
    const raw = await nominatimFetch("/search", { q: place.data, limit: "1" });
    const parsed = z.array(NominatimResultSchema).safeParse(raw);
    if (!parsed.success || !parsed.data[0]) {
      res.status(404).json({ error: "Place not found" });
      return;
    }

    const r = parsed.data[0];
    const a = r.address ?? {};

    res.json({
      lat: Number(r.lat),
      lng: Number(r.lon),
      formattedAddress: r.display_name,
      placeId: String(r.place_id),
      placeTypes: humanisePlaceTypes(r.type, r.class),
      viewport: r.boundingbox
        ? {
            southwest: { lat: Number(r.boundingbox[0]), lng: Number(r.boundingbox[2]) },
            northeast: { lat: Number(r.boundingbox[1]), lng: Number(r.boundingbox[3]) },
          }
        : null,
      city: a.city ?? a.town ?? a.village ?? null,
      region: a.state ?? null,
      country: a.country ?? null,
      neighborhood: a.neighbourhood ?? a.suburb ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/geocode] Error:", msg);
    res.status(500).json({ error: "Failed to geocode place" });
  }
});

// ── GET /maps/reverse-geocode?lat=...&lng=... ─────────────────────────────────

router.get("/maps/reverse-geocode", rateLimiter, async (req: Request, res: Response) => {
  const latParsed = z.coerce.number().min(-90).max(90).safeParse(req.query.lat);
  const lngParsed = z.coerce.number().min(-180).max(180).safeParse(req.query.lng);

  if (!latParsed.success || !lngParsed.success) {
    res.status(400).json({ error: "Missing or invalid `lat`/`lng` query params" });
    return;
  }

  const { data: lat } = latParsed;
  const { data: lng } = lngParsed;

  try {
    const raw = await nominatimFetch("/reverse", { lat: String(lat), lon: String(lng) });
    const parsed = NominatimResultSchema.safeParse(raw);
    if (!parsed.success) {
      res.status(404).json({ error: "No address found" });
      return;
    }

    const r = parsed.data;
    const a = r.address ?? {};
    const city = a.city ?? a.town ?? a.village ?? null;
    const region = a.state ?? null;
    const country = a.country ?? null;
    const neighborhood = a.neighbourhood ?? a.suburb ?? null;

    res.json({
      lat,
      lng,
      formattedAddress: r.display_name,
      placeId: String(r.place_id),
      placeTypes: humanisePlaceTypes(r.type, r.class),
      city,
      region,
      country,
      neighborhood,
      summary: [neighborhood, city, region, country].filter(Boolean).join(", "),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/reverse-geocode] Error:", msg);
    res.status(500).json({ error: "Failed to reverse geocode coordinates" });
  }
});

// ── GET /maps/place-info?place=... ────────────────────────────────────────────
// Best-effort place lookup via Nominatim (no editorial summary/rating available,
// unlike Google Places, since this is a free open-data source).

router.get("/maps/place-info", rateLimiter, async (req: Request, res: Response) => {
  const place = z.string().min(1).max(500).safeParse(req.query.place);
  if (!place.success) {
    res.status(400).json({ error: "Missing or invalid `place` query param" });
    return;
  }

  try {
    const raw = await nominatimFetch("/search", { q: place.data, limit: "1" });
    const parsed = z.array(NominatimResultSchema).safeParse(raw);
    if (!parsed.success || !parsed.data[0]) {
      res.status(404).json({ error: "No place info found" });
      return;
    }

    const r = parsed.data[0];
    res.json({
      name: r.display_name.split(",")[0] ?? r.display_name,
      summary: null,
      placeTypes: humanisePlaceTypes(r.type, r.class),
      rating: null,
      userRatingCount: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/place-info] Error:", msg);
    res.status(500).json({ error: "Failed to fetch place info" });
  }
});

// ── GET /maps/street-view?lat=...&lng=... ─────────────────────────────────────
// Uses Mapillary's free Graph API to find the nearest crowdsourced street-level
// photo near a coordinate. Requires a free MAPILLARY_ACCESS_TOKEN (no card needed).

router.get("/maps/street-view", rateLimiter, async (req: Request, res: Response) => {
  const latParsed = z.coerce.number().min(-90).max(90).safeParse(req.query.lat);
  const lngParsed = z.coerce.number().min(-180).max(180).safeParse(req.query.lng);

  if (!latParsed.success || !lngParsed.success) {
    res.status(400).json({ error: "Missing or invalid `lat`/`lng` query params" });
    return;
  }

  if (!MAPILLARY_TOKEN) {
    res.status(503).json({ error: "Street-level imagery not configured", available: false });
    return;
  }

  const { data: lat } = latParsed;
  const { data: lng } = lngParsed;
  // Cache lookup uses a ~500m box so nearby lookups reuse the same image.
  const cacheDelta = 0.005;

  try {
    // Check the permanent cache first — once a location's street view has
    // been resolved, it's saved forever and reused on subsequent visits.
    const cached = await db
      .select()
      .from(streetViewPhotosTable)
      .where(
        and(
          gte(streetViewPhotosTable.latitude, lat - cacheDelta),
          lte(streetViewPhotosTable.latitude, lat + cacheDelta),
          gte(streetViewPhotosTable.longitude, lng - cacheDelta),
          lte(streetViewPhotosTable.longitude, lng + cacheDelta),
        ),
      )
      .limit(1);

    if (cached[0]) {
      const c = cached[0];
      res.json({
        available: true,
        imageId: c.mapillaryImageId,
        imageUrl: c.imageUrl,
        embedUrl: c.embedUrl,
        cached: true,
      });
      return;
    }

    // Query Mapillary Graph API for the closest image within ~500m.
    const delta = 0.005;
    const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
    const mapillaryUrl = new URL("https://graph.mapillary.com/images");
    mapillaryUrl.searchParams.set("access_token", MAPILLARY_TOKEN);
    mapillaryUrl.searchParams.set("fields", "id,thumb_1024_url,thumb_original_url");
    mapillaryUrl.searchParams.set("bbox", bbox);
    mapillaryUrl.searchParams.set("limit", "1");

    const mapResp = await fetch(mapillaryUrl.toString());
    if (!mapResp.ok) {
      console.warn(`[maps/street-view] Mapillary HTTP ${mapResp.status}`);
      res.status(502).json({ error: "Failed to reach Mapillary", available: false });
      return;
    }

    const mapData = (await mapResp.json()) as { data?: { id: string; thumb_1024_url?: string; thumb_original_url?: string }[] };
    const img = mapData.data?.[0];
    if (!img) {
      res.status(404).json({ error: "No street-level imagery near this location", available: false });
      return;
    }

    const imageId  = img.id;
    const imageUrl = img.thumb_1024_url ?? img.thumb_original_url ?? `https://graph.mapillary.com/${imageId}/thumb?fields=thumb_1024_url`;
    const embedUrl = `https://www.mapillary.com/embed?image_key=${imageId}`;

    // Save permanently so this location never needs to hit Mapillary again.
    await db
      .insert(streetViewPhotosTable)
      .values({ latitude: lat, longitude: lng, mapillaryImageId: imageId, imageUrl, embedUrl })
      .onConflictDoNothing({ target: streetViewPhotosTable.mapillaryImageId });

    res.json({ available: true, imageId, imageUrl, embedUrl, cached: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/street-view] Error:", msg);
    res.status(500).json({ error: "Failed to fetch street-level imagery", available: false });
  }
});

export default router;
