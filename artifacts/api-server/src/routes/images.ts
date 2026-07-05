import { Router } from "express";

const router = Router();

interface ImageResult {
  url: string;
  source: string;
  alt: string;
  thumb?: string;
}

async function fetchWithTimeout(url: string, ms = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "PhoneLink/1.0 (https://phonelink.app)" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function searchImages(place: string): Promise<ImageResult[]> {
  const results: ImageResult[] = [];
  const encoded = encodeURIComponent(place);

  // ── 1. Wikipedia page thumbnail ───────────────────────────────────────────
  try {
    const res = await fetchWithTimeout(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`
    );
    if (res.ok) {
      const data: {
        title?: string;
        thumbnail?: { source: string };
        originalimage?: { source: string };
      } = await res.json();
      if (data.thumbnail?.source) {
        results.push({
          url: data.originalimage?.source || data.thumbnail.source,
          thumb: data.thumbnail.source,
          source: "Wikipedia",
          alt: data.title || place,
        });
      }
    }
  } catch { /* timeout or network */ }

  // ── 2. Wikimedia Commons image search ─────────────────────────────────────
  try {
    const commonsUrl =
      `https://commons.wikimedia.org/w/api.php?` +
      `action=query&generator=search&gsrsearch=${encoded}+photo&gsrnamespace=6` +
      `&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=800&format=json&origin=*&gsrlimit=10`;
    const res = await fetchWithTimeout(commonsUrl);
    if (res.ok) {
      const data: {
        query?: {
          pages?: Record<string, {
            title?: string;
            imageinfo?: { url: string; thumburl?: string }[];
          }>;
        };
      } = await res.json();
      const pages = Object.values(data.query?.pages || {});
      for (const page of pages) {
        const info = page.imageinfo?.[0];
        if (!info?.url) continue;
        const url = info.url.toLowerCase();
        if (!url.match(/\.(jpg|jpeg|png|webp)$/)) continue;
        // Skip SVG, maps, flags, icons
        const title = (page.title || "").toLowerCase();
        if (title.includes("map") || title.includes("flag") || title.includes("logo") || title.includes("icon")) continue;
        results.push({
          url: info.url,
          thumb: info.thumburl || info.url,
          source: "Wikimedia Commons",
          alt: page.title?.replace("File:", "") || place,
        });
        if (results.length >= 6) break;
      }
    }
  } catch { /* timeout or network */ }

  // ── 3. Unsplash free source (always added as reliable fallback) ───────────
  // Unsplash source API returns a redirect to a real photo — no key needed
  const unsplashTerms = place.replace(/,/g, " ").replace(/\s+/g, ",");
  results.push({
    url: `https://source.unsplash.com/900x600/?${encodeURIComponent(unsplashTerms)}&sig=${Date.now()}`,
    source: "Unsplash",
    alt: `Photo of ${place}`,
  });
  results.push({
    url: `https://source.unsplash.com/900x600/?${encodeURIComponent(unsplashTerms)}&sig=${Date.now() + 1}`,
    source: "Unsplash",
    alt: `${place} landscape`,
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
