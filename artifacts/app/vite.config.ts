import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Falls back to this artifact's declared dev port (see artifact.toml) when PORT
// isn't set in the environment — e.g. when the platform's own per-artifact
// workflow spawns this process directly, without the combined start-dev.sh
// wrapper that otherwise pins PORT/BASE_PATH explicitly for the port-5000
// webview. This lets the path router's proxy to this artifact's localPort
// find a real listener instead of 502ing.
const rawPort = process.env.PORT ?? "23863";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // Only load Replit dev tools inside the Replit environment — never for external visitors
    ...(process.env.REPL_ID !== undefined
      ? [
          runtimeErrorOverlay(),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      // Allow the Contact Picker API on this origin.
      // Without this header Chrome silently refuses navigator.contacts.select().
      "Permissions-Policy": "contact-picker=(self), geolocation=(self), camera=(self), microphone=(self)",
    },
    fs: {
      strict: true,
    },
    warmup: {
      clientFiles: [
        "./src/main.tsx",
        "./src/App.tsx",
        "./src/pages/dashboard.tsx",
        "./src/pages/landing.tsx",
      ],
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        secure: false,
        // Debate mode fires 3 sequential Mistral calls; give it 3 minutes.
        // SSE streaming uses keepalive pings so this is just a safety net.
        proxyTimeout: 180_000,
        timeout: 180_000,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
