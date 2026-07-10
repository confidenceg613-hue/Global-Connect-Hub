import { createContext, useContext, useState, type ReactNode } from 'react';

const USER_KEY = 'phoneLink_userId';
const DEVICE_TRUSTED_KEY = 'phoneLink_deviceTrusted';

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

interface AuthContextValue {
  userId: number | null;
  login: (id: number) => void;
  logout: () => void;
  isDeviceTrusted: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<number | null>(() => {
    const stored = safeGetItem(USER_KEY);
    if (!stored) return null;
    const parsed = parseInt(stored, 10);
    return Number.isNaN(parsed) ? null : parsed;
  });
  const [isDeviceTrusted, setIsDeviceTrusted] = useState(
    () => safeGetItem(DEVICE_TRUSTED_KEY) === '1'
  );

  const login = (id: number) => {
    safeSetItem(USER_KEY, id.toString());
    safeSetItem(DEVICE_TRUSTED_KEY, '1');
    setUserId(id);
    setIsDeviceTrusted(true);
  };

  const logout = () => {
    safeRemoveItem(USER_KEY);
    setUserId(null);
  };

  return (
    <AuthContext.Provider value={{ userId, login, logout, isDeviceTrusted }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
