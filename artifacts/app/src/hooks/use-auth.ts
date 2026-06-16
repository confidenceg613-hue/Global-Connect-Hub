import { useState, useEffect } from 'react';

export function useAuth() {
  const [userId, setUserId] = useState<number | null>(() => {
    const stored = localStorage.getItem('phoneLink_userId');
    return stored ? parseInt(stored, 10) : null;
  });

  const login = (id: number) => {
    localStorage.setItem('phoneLink_userId', id.toString());
    setUserId(id);
  };

  const logout = () => {
    localStorage.removeItem('phoneLink_userId');
    setUserId(null);
  };

  return { userId, login, logout };
}
