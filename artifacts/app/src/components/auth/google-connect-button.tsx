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
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

interface GoogleConnectButtonProps {
  /** Called with the raw Google ID token once the user picks an account. */
  onCredential: (idToken: string) => void;
  /** Button text/shape — defaults suit a primary sign-in placement. */
  text?: "signin_with" | "signup_with" | "continue_with";
  shape?: "rectangular" | "pill";
  width?: number;
}

/**
 * Renders Google's official "Sign in with Google" button using Google
 * Identity Services (GIS). Falls back to a disabled explainer button if the
 * script hasn't loaded yet or GOOGLE_CLIENT_ID isn't configured.
 */
export function GoogleConnectButton({
  onCredential,
  text = "continue_with",
  shape = "pill",
  width = 320,
}: GoogleConnectButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

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
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
        window.google.accounts.id.renderButton(containerRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text,
          shape,
          logo_alignment: "left",
          width,
        });
      }
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

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} />
      {!ready && (
        <div className="h-11 w-full rounded-full bg-muted animate-pulse" style={{ maxWidth: width }} />
      )}
    </div>
  );
}
