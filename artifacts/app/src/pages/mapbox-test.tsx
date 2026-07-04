import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Free tile styles — no token needed
const STYLES = {
  "Streets":  "https://tiles.openfreemap.org/styles/liberty",
  "Bright":   "https://tiles.openfreemap.org/styles/bright",
  "Satellite": {
    version: 8 as const,
    sources: {
      esri: {
        type: "raster" as const,
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256,
        attribution: "© Esri",
      },
    },
    layers: [{ id: "esri-sat", type: "raster" as const, source: "esri" }],
  },
} as const;

type StyleKey = keyof typeof STYLES;
type Status = "loading" | "ok" | "error" | "no-webgl";

export default function MapboxTest() {
  const containerRef  = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<maplibregl.Map | null>(null);
  const [status, setStatus]     = useState<Status>("loading");
  const [info, setInfo]         = useState("");
  const [activeStyle, setActiveStyle] = useState<StyleKey>("Streets");

  function initMap(styleName: StyleKey) {
    if (!containerRef.current) return;
    mapRef.current?.remove();
    mapRef.current = null;
    setStatus("loading");
    setInfo("");

    // WebGL availability check — headless/server environments lack GPU
    const probe = document.createElement("canvas");
    const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
    if (!gl) {
      setStatus("no-webgl");
      setInfo("WebGL unavailable here — works fine in a real browser");
      return;
    }

    try {
      const map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLES[styleName] as maplibregl.StyleSpecification | string,
        center: [3.3792, 6.5244], // Lagos, Nigeria
        zoom: 11,
      });

      map.addControl(new maplibregl.NavigationControl(), "bottom-right");
      map.addControl(new maplibregl.ScaleControl(), "bottom-left");
      map.addControl(new maplibregl.FullscreenControl(), "top-right");

      map.on("load", () => {
        setStatus("ok");
        setInfo(`MapLibre GL JS ${maplibregl.version} · ${styleName}`);

        new maplibregl.Marker({ color: "#7c3aed" })
          .setLngLat([3.3792, 6.5244])
          .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(
              `<div style="font-family:system-ui,sans-serif;font-size:13px;padding:4px 2px;">
                <strong>MapLibre GL JS ✅</strong><br/>
                <span style="font-size:11px;color:#666;">Lagos, Nigeria · No API key needed</span>
              </div>`
            )
          )
          .addTo(map)
          .togglePopup();
      });

      map.on("error", (e) => {
        setStatus("error");
        setInfo(e.error?.message ?? "Render error");
      });

      mapRef.current = map;
    } catch (e: unknown) {
      setStatus("error");
      setInfo(String(e));
    }
  }

  useEffect(() => {
    initMap(activeStyle);
    return () => { try { mapRef.current?.remove(); } catch { /**/ } mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function switchStyle(key: StyleKey) {
    setActiveStyle(key);
    initMap(key);
  }

  const statusCls: Record<Status, string> = {
    loading:   "bg-zinc-800 text-zinc-400 animate-pulse",
    ok:        "bg-green-900/60 text-green-300 border border-green-700/50",
    error:     "bg-red-900/60 text-red-300 border border-red-700/50",
    "no-webgl":"bg-amber-900/60 text-amber-300 border border-amber-700/50",
  };

  const statusLabel: Record<Status, string> = {
    loading:   "⏳ Loading tiles…",
    ok:        `✅ ${info}`,
    error:     `❌ ${info}`,
    "no-webgl":`⚠️ ${info}`,
  };

  return (
    <div className="flex flex-col gap-3 h-full -m-4 md:-m-8 overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-4">
        <span className="text-xs font-bold font-mono text-zinc-400 uppercase tracking-wider">
          MapLibre GL JS — Test
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono whitespace-nowrap ${statusCls[status]}`}>
          {statusLabel[status]}
        </span>

        {/* Style switcher */}
        <div className="ml-auto flex items-center gap-1">
          {(Object.keys(STYLES) as StyleKey[]).map((key) => (
            <button
              key={key}
              onClick={() => switchStyle(key)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-all ${
                activeStyle === key
                  ? "bg-purple-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {/* No-WebGL fallback */}
      {status === "no-webgl" && (
        <div className="mx-4 p-4 rounded-xl border border-amber-700/40 bg-amber-900/20 text-sm text-amber-300 font-mono leading-relaxed">
          <strong>MapLibre GL JS {maplibregl.version} is installed and ready.</strong><br/>
          WebGL rendering requires a real GPU — it's unavailable in this headless preview capture, but
          works correctly in Chrome, Firefox, Safari, and all mobile browsers.
        </div>
      )}

      {/* Map container */}
      <div
        ref={containerRef}
        className="flex-1 mx-4 mb-4 rounded-2xl overflow-hidden border border-white/10"
        style={{ minHeight: 380, opacity: status === "no-webgl" ? 0.15 : 1 }}
      />
    </div>
  );
}
