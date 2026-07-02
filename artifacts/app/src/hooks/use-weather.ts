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

export function weatherDesc(code: number): { icon: string; desc: string } {
  if (code === 0) return { icon: "☀️", desc: "Clear sky" };
  if (code <= 3) return { icon: "⛅", desc: "Partly cloudy" };
  if (code <= 48) return { icon: "🌫️", desc: "Fog" };
  if (code <= 55) return { icon: "🌦️", desc: "Drizzle" };
  if (code <= 65) return { icon: "🌧️", desc: "Rain" };
  if (code <= 77) return { icon: "🌨️", desc: "Snow" };
  if (code <= 82) return { icon: "🌧️", desc: "Showers" };
  if (code <= 86) return { icon: "❄️", desc: "Snow showers" };
  return { icon: "⛈️", desc: "Thunderstorm" };
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
        const tz = json.timezone as string;
        const { time, date, day } = getLocalDateTime(tz);
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
          utcOffsetSeconds: json.utc_offset_seconds,
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
    const tz = json.timezone as string;
    const { time, date, day } = getLocalDateTime(tz);
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
      utcOffsetSeconds: json.utc_offset_seconds,
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

export function windDirLabel(deg: number): string {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}
