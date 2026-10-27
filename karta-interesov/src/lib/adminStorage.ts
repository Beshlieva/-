import type { AdminSession } from '../types';

/**
 * Сессия администратора хранится в sessionStorage: она живёт до закрытия вкладки и не попадает в другие вкладки.
 * Токен на сервере действует ограниченное время (ADMIN_TOKEN_TTL_MINUTES) и аннулируется при выходе.
 */
const KEY = 'karta-interesov:admin:v1';

export function loadAdminSession(): AdminSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    if (typeof o.token !== 'string' || !/^[a-f0-9]{64}$/.test(o.token) || typeof o.expiresAt !== 'string') return null;
    if (Date.parse(o.expiresAt) <= Date.now()) return null;
    return { token: o.token, expiresAt: o.expiresAt };
  } catch {
    return null;
  }
}

export function saveAdminSession(session: AdminSession): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* хранилище недоступно: вход будет действовать до перезагрузки страницы */
  }
}

export function clearAdminSession(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    /* ничего не делаем */
  }
}
