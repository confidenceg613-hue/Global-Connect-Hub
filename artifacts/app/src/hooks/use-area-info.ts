export interface AreaInfo {
  country: string;
  countryCode: string;
  state: string;
  county: string;
  road: string;
  placeType: string;
  postcode: string;
  displayName: string;
  elevation: number | null;
  aqi: number | null;
  pm25: number | null;
  sunrise: string | null;
  sunset: string | null;
}

const CACHE = new Map<string, AreaInfo>();

function aqiLabel(aqi: number): { label: string; color: string } {
  if (aqi <= 50) return { label: "Good", color: "#22c55e" };
  if (aqi <= 100) return { label: "Moderate", color: "#eab308" };
  if (aqi <= 150) return { label: "Unhealthy (Sensitive)", color: "#f97316" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#ef4444" };
  if (aqi <= 300) return { label: "Very Unhealthy", color: "#a855f7" };
  return { label: "Hazardous", color: "#7f1d1d" };
}

export { aqiLabel };

function formatClock(iso: string | undefined, timezone: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
}

export async function fetchAreaInfo(lat: number, lng: number): Promise<AreaInfo | null> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (CACHE.has(key)) return CACHE.get(key)!;

  try {
    const [geoRes, aqRes, sunRes] = await Promise.allSettled([
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`,
        { headers: { Accept: "application/json" } },
      ).then((r) => r.json()),
      fetch(
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&current=us_aqi,pm2_5`,
      ).then((r) => r.json()),
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=sunrise,sunset&timezone=auto`,
      ).then((r) => r.json()),
    ]);

    const geo = geoRes.status === "fulfilled" ? geoRes.value : null;
    const aq = aqRes.status === "fulfilled" ? aqRes.value : null;
    const sun = sunRes.status === "fulfilled" ? sunRes.value : null;

    const addr = geo?.address ?? {};
    const tz = sun?.timezone ?? "UTC";

    const result: AreaInfo = {
      country: addr.country ?? "",
      countryCode: (addr.country_code ?? "").toUpperCase(),
      state: addr.state ?? addr.region ?? "",
      county: addr.county ?? addr.city ?? addr.town ?? addr.village ?? "",
      road: addr.road ?? "",
      placeType: geo?.type ?? geo?.addresstype ?? "",
      postcode: addr.postcode ?? "",
      displayName: geo?.display_name ?? "",
      elevation: typeof aq?.elevation === "number" ? Math.round(aq.elevation) : null,
      aqi: aq?.current?.us_aqi ?? null,
      pm25: aq?.current?.pm2_5 ?? null,
      sunrise: formatClock(sun?.daily?.sunrise?.[0], tz),
      sunset: formatClock(sun?.daily?.sunset?.[0], tz),
    };

    CACHE.set(key, result);
    return result;
  } catch {
    return null;
  }
}
