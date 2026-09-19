import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/error-boundary";
import { installHighAccuracyGeo } from "./lib/geo-accuracy";
import { installLiveGpsAutoPublish } from "./lib/live-gps-auto";
import { installProductionApiBridge } from "./lib/api-bridge";
import "./index.css";

// Static hosting + file-based Python functions: route API calls that have no
// function file of their own through the single Python entry point.
installProductionApiBridge();

// GPS accuracy priority: force high-accuracy, fresh fixes app-wide
// (consent tracking, group share, live map) before any page can call it.
installHighAccuracyGeo();

// Live GPS channel: mirror every location push to MQTT and remember tokens
// of owner-created invite links — this is what makes share links work with
// zero backend (coordinates + notifications travel device-to-device).
installLiveGpsAutoPublish();

// Remove the pre-React loader once JS is executing
const loader = document.getElementById("pre-react-loader");
if (loader) {
  loader.style.opacity = "0";
  loader.style.pointerEvents = "none";
  setTimeout(() => loader.remove(), 350);
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#09090b;color:#fafafa;font-family:system-ui,sans-serif;text-align:center;padding:24px">' +
    '<div><div style="font-size:32px;margin-bottom:12px">⚠️</div>' +
    '<h2 style="margin:0 0 8px">Unable to start</h2>' +
    '<p style="color:#71717a;margin:0;font-size:14px">Root element not found. Please reload the page.</p>' +
    '<button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">Reload</button></div></div>';
} else {
  createRoot(rootEl).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
