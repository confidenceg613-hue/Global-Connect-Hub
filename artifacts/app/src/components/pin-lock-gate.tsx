/**
 * PinLockGate
 *
 * If the user has a PIN set, this renders a full-screen lock screen over
 * everything until the correct PIN is entered. It uses sessionStorage so the
 * app stays unlocked for the current browsing session, but re-locks after the
 * app has been backgrounded for more than 60 seconds.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { usePin } from "@/hooks/use-pin";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Lock, ShieldCheck } from "lucide-react";

const SESSION_KEY = "df_pin_unlocked";
const RELOCK_AFTER_MS = 60_000; // re-lock after 60 s backgrounded

export function PinLockGate({ children }: { children: React.ReactNode }) {
  const { hasPin, verifyPin } = usePin();
  const [locked, setLocked] = useState(() => {
    if (!hasPin()) return false;
    return sessionStorage.getItem(SESSION_KEY) !== "1";
  });
  const [pin, setPin]       = useState("");
  const [shake, setShake]   = useState(false);
  const [error, setError]   = useState("");
  const hiddenAt            = useRef<number | null>(null);

  // Re-lock if app was backgrounded long enough
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
      } else {
        if (
          hiddenAt.current !== null &&
          Date.now() - hiddenAt.current >= RELOCK_AFTER_MS &&
          hasPin()
        ) {
          sessionStorage.removeItem(SESSION_KEY);
          setLocked(true);
          setPin("");
          setError("");
        }
        hiddenAt.current = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [hasPin]);

  const tryUnlock = useCallback((value: string) => {
    if (value.length < 4) return;
    if (verifyPin(value)) {
      sessionStorage.setItem(SESSION_KEY, "1");
      setLocked(false);
      setPin("");
      setError("");
    } else {
      setShake(true);
      setError("Incorrect PIN");
      setPin("");
      setTimeout(() => setShake(false), 500);
    }
  }, [verifyPin]);

  if (!locked) return <>{children}</>;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8"
      style={{
        background: "linear-gradient(180deg,#0D0A06 0%,#130d04 100%)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {/* Brand */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
          <Lock size={28} className="text-amber-400" />
        </div>
        <div className="text-center">
          <h1
            className="text-2xl font-extrabold text-amber-400 tracking-tight"
            style={{ fontFamily: "Syne, system-ui, sans-serif" }}
          >
            DeepFalcon
          </h1>
          <p className="text-xs text-muted-foreground font-mono tracking-widest mt-1">
            ENTER YOUR PIN TO CONTINUE
          </p>
        </div>
      </div>

      {/* OTP input */}
      <div
        className={`flex flex-col items-center gap-4 transition-all ${shake ? "animate-[shake_0.4s_ease-in-out]" : ""}`}
        style={shake ? { animation: "shake 0.4s ease-in-out" } : {}}
      >
        <InputOTP
          maxLength={4}
          value={pin}
          onChange={(v) => {
            setPin(v);
            setError("");
            if (v.length === 4) tryUnlock(v);
          }}
          autoFocus
        >
          <InputOTPGroup className="gap-4">
            {[0, 1, 2, 3].map((i) => (
              <InputOTPSlot
                key={i}
                index={i}
                className="h-16 w-16 text-2xl rounded-2xl border-2 border-amber-500/20 bg-amber-500/5 text-amber-300 focus:border-amber-500"
              />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {error ? (
          <p className="text-xs text-red-400 font-mono tracking-wide">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground/40 font-mono tracking-wide">
            4-DIGIT PIN
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="absolute bottom-8 flex items-center gap-1.5 text-muted-foreground/30">
        <ShieldCheck size={12} />
        <span className="text-[10px] font-mono tracking-widest">SECURED BY DEEPFALCON</span>
      </div>

      {/* Shake keyframe injected inline */}
      <style>{`
        @keyframes shake {
          0%,100%{transform:translateX(0)}
          20%{transform:translateX(-8px)}
          40%{transform:translateX(8px)}
          60%{transform:translateX(-6px)}
          80%{transform:translateX(6px)}
        }
      `}</style>
    </div>
  );
}
