import { useEffect, useState } from "react";

const WAIT_SECONDS = 30;

/**
 * Cute animated kitty modal shown right after an invite's location consent is
 * granted, while GeoBoard verification (photos/video capture) finishes on the
 * recipient's side. Auto-dismisses after 30s, or the user can close it early.
 */
export function ConnectingKitty({ name, onClose }: { name: string; onClose: () => void }) {
  const [secondsLeft, setSecondsLeft] = useState(WAIT_SECONDS);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (secondsLeft !== 0) return;
    const t = setTimeout(onClose, 600);
    return () => clearTimeout(t);
  }, [secondsLeft, onClose]);

  const progress = ((WAIT_SECONDS - secondsLeft) / WAIT_SECONDS) * 100;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      data-testid="modal-connecting-kitty"
    >
      <div className="relative max-w-xs w-full rounded-3xl bg-gradient-to-b from-pink-50 to-violet-100 dark:from-zinc-900 dark:to-violet-950 border border-pink-200/60 dark:border-violet-800/60 shadow-2xl p-6 text-center overflow-hidden animate-in zoom-in-95 duration-300">
        {/* Floating hearts */}
        <span className="absolute top-3 left-4 text-pink-400 text-sm animate-bounce" style={{ animationDelay: "0ms" }}>💗</span>
        <span className="absolute top-6 right-6 text-pink-300 text-xs animate-bounce" style={{ animationDelay: "300ms" }}>💕</span>
        <span className="absolute bottom-16 left-6 text-pink-300 text-xs animate-bounce" style={{ animationDelay: "600ms" }}>✨</span>

        <p className="text-sm font-semibold text-violet-700 dark:text-violet-300 mb-1">
          {name} just connected!
        </p>

        {/* Kitty */}
        <div className="my-4 flex items-center justify-center">
          <div className="relative kitty-wobble" style={{ fontSize: 72, lineHeight: 1 }}>
            🐱
            <span
              className="absolute -top-2 -right-1 text-lg kitty-blink"
              aria-hidden
            >
              🥺
            </span>
          </div>
        </div>

        <p className="text-foreground font-bold text-lg mb-1">Please wait{"…"}</p>
        <p className="text-muted-foreground text-xs mb-4 leading-relaxed">
          Verifying and syncing their live location. This takes about {secondsLeft > 0 ? `${secondsLeft}s` : "a moment"} 🥺
        </p>

        {/* Progress bar */}
        <div className="h-2 w-full rounded-full bg-white/60 dark:bg-white/10 overflow-hidden mb-4">
          <div
            className="h-full rounded-full bg-gradient-to-r from-pink-400 to-violet-500 transition-all duration-1000 ease-linear"
            style={{ width: `${progress}%` }}
          />
        </div>

        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          data-testid="button-dismiss-kitty"
        >
          {secondsLeft === 0 ? "Done — close" : "Skip"}
        </button>
      </div>

      <style>{`
        @keyframes kitty-wobble-kf {
          0%, 100% { transform: rotate(-6deg) translateY(0); }
          50% { transform: rotate(6deg) translateY(-4px); }
        }
        .kitty-wobble { animation: kitty-wobble-kf 1.4s ease-in-out infinite; display: inline-block; }
        @keyframes kitty-blink-kf {
          0%, 85%, 100% { opacity: 1; transform: scale(1); }
          92% { opacity: 0.4; transform: scale(0.85); }
        }
        .kitty-blink { animation: kitty-blink-kf 2.2s ease-in-out infinite; display: inline-block; }
      `}</style>
    </div>
  );
}
