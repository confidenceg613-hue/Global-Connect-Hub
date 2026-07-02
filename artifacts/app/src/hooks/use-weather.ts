import { useState, useEffect, useRef } from "react";

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  precipProb: number;
  uvIndex: number;
  weatherCode: number;
  windSpeed: number;
  windDirection: number;
  visibility: number;
  timezone: string;
  utcOffsetSeconds: number;
  description: string;
  icon: string;
  localTime: string;
  localDate: string;
  localDay: string;
}

const CACHE = new Map<string, WeatherData>();

// Map Open-Meteo weather codes to icons/descriptions (based on their code table)
export function weatherDesc(code: number): { icon: string; desc: string } {
  // Clear and mainly clear
  if (code === 0) return { icon: "☀️", desc: "Clear sky" };
  if (code === 1) return { icon: "🌤️", desc: "Mainly clear" };
  if (code === 2) return { icon: "⛅", desc: "Partly cloudy" };
  if (code === 3) return { icon: "☁️", desc: "Overcast" };
  // Fog
  if (code === 45 || code === 48) return { icon: "🌫️", desc: "Fog" };
  // Drizzle
  if (code >= 51 && code <= 57) return { icon: "🌦️", desc: "Drizzle" };
  // Rain
  if (code >= 61 && code <= 67) return { icon: "🌧️", desc: "Rain" };
  // Snow
  if (code >= 71 && code <= 77) return { icon: "🌨️", desc: "Snow" };
  // Showers
  if (code >= 80 && code <= 82) return { icon: "🌧️", desc: "Showers" };
  // Snow showers
  if (code === 85 || code === 86) return { icon: "❄️", desc: "Snow showers" };
  // Thunderstorm
  if (code >= 95 && code <= 99) return { icon: "⛈️", desc: "Thunderstorm" };
  // Fallback
  return { icon: "🌤️", desc: "Weather" };
}

export function getLocalTime(timezone: string): string {
  try {
    return new Date().toLocaleTimeString("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "--:--";
  }
}

// Compute local time/date strings and a reliable UTC offset (in seconds) for a given IANA timezone
export function getLocalDateTime(timezone: string): { time: string; date: string; day: string } {
  try {
    const now = new Date();
    return {
      time: now.toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),
      date: now.toLocaleDateString("en-US", {
        timeZone: timezone,
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
      day: now.toLocaleDateString("en-US", { timeZone: timezone, weekday: "long" }),
    };
  } catch {
    return { time: "--:--", date: "--", day: "--" };
  }
}

// Return the utc offset in seconds for a given IANA timezone using Intl.formatToParts to avoid parsing
export function getUtcOffsetSeconds(timezone: string): number {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value;
      return acc;
    }, {} as Record<string, string>);

    const tzMillis = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );

    const utcMillis = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds(),
    );

    return Math.round((tzMillis - utcMillis) / 1000);
  } catch {
    return 0;
  }
}

export function useWeather(lat: number | null, lng: number | null) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const fetched = useRef(false);

  useEffect(() => {
    if (lat == null || lng == null || fetched.current) return;
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (CACHE.has(key)) {
      setData(CACHE.get(key)!);
      return;
    }
    fetched.current = true;
    setLoading(true);
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,` +
      `uv_index,weather_code,wind_speed_10m,wind_direction_10m,visibility&timezone=auto`,
    )
      .then((r) => r.json())
      .then((json) => {
        const { icon, desc } = weatherDesc(json.current.weather_code);
        const tz = (json.timezone as string) || "UTC";
        const { time, date, day } = getLocalDateTime(tz);
        // Prefer API-provided utc offset when available; otherwise compute it locally
        const utcOffset = typeof json.utc_offset_seconds === "number" ? json.utc_offset_seconds : getUtcOffsetSeconds(tz);
        const result: WeatherData = {
          temperature: Math.round(json.current.temperature_2m),
          feelsLike: Math.round(json.current.apparent_temperature ?? json.current.temperature_2m),
          humidity: Math.round(json.current.relative_humidity_2m ?? 0),
          precipProb: Math.round(json.current.precipitation_probability ?? 0),
          uvIndex: Math.round(json.current.uv_index ?? 0),
          weatherCode: json.current.weather_code,
          windSpeed: Math.round(json.current.wind_speed_10m),
          windDirection: Math.round(json.current.wind_direction_10m ?? 0),
          visibility: Math.round((json.current.visibility ?? 10000) / 1000),
          timezone: tz,
          utcOffsetSeconds: utcOffset,
          description: desc,
          icon,
          localTime: time,
          localDate: date,
          localDay: day,
        };
        CACHE.set(key, result);
        setData(result);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lat, lng]);

  return { data, loading };
}

/** Standalone fetch for use outside hooks (e.g. Leaflet popups) */
export async function fetchWeather(lat: number, lng: number): Promise<WeatherData | null> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (CACHE.has(key)) return CACHE.get(key)!;
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,` +
      `uv_index,weather_code,wind_speed_10m,wind_direction_10m,visibility&timezone=auto`,
    );
    const json = await r.json();
    const { icon, desc } = weatherDesc(json.current.weather_code);
    const tz = (json.timezone as string) || "UTC";
    const { time, date, day } = getLocalDateTime(tz);
    const utcOffset = typeof json.utc_offset_seconds === "number" ? json.utc_offset_seconds : getUtcOffsetSeconds(tz);
    const result: WeatherData = {
      temperature: Math.round(json.current.temperature_2m),
      feelsLike: Math.round(json.current.apparent_temperature ?? json.current.temperature_2m),
      humidity: Math.round(json.current.relative_humidity_2m ?? 0),
      precipProb: Math.round(json.current.precipitation_probability ?? 0),
      uvIndex: Math.round(json.current.uv_index ?? 0),
      weatherCode: json.current.weather_code,
      windSpeed: Math.round(json.current.wind_speed_10m),
      windDirection: Math.round(json.current.wind_direction_10m ?? 0),
      visibility: Math.round((json.current.visibility ?? 10000) / 1000),
      timezone: tz,
      utcOffsetSeconds: utcOffset,
      description: desc,
      icon,
      localTime: time,
      localDate: date,
      localDay: day,
    };
    CACHE.set(key, result);
    return result;
  } catch {
    return null;
  }
}

/** Haversine distance in km */
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Use 16-point compass for more accurate wind direction labels
export function windDirLabel(deg: number): string {
  const dirs = [
    "N","NNE","NE","ENE","E","ESE","SE","SSE",
    "S","SSW","SW","WSW","W","WNW","NW","NNW",
  ];
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}
