import { Router } from "express";

const router = Router();

interface ImageResult {
  url: string;
  source: string;
  alt: string;
  thumb?: string;
}

async function fetchSafe(url: string, ms = 6000): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "PhoneLink/1.0 (location-image-search)" },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function searchImages(place: string): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const encoded = encodeURIComponent(place);

  // ── 1. Wikipedia page summary thumbnail ───────────────────────────────────
  try {
    const res = await fetchSafe(`https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    if (res?.ok) {
      const data = await res.json() as {
        title?: string;
        thumbnail?: { source: string; width: number; height: number };
        originalimage?: { source: string };
      };
      if (data.originalimage?.source || data.thumbnail?.source) {
        results.push({
          url: data.originalimage?.source || data.thumbnail!.source,
          thumb: data.thumbnail?.source,
          source: "Wikipedia",
          alt: data.title || place,
        });
      }
    }
  } catch { /**/ }

  // ── 2. Wikimedia Commons search ───────────────────────────────────────────
  try {
    const commonsUrl =
      `https://commons.wikimedia.org/w/api.php?action=query&generator=search` +
      `&gsrsearch=${encoded}&gsrnamespace=6` +
      `&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=700` +
      `&format=json&origin=*&gsrlimit=15`;
    const res = await fetchSafe(commonsUrl);
    if (res?.ok) {
      const data = await res.json() as {
        query?: {
          pages?: Record<string, {
            title?: string;
            imageinfo?: { url: string; thumburl?: string }[];
          }>;
        };
      };
      const pages = Object.values(data.query?.pages || {});
      for (const page of pages) {
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;
        if (!info.url.match(/\.(jpg|jpeg|png|webp)(\?|$)/i)) continue;
        const t = (page.title || "").toLowerCase();
        if (/map|flag|logo|icon|coat|arms|seal|emblem/.test(t)) continue;
        results.push({
          url: info.url,
          thumb: info.thumburl || info.url,
          source: "Wikimedia Commons",
          alt: page.title?.replace("File:", "").replace(/_/g, " ") || place,
        });
        if (results.filter(r => r.source === "Wikimedia Commons").length >= 4) break;
      }
    }
  } catch { /**/ }

  // ── 3. Flickr public feed (no API key needed) ─────────────────────────────
  try {
    const tags = place.replace(/,\s*/g, ",");
    const flickrUrl =
      `https://api.flickr.com/services/feeds/photos_public.gne` +
      `?tags=${encodeURIComponent(tags)}&format=json&nojsoncallback=1&lang=en-us`;
    const res = await fetchSafe(flickrUrl, 5000);
    if (res?.ok) {
      const text = await res.text();
      const data = JSON.parse(text) as {
        items?: { title: string; media: { m: string } }[];
      };
      for (const item of (data.items || []).slice(0, 5)) {
        const thumb = item.media?.m;
        if (!thumb) continue;
        // Flickr medium thumb → large: replace _m. with _b.
        const large = thumb.replace("_m.", "_b.");
        results.push({
          url: large,
          thumb,
          source: "Flickr",
          alt: item.title || place,
        });
      }
    }
  } catch { /**/ }

  // ── 4. Google Static Maps thumbnail (no JS key needed for static) ──────────
  // Always append a satellite map tile so there's always at least one visual
  const googleStaticUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${encoded}&zoom=13&size=600x400&maptype=satellite&scale=2` +
    `&key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY`; // demo key (low-quota, best-effort)
  results.push({
    url: googleStaticUrl,
    thumb: googleStaticUrl.replace("600x400", "300x200"),
    source: "Google Maps",
    alt: `Satellite view of ${place}`,
  });

  return results.slice(0, 8);
}

router.get("/images/search", async (req, res) => {
  const q = ((req.query.q as string) || "").trim();
  if (!q) { res.status(400).json({ error: "Missing q param", images: [] }); return; }
  try {
    const images = await searchImages(q);
    res.json({ images, query: q });
  } catch (e) {
    console.error("[images] search failed:", e);
    res.status(500).json({ error: "Image search failed", images: [] });
  }
});

export default router;
