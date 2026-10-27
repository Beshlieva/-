import { useCallback, useState } from 'react';
import AdminLoginScreen from './screens/AdminLoginScreen';
import AdminDashboard from './screens/AdminDashboard';
import { clearAdminSession, loadAdminSession, saveAdminSession } from './lib/adminStorage';
import { adminService } from './services/api';
import type { AdminSession } from './types';

/** Панель администратора: отдельная страница (адрес /#/admin), студенческий интерфейс она не затрагивает. */
export default function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(() => loadAdminSession());
  const [notice, setNotice] = useState<string | null>(null);

  const handleLogin = useCallback((next: AdminSession) => {
    saveAdminSession(next);
    setNotice(null);
    setSession(next);
  }, []);

  const handleLogout = useCallback((message?: string) => {
    const token = session?.token;
    if (token) void adminService.logout(token).catch(() => undefined); // токен аннулируется на сервере, если он доступен
    clearAdminSession();
    setNotice(message ?? null);
    setSession(null);
  }, [session]);

  if (!session) return <AdminLoginScreen onLogin={handleLogin} notice={notice} />;
  return <AdminDashboard token={session.token} onLogout={handleLogout} />;
}
