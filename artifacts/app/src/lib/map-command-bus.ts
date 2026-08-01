// Map Command Bus — window CustomEvent bridge between AssistantWidget and LiveMap

export type MapLayer = "heatmap" | "journeys" | "clusters" | "surveillance";

export type PanDirection = "north" | "south" | "east" | "west";

export type MapCommand =
  | { type: "flyTo"; lat: number; lng: number; zoom?: number }
  | { type: "geocode"; place: string }
  | { type: "setLayer"; layer: MapLayer; enabled: boolean }
  | { type: "fitAll" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "setZoom"; zoom: number }
  | { type: "pan"; direction: PanDirection; amount?: number }
  | { type: "findContact"; name: string }
  | { type: "goBack" }
  | { type: "showImages"; place: string }
  | { type: "showStreetView"; lat: number; lng: number; name?: string }
  | { type: "navigate"; path: string }
  | { type: "openInviteForm"; phone?: string; name?: string };

const EVENT_NAME = "deepfalcon:map-command";

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
    __deepfalconMapContext?: () => MapContextSnapshot;
  }
}

export function registerMapContext(getter: () => MapContextSnapshot): () => void {
  window.__deepfalconMapContext = getter;
  return () => { delete window.__deepfalconMapContext; };
}

export function getMapContext(): MapContextSnapshot {
  return window.__deepfalconMapContext?.() ?? {
    onMapPage: false,
    contacts: [],
    liveCount: 0,
    layers: { heatmap: false, journeys: false, clusters: false, surveillance: false },
  };
}
