import type { AuthSession } from '../types';

/**
 * Сессия пользователя в localStorage ЭТОГО браузера: профиль + токен доступа.
 * Токен нужен, чтобы позже привязывать к пользователю попытки, ответы и результаты
 * (заголовок Authorization: Bearer …, см. services/api/http.ts).
 *
 * Компромисс: localStorage доступен любому скрипту на странице, поэтому на сайте не должно быть
 * сторонних скриптов. На сервере токен хранится только как SHA-256 и аннулируется при выходе.
 * Пароль нигде не сохраняется.
 */
const KEY = 'karta-interesov:auth:v1';

export function loadAuth(): AuthSession | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null) return null;
    const o = d as Record<string, unknown>;
    const u = o.user as Record<string, unknown> | null;
    if (typeof o.accessToken !== 'string' || !/^[a-f0-9]{64}$/.test(o.accessToken)) return null;
    if (typeof u !== 'object' || u === null || typeof u.userId !== 'string' || typeof u.email !== 'string') return null;
    return {
      accessToken: o.accessToken,
      user: {
        userId: u.userId,
        email: u.email,
        displayName: typeof u.displayName === 'string' ? u.displayName : '',
        age: typeof u.age === 'number' ? u.age : null,
        regionCode: typeof u.regionCode === 'string' ? u.regionCode : null,
        createdAt: typeof u.createdAt === 'string' ? u.createdAt : '',
      },
    };
  } catch {
    return null;
  }
}

export function saveAuth(session: AuthSession): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* приватный режим или переполнение — работаем без сохранения, при обновлении страницы потребуется вход */
  }
}

export function clearAuth(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
