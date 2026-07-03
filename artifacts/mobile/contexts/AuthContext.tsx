import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface AuthContextType {
  userId: number | null;
  isLoading: boolean;
  login: (id: number) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  userId: null,
  isLoading: true,
  login: async () => {},
  logout: async () => {},
});

const USER_KEY = 'phoneLink_userId';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [userId, setUserId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(USER_KEY).then((val) => {
      if (val) {
        const parsed = parseInt(val, 10);
        if (!isNaN(parsed)) setUserId(parsed);
      }
      setIsLoading(false);
    });
  }, []);

  const login = async (id: number) => {
    await AsyncStorage.setItem(USER_KEY, id.toString());
    setUserId(id);
  };

  const logout = async () => {
    await AsyncStorage.removeItem(USER_KEY);
    setUserId(null);
  };

  return (
    <AuthContext.Provider value={{ userId, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
