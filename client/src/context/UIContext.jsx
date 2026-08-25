import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import api, { getAccessToken } from '../lib/api';
import { useAuth } from './AuthContext';

const UIContext = createContext(null);

let toastId = 0;

export function UIProvider({ children }) {
  const { user } = useAuth();
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [theme, setTheme] = useState(() => localStorage.getItem('empcore-theme') || 'light');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('empcore-theme', theme);
  }, [theme]);

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, kind = 'success', ttl = 4000) => {
      toastId += 1;
      const id = toastId;
      setToasts((current) => [...current, { id, message, kind }]);
      setTimeout(() => dismissToast(id), ttl);
      return id;
    },
    [dismissToast]
  );

  const loadNotifications = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await api.get('/notifications');
      setNotifications(data.data);
      setUnread(data.meta.unread);
    } catch {
      /* non-critical */
    }
  }, [user]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  // Live push: the server addresses a private room per user id, so a manager sees
  // a new request the moment it is filed without polling.
  useEffect(() => {
    if (!user) return undefined;
    const token = getAccessToken();
    if (!token) return undefined;

    const socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('notification', (payload) => {
      setNotifications((current) => [payload, ...current].slice(0, 50));
      setUnread((n) => n + 1);
      toast(payload.title, 'info', 6000);
    });

    return () => socket.disconnect();
  }, [user, toast]);

  const markRead = useCallback(async (id) => {
    await api.patch(`/notifications/${id}/read`);
    setNotifications((current) =>
      current.map((n) => (n._id === id ? { ...n, readAt: new Date().toISOString() } : n))
    );
    setUnread((n) => Math.max(0, n - 1));
  }, []);

  const markAllRead = useCallback(async () => {
    await api.patch('/notifications/read-all');
    setNotifications((current) => current.map((n) => ({ ...n, readAt: new Date().toISOString() })));
    setUnread(0);
  }, []);

  const value = useMemo(
    () => ({
      toasts,
      toast,
      dismissToast,
      notifications,
      unread,
      markRead,
      markAllRead,
      reloadNotifications: loadNotifications,
      theme,
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    }),
    [toasts, toast, dismissToast, notifications, unread, markRead, markAllRead, loadNotifications, theme]
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside <UIProvider>');
  return ctx;
}
