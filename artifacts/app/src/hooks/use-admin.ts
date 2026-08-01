import { useCallback, useState } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const STORAGE_KEY = "deepfalcon_admin_secret";

export type UserStatus = "unlimited" | "subscribed" | "free" | "expired" | "locked";

export interface AdminUserSummary {
  id: number;
  name: string;
  phone: string | null;
  googleEmail: string | null;
  createdAt: string;
  status: UserStatus;
  allowed: boolean;
  freeAccessesUsed: number;
  freeAccessLimit: number;
  accessExpiresAt: string | null;
  activeCodeId: number | null;
}

export interface AdminStats {
  totalUsers: number;
  unlimitedCount: number;
  subscribedCount: number;
  freeCount: number;
  lockedOrExpiredCount: number;
  totalRevenueNaira: number;
  totalRedemptions: number;
  activeCodes: number;
  totalCodes: number;
}

export interface AdminCode {
  id: number;
  code: string;
  label: string | null;
  durationDays: number | null;
  maxRedemptions: number | null;
  priceNaira: number | null;
  redemptionCount: number;
  isRevoked: boolean;
  createdAt: string;
}

export interface RedemptionHistoryEntry {
  id: number;
  redeemedAt: string;
  expiresAt: string | null;
  code: string;
  label: string | null;
  priceNaira: number | null;
}

export interface AdminConsent {
  id: number;
  userId: number;
  userName: string;
  userPhone: string | null;
  type: "location" | "notification" | "messaging";
  status: "granted" | "denied" | "revoked";
  purpose: string | null;
  grantedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

// Reads/writes the admin password held only in this tab's sessionStorage —
// it is never baked into the frontend bundle. Every admin request sends it
// as the x-admin-secret header; the server is the sole source of truth on
// whether it's correct (see requireAdmin middleware).
function getStoredSecret(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeSecret(secret: string | null) {
  try {
    if (secret) sessionStorage.setItem(STORAGE_KEY, secret);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* private browsing / storage disabled — session just won't persist */ }
}

async function adminFetch(path: string, secret: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      "x-admin-secret": secret,
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export function useAdmin() {
  const [secret, setSecret] = useState<string | null>(() => getStoredSecret());
  const [unlocked, setUnlocked] = useState<boolean>(() => !!getStoredSecret());
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [codes, setCodes] = useState<AdminCode[]>([]);
  const [consents, setConsents] = useState<AdminConsent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (password: string): Promise<{ ok: boolean; message?: string }> => {
    const res = await adminFetch("/login", password, { method: "POST", body: "{}" });
    if (res.status === 503) return { ok: false, message: "Admin access isn't configured on this server yet." };
    if (!res.ok) return { ok: false, message: "Incorrect password." };
    setSecret(password);
    storeSecret(password);
    setUnlocked(true);
    return { ok: true };
  }, []);

  const logout = useCallback(() => {
    storeSecret(null);
    setSecret(null);
    setUnlocked(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, codesRes, consentsRes] = await Promise.all([
        adminFetch("/overview", secret),
        adminFetch("/codes", secret),
        adminFetch("/consents", secret),
      ]);
      if (overviewRes.status === 401 || codesRes.status === 401) {
        logout();
        setError("Session expired — enter the password again.");
        return;
      }
      const overview = await overviewRes.json();
      const codesData = await codesRes.json();
      const consentsData = consentsRes.ok ? await consentsRes.json() : [];
      setStats(overview.stats);
      setUsers(overview.users);
      setCodes(codesData);
      setConsents(consentsData);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }, [secret, logout]);

  const sendMessage = useCallback(async (userId: number, title: string, body: string) => {
    if (!secret) return { ok: false };
    const res = await adminFetch("/messages", secret, {
      method: "POST",
      body: JSON.stringify({ userId, title, body }),
    });
    return { ok: res.ok };
  }, [secret]);

  const setUnlimited = useCallback(async (userId: number, hasUnlimitedAccess: boolean) => {
    if (!secret) return;
    await adminFetch(`/users/${userId}/unlimited`, secret, {
      method: "PATCH",
      body: JSON.stringify({ hasUnlimitedAccess }),
    });
    await refresh();
  }, [secret, refresh]);

  const revokeAccess = useCallback(async (userId: number) => {
    if (!secret) return;
    await adminFetch(`/users/${userId}/revoke-access`, secret, { method: "POST", body: "{}" });
    await refresh();
  }, [secret, refresh]);

  const resetFreeTrial = useCallback(async (userId: number) => {
    if (!secret) return;
    await adminFetch(`/users/${userId}/reset-free-trial`, secret, { method: "POST", body: "{}" });
    await refresh();
  }, [secret, refresh]);

  const getUserHistory = useCallback(async (userId: number): Promise<RedemptionHistoryEntry[]> => {
    if (!secret) return [];
    const res = await adminFetch(`/users/${userId}/history`, secret);
    if (!res.ok) return [];
    return res.json();
  }, [secret]);

  const createCode = useCallback(async (input: {
    code: string;
    label?: string;
    durationDays?: number | null;
    maxRedemptions?: number | null;
    priceNaira?: number | null;
  }): Promise<{ ok: boolean; message?: string }> => {
    if (!secret) return { ok: false };
    const res = await adminFetch("/codes", secret, {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error ?? "Failed to create code." };
    }
    await refresh();
    return { ok: true };
  }, [secret, refresh]);

  const revokeCode = useCallback(async (id: number) => {
    if (!secret) return;
    await adminFetch(`/codes/${id}/revoke`, secret, { method: "PATCH", body: "{}" });
    await refresh();
  }, [secret, refresh]);

  const revokeConsent = useCallback(async (id: number) => {
    if (!secret) return;
    await adminFetch(`/consents/${id}/revoke`, secret, { method: "PATCH", body: "{}" });
    await refresh();
  }, [secret, refresh]);

  return {
    unlocked,
    login,
    logout,
    stats,
    users,
    codes,
    consents,
    loading,
    error,
    refresh,
    sendMessage,
    setUnlimited,
    revokeAccess,
    resetFreeTrial,
    getUserHistory,
    createCode,
    revokeCode,
    revokeConsent,
  };
}
