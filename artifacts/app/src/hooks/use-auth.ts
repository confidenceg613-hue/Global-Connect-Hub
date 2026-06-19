import { useState } from 'react';

const USER_KEY = 'phoneLink_userId';

function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore — private mode or storage full
  }
}

function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function useAuth() {
  const [userId, setUserId] = useState<number | null>(() => {
    const stored = safeGetItem(USER_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });

  const login = (id: number) => {
    safeSetItem(USER_KEY, id.toString());
    setUserId(id);
  };

  const logout = () => {
    safeRemoveItem(USER_KEY);
    setUserId(null);
  };

  return { userId, login, logout };
}
