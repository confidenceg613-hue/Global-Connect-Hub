import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          prompt: () => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

/** Google's official multicolor "G" mark, inline so it never depends on an external asset. */
function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.4 0 6.4 1.17 8.8 3.46l6.55-6.55C35.34 2.62 30.06 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.62 5.92C12.1 13.13 17.6 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.5 24.5c0-1.64-.15-3.22-.42-4.75H24v9h12.6c-.55 2.9-2.2 5.36-4.68 7.02l7.28 5.66C43.5 37.62 46.5 31.6 46.5 24.5z"/>
      <path fill="#FBBC05" d="M10.18 28.86A14.5 14.5 0 0 1 9.5 24c0-1.68.29-3.31.68-4.86l-7.62-5.92A24 24 0 0 0 0 24c0 3.86.92 7.51 2.56 10.78l7.62-5.92z"/>
      <path fill="#34A853" d="M24 48c6.06 0 11.15-2 14.86-5.42l-7.28-5.66c-2.02 1.36-4.6 2.16-7.58 2.16-6.4 0-11.9-3.63-13.82-8.72l-7.62 5.92C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

interface GoogleConnectButtonProps {
  /** Called with the raw Google ID token once the user picks an account. */
  onCredential: (idToken: string) => void;
  /** Copy shown on the custom button. */
  label?: string;
  width?: number;
}

/**
 * Custom-styled "Continue with Google" button that drives Google Identity
 * Services (GIS) programmatically, rather than relying on Google's own
 * `renderButton` iframe (which shows a broken-image placeholder whenever the
 * page origin isn't yet authorized for the OAuth client, and otherwise can't
 * be restyled to match the app).
 */
export function GoogleConnectButton({
  onCredential,
  label = "Continue with Google",
  width = 320,
}: GoogleConnectButtonProps) {
  const initialized = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;

    let cancelled = false;
    let attempts = 0;

    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        attempts += 1;
        if (attempts < 40) setTimeout(tryInit, 150);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => onCredential(response.credential),
      });
      initialized.current = true;
      setReady(true);
    };

    tryInit();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!GOOGLE_CLIENT_ID) {
    return (
      <div className="text-xs text-muted-foreground border border-dashed border-border rounded-lg px-3 py-2.5 text-center">
        Google sign-in isn't configured yet.
      </div>
    );
  }

  const handleClick = () => {
    if (!initialized.current || !window.google?.accounts?.id) {
      setError("Still loading Google sign-in — try again in a moment.");
      return;
    }
    setError(null);
    window.google.accounts.id.prompt();
  };

  return (
    <div className="flex flex-col items-center gap-2" style={{ maxWidth: width, width: "100%" }}>
      <button
        type="button"
        onClick={handleClick}
        disabled={!ready}
        className="flex w-full items-center justify-center gap-3 h-11 rounded-full border border-border bg-white text-[#3c4043] text-sm font-medium shadow-sm hover:shadow-md hover:bg-neutral-50 active:bg-neutral-100 transition disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {ready ? <GoogleLogo /> : <span className="h-[18px] w-[18px] rounded-full bg-neutral-200 animate-pulse" />}
        {label}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
