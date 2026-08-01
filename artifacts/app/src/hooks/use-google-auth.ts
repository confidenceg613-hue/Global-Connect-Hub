import { useState } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface GoogleAuthUser {
  id: number;
  name: string;
  phoneNumber?: string | null;
  fullPhone?: string | null;
  googleId?: string | null;
  googleEmail?: string | null;
  googleName?: string | null;
  googlePicture?: string | null;
  createdAt: string;
}

interface GoogleAuthResult {
  user: GoogleAuthUser;
  isNewAccount: boolean;
}

/**
 * Talks to POST/DELETE /api/auth/google — verifying a Google ID token on the
 * backend and returning the linked (or newly created) DeepFalcon user.
 */
export function useGoogleAuth() {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signInWithGoogle = async (
    idToken: string,
    currentUserId?: number | null
  ): Promise<GoogleAuthResult> => {
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          ...(currentUserId ? { currentUserId } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Google sign-in failed");
      return data as GoogleAuthResult;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
      throw new Error(message);
    } finally {
      setIsPending(false);
    }
  };

  const disconnectGoogle = async (userId: number) => {
    setIsPending(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/google/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to disconnect Google");
      return data.user as GoogleAuthUser;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to disconnect Google";
      setError(message);
      throw new Error(message);
    } finally {
      setIsPending(false);
    }
  };

  return { signInWithGoogle, disconnectGoogle, isPending, error };
}
