import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { setAccessToken, setSessionLostHandler, errorMessage } from '../lib/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
  }, []);

  // On a hard refresh the in-memory access token is gone, but the httpOnly refresh
  // cookie is not — so the session is restored by exchanging it for a new token.
  useEffect(() => {
    setSessionLostHandler(clearSession);
    (async () => {
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.data.accessToken);
        setUser(data.data.user);
      } catch {
        clearSession();
      } finally {
        setBooting(false);
      }
    })();
  }, [clearSession]);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
    return data.data.user;
  }, []);

  const register = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/register', { email, password });
    setAccessToken(data.data.accessToken);
    setUser(data.data.user);
    return data.data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the cookie is cleared regardless */
    }
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.data);
    return data.data;
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      login,
      register,
      logout,
      refreshUser,
      isAdmin: user?.role === 'admin',
      isManager: user?.role === 'manager',
      // "Approver" covers both roles that can act on a queue.
      isApprover: user?.role === 'admin' || user?.role === 'manager',
      employeeId: user?.employeeId || null,
    }),
    [user, booting, login, register, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export { errorMessage };
