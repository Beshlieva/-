/**
 * Настройки подключения к backend. Читаются из переменных окружения Vite (см. .env.example).
 * Значения VITE_* попадают в публичный код сайта — секретов здесь быть не может.
 */
export type ApiMode = 'demo' | 'api';

export interface ApiConfig {
  mode: ApiMode;
  /** Базовый адрес API без завершающего слэша; null в демо-режиме. */
  baseUrl: string | null;
  timeoutMs: number;
  /** Текст ошибки конфигурации. Если не null — любой вызов API завершится ошибкой NOT_CONFIGURED. */
  configError: string | null;
}

type Env = Record<string, string | undefined>;

const DEFAULT_TIMEOUT_MS = 15000;

export function resolveApiConfig(env: Env): ApiConfig {
  const rawMode = (env.VITE_API_MODE ?? 'api').trim().toLowerCase();

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  const rawTimeout = env.VITE_API_TIMEOUT_MS?.trim();
  if (rawTimeout) {
    const parsed = Number(rawTimeout);
    if (Number.isFinite(parsed)) timeoutMs = Math.min(120000, Math.max(1000, Math.round(parsed)));
  }

  if (rawMode === 'demo') {
    return { mode: 'demo', baseUrl: null, timeoutMs, configError: null };
  }

  if (rawMode !== 'api') {
    return {
      mode: 'api',
      baseUrl: null,
      timeoutMs,
      configError: `Недопустимое значение VITE_API_MODE="${rawMode}". Допустимы "demo" и "api".`,
    };
  }

  const rawUrl = (env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1').trim().replace(/\/+$/, '');
  if (!rawUrl) {
    return {
      mode: 'api',
      baseUrl: null,
      timeoutMs,
      configError: 'Включён режим VITE_API_MODE=api, но не задан VITE_API_BASE_URL.',
    };
  }
  if (!/^https?:\/\//i.test(rawUrl) && !rawUrl.startsWith('/')) {
    return {
      mode: 'api',
      baseUrl: null,
      timeoutMs,
      configError: 'VITE_API_BASE_URL должен начинаться с http://, https:// или "/".',
    };
  }

  return { mode: 'api', baseUrl: rawUrl, timeoutMs, configError: null };
}
