import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;

export default function MapboxTest() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<mapboxgl.Map | null>(null);
  const [status, setStatus] = useState<"waiting"|"ok"|"no-token"|"error">(
    TOKEN ? "waiting" : "no-token"
  );
  const [info, setInfo] = useState("");

  useEffect(() => {
    if (!TOKEN || !containerRef.current || mapRef.current) return;

    mapboxgl.accessToken = TOKEN;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/satellite-streets-v12",
        center: [0, 20],
        zoom: 2,
      });

      map.on("load", () => {
        setStatus("ok");
        setInfo(`Mapbox GL JS ${mapboxgl.version} · renderer ready · ${map.getStyle().name}`);
        // Drop a test marker at the centre of the world
        new mapboxgl.Marker({ color: "#7c3aed" })
          .setLngLat([0, 20])
          .setPopup(new mapboxgl.Popup().setText("Mapbox GL JS is working! 🎉"))
          .addTo(map)
          .togglePopup();
      });

      map.on("error", (e) => {
        setStatus("error");
        setInfo(e.error?.message ?? "Unknown render error");
      });

      mapRef.current = map;
    } catch (e: unknown) {
      setStatus("error");
      setInfo(String(e));
    }

    return () => {
      try { mapRef.current?.remove(); } catch { /**/ }
      mapRef.current = null;
    };
  }, []);

  const pill = {
    waiting:  "bg-zinc-800 text-zinc-400 animate-pulse",
    ok:       "bg-green-900/60 text-green-300 border border-green-700/50",
    "no-token": "bg-red-900/60 text-red-300 border border-red-700/50",
    error:    "bg-red-900/60 text-red-300 border border-red-700/50",
  }[status];

  const label = {
    waiting:    "⏳ Initialising…",
    ok:         `✅ ${info}`,
    "no-token": "❌ VITE_MAPBOX_TOKEN env var not set",
    error:      `❌ Error: ${info}`,
  }[status];

  return (
    <div className="flex flex-col gap-4 h-full -m-4 md:-m-8">
      {/* Status bar */}
      <div className="flex items-center gap-2 px-4 pt-4">
        <span className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-wider">Mapbox GL JS — Test</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono ${pill}`}>{label}</span>
      </div>

      {status === "no-token" && (
        <div className="mx-4 p-4 rounded-xl border border-amber-700/40 bg-amber-900/20 text-sm text-amber-300 font-mono leading-relaxed">
          Add a <strong>VITE_MAPBOX_TOKEN</strong> env var with your Mapbox public token, then restart the web workflow.<br/>
          Get a free token at <a href="https://account.mapbox.com" target="_blank" rel="noreferrer" className="underline">account.mapbox.com</a>
        </div>
      )}

      {/* Map */}
      <div
        ref={containerRef}
        className="flex-1 mx-4 mb-4 rounded-2xl overflow-hidden border border-white/10"
        style={{ minHeight: 400, opacity: status === "no-token" ? 0.2 : 1 }}
      />
    </div>
  );
}
