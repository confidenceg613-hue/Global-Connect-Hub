/**
 * IncomingRequestModal
 * Listens on the notification SSE stream for `location_request` notifications
 * and shows a full-screen overlay asking the user to accept or dismiss.
 * Accepting navigates to the consent page (/consent/:token).
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, X, Shield } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface LocationRequest {
  notifId: number;
  fromName: string;
  token: string;
}

export function IncomingRequestModal() {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();
  const [pending, setPending] = useState<LocationRequest | null>(null);
  const seenIds = useRef<Set<number>>(new Set());
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!userId) return;

    const es = new EventSource(`${API_BASE}/api/notifications/${userId}/stream`);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const notif = JSON.parse(e.data);
        if (
          notif.type === "location_request" &&
          !seenIds.current.has(notif.id) &&
          notif.data?.token
        ) {
          seenIds.current.add(notif.id);
          setPending({
            notifId: notif.id,
            fromName: String(notif.data?.fromName ?? "Someone"),
            token: String(notif.data.token),
          });
        }
      } catch { /* ignore bad frames */ }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [userId]);

  const handleAccept = () => {
    if (!pending) return;
    setLocation(`/consent/${pending.token}`);
    setPending(null);
  };

  const handleDismiss = () => setPending(null);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          key="incoming-request-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9000] flex items-center justify-center p-6"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }}
        >
          <motion.div
            initial={{ scale: 0.88, opacity: 0, y: 24 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 16 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            className="w-full max-w-sm rounded-3xl overflow-hidden"
            style={{
              background: "hsl(var(--card))",
              border: "1px solid hsl(var(--border))",
              boxShadow: "0 32px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(245,158,11,0.12)",
            }}
          >
            {/* Amber glow header */}
            <div
              className="relative flex flex-col items-center pt-8 pb-6 px-6"
              style={{
                background: "linear-gradient(160deg, rgba(245,158,11,0.15) 0%, transparent 60%)",
                borderBottom: "1px solid hsl(var(--border))",
              }}
            >
              {/* Dismiss */}
              <button
                onClick={handleDismiss}
                className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}
              >
                <X className="w-4 h-4" />
              </button>

              {/* Animated ping icon */}
              <div className="relative mb-4">
                <div
                  className="absolute inset-0 rounded-full animate-ping"
                  style={{ background: "rgba(245,158,11,0.25)" }}
                />
                <div
                  className="relative w-16 h-16 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(245,158,11,0.15)", border: "2px solid rgba(245,158,11,0.4)" }}
                >
                  <MapPin className="w-8 h-8" style={{ color: "#f59e0b" }} />
                </div>
              </div>

              <p
                className="text-xs font-bold uppercase tracking-widest mb-1"
                style={{ color: "#f59e0b" }}
              >
                Location Request
              </p>
              <h2
                className="text-xl font-black text-center"
                style={{ color: "hsl(var(--foreground))" }}
              >
                {pending.fromName}
              </h2>
              <p
                className="text-sm text-center mt-1"
                style={{ color: "hsl(var(--muted-foreground))" }}
              >
                is asking to see your live location
              </p>
            </div>

            {/* Info row */}
            <div className="px-6 py-4 flex items-start gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: "rgba(245,158,11,0.1)" }}
              >
                <Shield className="w-4 h-4" style={{ color: "#f59e0b" }} />
              </div>
              <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                You control when sharing starts and stops. Accepting opens a secure consent screen where you choose what to share.
              </p>
            </div>

            {/* Actions */}
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={handleDismiss}
                className="flex-1 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95"
                style={{
                  background: "hsl(var(--muted))",
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                Dismiss
              </button>
              <button
                onClick={handleAccept}
                className="flex-[2] py-3 rounded-2xl text-sm font-black transition-all active:scale-95"
                style={{
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  color: "#1c1917",
                  boxShadow: "0 8px 24px rgba(245,158,11,0.4)",
                }}
              >
                Accept & Share Location
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
