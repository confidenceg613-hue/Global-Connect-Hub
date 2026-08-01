import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { X, ArrowLeft, RotateCw, ExternalLink, Globe } from "lucide-react";

// ── Context ───────────────────────────────────────────────────────────────────

interface InAppBrowserCtx {
  openUrl: (url: string) => void;
  closeUrl: () => void;
}

const InAppBrowserContext = createContext<InAppBrowserCtx>({
  openUrl: () => {},
  closeUrl: () => {},
});

export function useInAppBrowser() {
  return useContext(InAppBrowserContext);
}

// ── Provider + UI ─────────────────────────────────────────────────────────────

export function InAppBrowserProvider({ children }: { children: React.ReactNode }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const historyRef = useRef<string[]>([]);

  const openUrl = useCallback((href: string) => {
    historyRef.current = [];
    setBlocked(false);
    setLoading(true);
    setUrl(href);
  }, []);

  const closeUrl = useCallback(() => {
    setUrl(null);
    setBlocked(false);
    historyRef.current = [];
  }, []);

  const goBack = () => {
    const prev = historyRef.current.pop();
    if (prev) {
      setBlocked(false);
      setLoading(true);
      setUrl(prev);
    } else {
      closeUrl();
    }
  };

  const refresh = () => {
    if (!iframeRef.current || !url) return;
    setBlocked(false);
    setLoading(true);
    // Re-assign src to reload
    iframeRef.current.src = url;
  };

  const openExternal = () => {
    if (url) window.open(url, "_system");
    closeUrl();
  };

  // Detect if iframe is blocked (X-Frame-Options) via load timeout
  const loadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!url) return;
    if (loadTimer.current) clearTimeout(loadTimer.current);
    // If iframe doesn't fire onLoad within 8s, assume it's blocked
    loadTimer.current = setTimeout(() => {
      setLoading(false);
      setBlocked(true);
    }, 8000);
    return () => {
      if (loadTimer.current) clearTimeout(loadTimer.current);
    };
  }, [url]);

  const onLoad = () => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoading(false);
    setBlocked(false);
  };

  const onError = () => {
    if (loadTimer.current) clearTimeout(loadTimer.current);
    setLoading(false);
    setBlocked(true);
  };

  // Friendly display URL
  const displayUrl = (() => {
    if (!url) return "";
    try {
      const u = new URL(url);
      return u.hostname + (u.pathname !== "/" ? u.pathname : "");
    } catch {
      return url;
    }
  })();

  return (
    <InAppBrowserContext.Provider value={{ openUrl, closeUrl }}>
      {children}

      {/* Full-screen in-app browser overlay */}
      {url && (
        <div
          className="fixed inset-0 z-[9998] flex flex-col"
          style={{ background: "#0D0A06" }}
        >
          {/* Top bar */}
          <div
            className="flex items-center gap-2 px-3 shrink-0 border-b border-white/10"
            style={{ paddingTop: "env(safe-area-inset-top, 0px)", height: "calc(52px + env(safe-area-inset-top, 0px))" }}
          >
            <button
              onClick={goBack}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 transition-colors shrink-0"
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>

            {/* URL pill */}
            <div className="flex-1 min-w-0 flex items-center gap-1.5 bg-white/5 rounded-lg px-3 h-9">
              <Globe size={12} className="text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">{displayUrl}</span>
              {loading && (
                <div className="ml-auto h-3.5 w-3.5 shrink-0 border-2 border-amber-500/30 border-t-amber-500 rounded-full animate-spin" />
              )}
            </div>

            <button
              onClick={refresh}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 transition-colors shrink-0"
              aria-label="Refresh"
            >
              <RotateCw size={15} />
            </button>

            <button
              onClick={openExternal}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 transition-colors shrink-0"
              aria-label="Open in browser"
            >
              <ExternalLink size={15} />
            </button>

            <button
              onClick={closeUrl}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted-foreground hover:bg-white/10 transition-colors shrink-0"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content area */}
          <div className="flex-1 relative overflow-hidden">
            {blocked ? (
              /* Blocked / embedding not allowed */
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8 text-center">
                <Globe size={40} className="text-amber-500/40" />
                <div>
                  <p className="text-sm font-medium text-foreground">Cannot preview this page</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This website doesn't allow embedding. Open it in your browser instead.
                  </p>
                </div>
                <button
                  onClick={openExternal}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/10 text-amber-500 text-sm font-medium border border-amber-500/20 hover:bg-amber-500/20 transition-colors"
                >
                  <ExternalLink size={14} />
                  Open in Browser
                </button>
              </div>
            ) : (
              <iframe
                ref={iframeRef}
                src={url}
                onLoad={onLoad}
                onError={onError}
                className="w-full h-full border-0"
                title="In-app browser"
                allow="geolocation; camera; microphone"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
              />
            )}
          </div>
        </div>
      )}
    </InAppBrowserContext.Provider>
  );
}
