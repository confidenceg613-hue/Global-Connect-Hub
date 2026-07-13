import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export type AccessStatusValue = "unlimited" | "subscribed" | "free" | "expired" | "locked";

export interface AccessStatus {
  allowed: boolean;
  status: AccessStatusValue;
  freeAccessesUsed: number;
  freeAccessLimit: number;
  freeAccessesRemaining: number;
  accessExpiresAt: string | null;
  message: string;
}

export interface PaymentInfo {
  amountNaira: number;
  accountNumber: string;
  bankName: string;
  accountName: string;
  whatsappNumber: string;
  instructions: string;
}

export type RedeemOutcome = { success: true } | { success: false; message: string };

interface AccessContextValue {
  status: AccessStatus | null;
  payment: PaymentInfo | null;
  loading: boolean;
  refresh: () => Promise<void>;
  redeem: (code: string) => Promise<RedeemOutcome>;
}

const AccessContext = createContext<AccessContextValue | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [status, setStatus] = useState<AccessStatus | null>(null);
  const [payment, setPayment] = useState<PaymentInfo | null>(null);
  const [loading, setLoading] = useState(true);

  // Read-only re-check (does not consume a free access) — used after redeeming
  // a code, or to refresh the displayed countdown/message.
  const refresh = useCallback(async () => {
    if (!userId) return;
    const res = await fetch(`${API_BASE}/api/access/${userId}/status`);
    const data = await res.json();
    setStatus(data);
  }, [userId]);

  const redeem = useCallback(
    async (code: string): Promise<RedeemOutcome> => {
      if (!userId) return { success: false, message: "You're not signed in." };
      const res = await fetch(`${API_BASE}/api/access/${userId}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.error ?? "That code didn't work." };
      }
      setStatus(data);
      return { success: true };
    },
    [userId],
  );

  useEffect(() => {
    fetch(`${API_BASE}/api/access/payment-info`)
      .then((res) => res.json())
      .then(setPayment)
      .catch(() => { /* non-critical — paywall screen falls back to no payment info */ });
  }, []);

  // Consumes one free access (if applicable) exactly once per app session,
  // right when a user becomes known. Later status refreshes go through
  // refresh() (peek-only) so navigating between pages never burns extra
  // free accesses.
  useEffect(() => {
    if (!userId) {
      setStatus(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`${API_BASE}/api/access/${userId}/check-in`, { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => { /* fail open on network errors — don't lock users out over a blip */ })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <AccessContext.Provider value={{ status, payment, loading, refresh, redeem }}>
      {children}
    </AccessContext.Provider>
  );
}

export function useAccess(): AccessContextValue {
  const ctx = useContext(AccessContext);
  if (!ctx) {
    throw new Error("useAccess must be used within an AccessProvider");
  }
  return ctx;
}
