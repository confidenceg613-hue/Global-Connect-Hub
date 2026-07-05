import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";

const router: IRouter = Router();

const GOOGLE_MAPS_KEY = process.env.GOOGLE_MAPS_API_KEY;
const GEOCODE_BASE = "https://maps.googleapis.com/maps/api/geocode/json";

if (!GOOGLE_MAPS_KEY) {
  console.warn("[maps] GOOGLE_MAPS_API_KEY is not set — /api/maps/* will return 503");
}

// ── Simple in-memory rate limiter ─────────────────────────────────────────────
// Caps each IP to MAX_REQUESTS per WINDOW_MS to protect the paid Google key.

const WINDOW_MS = 60_000;       // 1 minute
const MAX_REQUESTS = 30;        // 30 geocode calls per minute per IP

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

const AddressComponentSchema = z.object({
  long_name: z.string(),
  short_name: z.string(),
  types: z.array(z.string()),
});

const GeocodeResultSchema = z.object({
  formatted_address: z.string(),
  geometry: z.object({
    location: z.object({ lat: z.number(), lng: z.number() }),
    viewport: z.object({
      northeast: z.object({ lat: z.number(), lng: z.number() }),
      southwest: z.object({ lat: z.number(), lng: z.number() }),
    }),
  }),
  types: z.array(z.string()),
  address_components: z.array(AddressComponentSchema),
  place_id: z.string(),
});

const GeocodeResponseSchema = z.object({
  status: z.string(),
  results: z.array(GeocodeResultSchema),
  error_message: z.string().optional(),
});

type GeocodeResult = z.infer<typeof GeocodeResultSchema>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractComponent(
  components: GeocodeResult["address_components"],
  type: string,
): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null;
}

function humanisePlaceTypes(types: string[]): string[] {
  const skip = new Set([
    "political", "establishment", "point_of_interest", "premise",
    "subpremise", "geocode", "floor",
  ]);
  return types.filter((t) => !skip.has(t)).map((t) => t.replace(/_/g, " "));
}

async function callGeocodeApi(params: Record<string, string>) {
  const url = new URL(GEOCODE_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", GOOGLE_MAPS_KEY!);

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`Google Maps HTTP ${resp.status}`);

  const raw: unknown = await resp.json();
  return GeocodeResponseSchema.parse(raw);
}

// ── GET /maps/geocode?place=... ───────────────────────────────────────────────
// (mounted under /api in app.ts → full path is /api/maps/geocode)

router.get("/maps/geocode", rateLimiter, async (req: Request, res: Response) => {
  if (!GOOGLE_MAPS_KEY) {
    res.status(503).json({ error: "Google Maps API key not configured" });
    return;
  }

  const place = z.string().min(1).max(500).safeParse(req.query.place);
  if (!place.success) {
    res.status(400).json({ error: "Missing or invalid `place` query param" });
    return;
  }

  try {
    const data = await callGeocodeApi({ address: place.data });

    if (data.status === "REQUEST_DENIED") {
      console.error("[maps/geocode] Google API denied:", data.error_message);
      res.status(502).json({ error: "Google Maps request denied — check API key permissions" });
      return;
    }

    if (data.status !== "OK" || !data.results[0]) {
      res.status(404).json({ error: `Place not found (status: ${data.status})` });
      return;
    }

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;
    const c = result.address_components;

    res.json({
      lat,
      lng,
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      placeTypes: humanisePlaceTypes(result.types),
      viewport: result.geometry.viewport,
      city:         extractComponent(c, "locality") ?? extractComponent(c, "postal_town"),
      region:       extractComponent(c, "administrative_area_level_1"),
      country:      extractComponent(c, "country"),
      neighborhood: extractComponent(c, "neighborhood") ?? extractComponent(c, "sublocality_level_1"),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/geocode] Error:", msg);
    res.status(500).json({ error: "Failed to geocode place" });
  }
});

// ── GET /maps/reverse-geocode?lat=...&lng=... ─────────────────────────────────
// (mounted under /api in app.ts → full path is /api/maps/reverse-geocode)

router.get("/maps/reverse-geocode", rateLimiter, async (req: Request, res: Response) => {
  if (!GOOGLE_MAPS_KEY) {
    res.status(503).json({ error: "Google Maps API key not configured" });
    return;
  }

  const latParsed = z.coerce.number().min(-90).max(90).safeParse(req.query.lat);
  const lngParsed = z.coerce.number().min(-180).max(180).safeParse(req.query.lng);

  if (!latParsed.success || !lngParsed.success) {
    res.status(400).json({ error: "Missing or invalid `lat`/`lng` query params" });
    return;
  }

  const { data: lat } = latParsed;
  const { data: lng } = lngParsed;

  try {
    const data = await callGeocodeApi({ latlng: `${lat},${lng}` });

    if (data.status === "REQUEST_DENIED") {
      console.error("[maps/reverse-geocode] Google API denied:", data.error_message);
      res.status(502).json({ error: "Google Maps request denied — check API key permissions" });
      return;
    }

    if (data.status !== "OK" || !data.results[0]) {
      res.status(404).json({ error: `No address found (status: ${data.status})` });
      return;
    }

    const best = data.results[0];
    const localityResult = data.results.find((r) =>
      r.types.includes("locality") || r.types.includes("postal_town"),
    ) ?? best;

    const c = best.address_components;
    const placeTypes = humanisePlaceTypes(best.types);

    const city = extractComponent(localityResult.address_components, "locality")
      ?? extractComponent(c, "postal_town");
    const region  = extractComponent(c, "administrative_area_level_1");
    const country = extractComponent(c, "country");
    const neighborhood = extractComponent(c, "neighborhood")
      ?? extractComponent(c, "sublocality_level_1");

    res.json({
      lat,
      lng,
      formattedAddress: best.formatted_address,
      placeId: best.place_id,
      placeTypes,
      city,
      region,
      country,
      neighborhood,
      // One-line context string ready to paste into an AI prompt
      summary: [neighborhood, city, region, country].filter(Boolean).join(", "),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[maps/reverse-geocode] Error:", msg);
    res.status(500).json({ error: "Failed to reverse geocode coordinates" });
  }
});

export default router;
