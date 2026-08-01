import L from "leaflet";

/**
 * The marker's icon anchor is placed at the talons, so the location update
 * remains geographically exact while the eagle and its label sit above it.
 */
export function makeEagleMarker(
  name: string,
  options: { accent?: string; lowBattery?: boolean } = {},
): L.DivIcon {
  const label = escapeHtml(name || "Contact");
  const accent = options.accent ?? "#f59e0b";
  const batteryBadge = options.lowBattery
    ? `<span style="position:absolute;right:-4px;bottom:1px;width:17px;height:17px;border-radius:50%;background:#ef4444;border:2px solid #17110b;display:grid;place-items:center;font-size:10px;line-height:1;">🪫</span>`
    : "";

  return L.divIcon({
    className: "pl-eagle-marker",
    iconSize: [76, 78],
    iconAnchor: [38, 68],
    popupAnchor: [0, -68],
    html: `<div style="position:relative;width:76px;height:78px;filter:drop-shadow(0 4px 5px rgba(0,0,0,.72));">
      <div style="position:absolute;left:50%;top:0;transform:translateX(-50%);font-size:43px;line-height:1;font-family:'Apple Color Emoji','Segoe UI Emoji',sans-serif;">🦅</div>
      <div style="position:absolute;left:50%;top:37px;width:5px;height:21px;transform:translateX(-50%);background:linear-gradient(90deg,#b46e15,#ffd267,#8d4c0b);clip-path:polygon(36% 0,64% 0,64% 47%,100% 72%,63% 67%,58% 100%,50% 73%,42% 100%,37% 67%,0 72%,36% 47%);"></div>
      <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);max-width:118px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(18,12,6,.94);border:1px solid ${accent};border-radius:999px;padding:3px 8px;color:#fff8e8;font:700 10px/1.2 system-ui,sans-serif;letter-spacing:.01em;box-shadow:0 2px 7px rgba(0,0,0,.65);">${label}</div>
      ${batteryBadge}
    </div>`,
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[char]!));
}