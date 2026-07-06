// Map Command Bus — window CustomEvent bridge between AssistantWidget and LiveMap

export type MapLayer = "heatmap" | "journeys" | "clusters" | "surveillance";

export type MapCommand =
  | { type: "flyTo"; lat: number; lng: number; zoom?: number }
  | { type: "geocode"; place: string }
  | { type: "setLayer"; layer: MapLayer; enabled: boolean }
  | { type: "fitAll" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "findContact"; name: string }
  | { type: "goBack" }
  | { type: "showImages"; place: string };

const EVENT_NAME = "phonelink:map-command";

export function dispatchMapCommand(command: MapCommand): void {
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: command }));
}

export function onMapCommand(handler: (command: MapCommand) => void): () => void {
  const listener = (e: Event) => {
    handler((e as CustomEvent<MapCommand>).detail);
  };
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

// Global map context — LiveMap registers this so AssistantWidget can read it
export interface MapContextSnapshot {
  onMapPage: boolean;
  contacts: Array<{
    name: string | null;
    lat: number;
    lng: number;
    address: string | null;
    isLive: boolean;
  }>;
  liveCount: number;
  myLat?: number;
  myLng?: number;
  layers: {
    heatmap: boolean;
    journeys: boolean;
    clusters: boolean;
    surveillance: boolean;
  };
}

declare global {
  interface Window {
    __phonelinkMapContext?: () => MapContextSnapshot;
  }
}

export function registerMapContext(getter: () => MapContextSnapshot): () => void {
  window.__phonelinkMapContext = getter;
  return () => { delete window.__phonelinkMapContext; };
}

export function getMapContext(): MapContextSnapshot {
  return window.__phonelinkMapContext?.() ?? {
    onMapPage: false,
    contacts: [],
    liveCount: 0,
    layers: { heatmap: false, journeys: false, clusters: false, surveillance: false },
  };
}
