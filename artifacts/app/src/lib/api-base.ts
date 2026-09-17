/**
 * Base URL for every API call in the app.
 *
 * Defaults to the app's own origin (BASE_URL) so the Vite dev proxy and the
 * bundled serve-app.mjs keep working unchanged. For split deployments where
 * the frontend is a static site and the Express API lives on another origin,
 * set VITE_API_BASE_URL at build time (e.g. https://phonelink-api.onrender.com).
 */
export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || import.meta.env.BASE_URL
).replace(/\/$/, "");
