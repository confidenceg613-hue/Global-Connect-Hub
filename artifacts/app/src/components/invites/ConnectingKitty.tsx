import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { FloatingSparkles } from "./FloatingSparkles";

const WAIT_SECONDS = 40;

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
      <motion.div
        className="relative max-w-xs w-full rounded-3xl bg-gradient-to-b from-pink-50 to-violet-100 dark:from-zinc-900 dark:to-violet-950 border border-pink-200/60 dark:border-violet-800/60 shadow-2xl p-6 text-center overflow-hidden"
        style={{ backdropFilter: "blur(8px)" }}
        initial={{ opacity: 0, scale: 0.9, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, type: "spring", bounce: 0.35 }}
      >
        <FloatingSparkles />

        <p className="relative z-10 text-sm font-semibold text-violet-700 dark:text-violet-300 mb-1">
          {name} just connected!
        </p>

        {/* Kitty */}
        <div className="relative z-10 my-4 flex items-center justify-center">
          <motion.div
            className="relative"
            style={{ fontSize: 72, lineHeight: 1 }}
            animate={{ rotate: [-6, 6, -6], y: [0, -4, 0] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          >
            🐱
            <motion.span
              className="absolute -top-2 -right-1 text-lg"
              aria-hidden
              animate={{ opacity: [1, 0.4, 1], scale: [1, 0.85, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
            >
              🥺
            </motion.span>
          </motion.div>
        </div>

        <p className="relative z-10 text-foreground font-bold text-lg mb-1">Please wait{"…"}</p>
        <p className="relative z-10 text-muted-foreground text-xs mb-4 leading-relaxed">
          Verifying and syncing their live location. This takes about {secondsLeft > 0 ? `${secondsLeft}s` : "a moment"} 🥺
        </p>

        {/* Progress bar */}
        <div className="relative z-10 h-2 w-full rounded-full bg-white/60 dark:bg-white/10 overflow-hidden mb-4">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-pink-400 to-violet-500"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 1, ease: "linear" }}
          />
        </div>

        <button
          onClick={onClose}
          className="relative z-10 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          data-testid="button-dismiss-kitty"
        >
          {secondsLeft === 0 ? "Done — close" : "Skip"}
        </button>
      </motion.div>
    </div>
  );
}
