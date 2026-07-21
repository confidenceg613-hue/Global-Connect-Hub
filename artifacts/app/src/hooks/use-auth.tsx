import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

const USER_KEY = 'phoneLink_userId';
const DEVICE_TRUSTED_KEY = 'phoneLink_deviceTrusted';
const ACCOUNTS_KEY = 'phoneLink_accounts';

function safeGetItem(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSetItem(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch {}
}
function safeRemoveItem(key: string): void {
  try { localStorage.removeItem(key); } catch {}
}

export interface SavedAccount {
  userId: number;
  name: string;
  phone: string;
}

function loadAccounts(): SavedAccount[] {
  try {
    const raw = safeGetItem(ACCOUNTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveAccounts(accounts: SavedAccount[]): void {
  safeSetItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

interface AuthContextValue {
  userId: number | null;
  isDeviceTrusted: boolean;
  savedAccounts: SavedAccount[];
  login: (id: number, meta?: { name: string; phone: string }) => void;
  logout: () => void;
  switchAccount: (id: number) => void;
  addAccountSlot: () => void;
  removeAccount: (id: number) => void;
  updateCurrentAccountMeta: (name: string, phone: string) => void;
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

  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>(loadAccounts);

  const upsertAccount = useCallback((account: SavedAccount) => {
    setSavedAccounts(prev => {
      const next = prev.filter(a => a.userId !== account.userId);
      next.push(account);
      saveAccounts(next);
      return next;
    });
  }, []);

  const login = useCallback((id: number, meta?: { name: string; phone: string }) => {
    safeSetItem(USER_KEY, id.toString());
    safeSetItem(DEVICE_TRUSTED_KEY, '1');
    setUserId(id);
    setIsDeviceTrusted(true);
    if (meta) {
      upsertAccount({ userId: id, name: meta.name, phone: meta.phone });
    } else {
      // Ensure the account slot exists even without meta
      setSavedAccounts(prev => {
        if (prev.some(a => a.userId === id)) return prev;
        const next = [...prev, { userId: id, name: '', phone: '' }];
        saveAccounts(next);
        return next;
      });
    }
  }, [upsertAccount]);

  const logout = useCallback(() => {
    safeRemoveItem(USER_KEY);
    setUserId(null);
  }, []);

  // Switch to another saved account
  const switchAccount = useCallback((id: number) => {
    safeSetItem(USER_KEY, id.toString());
    safeSetItem(DEVICE_TRUSTED_KEY, '1');
    setUserId(id);
    setIsDeviceTrusted(true);
  }, []);

  // Sign out current user but keep account in list, then caller navigates to landing
  const addAccountSlot = useCallback(() => {
    safeRemoveItem(USER_KEY);
    setUserId(null);
  }, []);

  // Remove a saved account from the list
  const removeAccount = useCallback((id: number) => {
    setSavedAccounts(prev => {
      const next = prev.filter(a => a.userId !== id);
      saveAccounts(next);
      return next;
    });
    // If removing the active account, also sign out
    setUserId(prev => {
      if (prev === id) {
        safeRemoveItem(USER_KEY);
        return null;
      }
      return prev;
    });
  }, []);

  // Called after fetching user data to keep display info fresh
  const updateCurrentAccountMeta = useCallback((name: string, phone: string) => {
    setUserId(id => {
      if (id !== null) {
        upsertAccount({ userId: id, name, phone });
      }
      return id;
    });
  }, [upsertAccount]);

  return (
    <AuthContext.Provider value={{
      userId, isDeviceTrusted, savedAccounts,
      login, logout, switchAccount, addAccountSlot, removeAccount, updateCurrentAccountMeta,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
