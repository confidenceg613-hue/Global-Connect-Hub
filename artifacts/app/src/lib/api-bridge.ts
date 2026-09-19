/**
 * Production API bridge.
 *
 * Freebuff hosting serves the built app as static files plus file-based Python
 * functions, and Vercel only maps a .py file to its exact path — there is no
 * catch-all for the /api directory. Our Python API is one FastAPI app that is
 * reachable at /api/index and rebuilds the real path from ?__path=, so in
 * production every API call that has no function file of its own has to go
 * through that entry point.
 *
 * The preview/Node API routes real REST paths, so this bridge probes the
 * Python entry point once and stays inactive wherever it is not needed.
 */

const ENTRY = "/api/index";

/** /api paths that exist as their own Python function file in production. */
const DIRECT_PATHS = new Set([
  ENTRY,
  "/api/invite",
  "/api/grant",
  "/api/user",
  "/api/notifications",
  "/api/notifications/unread-count",
  "/api/assistant",
  "/api/location/push",
  "/api/location/heartbeat",
]);

const originalFetch =
  typeof window === "undefined" ? undefined : window.fetch.bind(window);

let entryReady: Promise<boolean> | undefined;

/** Is the Python entry point the one serving this deployment? */
function hasPythonEntry(): Promise<boolean> {
  if (!entryReady || !originalFetch) {
    entryReady = originalFetch
      ? originalFetch(`${ENTRY}?__path=healthz`, { headers: { accept: "application/json" } })
          .then(
            (r) =>
              r.ok && (r.headers.get("content-type") || "").includes("json"),
          )
          .catch(() => false)
      : Promise.resolve(false);
  }
  return entryReady;
}

/** The URL to bridge, or null when the call should be left alone. */
function bridgeableUrl(input: RequestInfo | URL): URL | null {
  if (typeof input !== "string" && !(input instanceof URL)) return null;
  let url: URL;
  try {
    url = new URL(typeof input === "string" ? input : input.href, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (!url.pathname.startsWith("/api/")) return null;
  if (DIRECT_PATHS.has(url.pathname)) return null;
  return url;
}

function toEntryUrl(url: URL): string {
  const params = new URLSearchParams(url.search);
  params.delete("__path");
  params.set("__path", url.pathname.slice("/api/".length));
  return `${ENTRY}?${params.toString()}`;
}

/** Install once, before the app renders, so every fetch() call is covered. */
export function installProductionApiBridge(): void {
  if (!originalFetch) return;
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = bridgeableUrl(input);
    if (target && (await hasPythonEntry())) {
      return originalFetch(toEntryUrl(target), init);
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;
}
