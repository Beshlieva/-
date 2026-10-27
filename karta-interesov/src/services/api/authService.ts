import { ApiError } from '../../types';
import type { AuthSession, AuthUser, LoginRequest, RegisterRequest } from '../../types';
import type { ApiConfig } from './config';
import { createHttpClient } from './http';

export interface AuthCallOptions {
  signal?: AbortSignal;
}

/** Регистрация, вход и проверка сессии пользователя. Работает только с реальным API. */
export interface AuthService {
  /** Доступна ли регистрация (в демо-режиме сервера нет, и приложение работает без неё). */
  readonly enabled: boolean;
  /** POST /auth/register */
  register(request: RegisterRequest, options?: AuthCallOptions): Promise<AuthSession>;
  /** POST /auth/login */
  login(request: LoginRequest, options?: AuthCallOptions): Promise<AuthSession>;
  /** GET /users/me — проверка, что сохранённый токен ещё действует. */
  me(token: string, options?: AuthCallOptions): Promise<AuthUser>;
  /** POST /auth/logout — аннулирует токен на сервере. */
  logout(token: string): Promise<void>;
}

function parseUser(data: unknown): AuthUser {
  if (typeof data !== 'object' || data === null) {
    throw new ApiError('INVALID_RESPONSE', 'Сервер вернул данные в неожиданном формате.');
  }
  const d = data as Record<string, unknown>;
  if (typeof d.userId !== 'string' || d.userId === '' || typeof d.email !== 'string') {
    throw new ApiError('INVALID_RESPONSE', 'Сервер вернул данные в неожиданном формате.');
  }
  return {
    userId: d.userId,
    email: d.email,
    displayName: typeof d.displayName === 'string' ? d.displayName : '',
    age: typeof d.age === 'number' ? d.age : null,
    regionCode: typeof d.regionCode === 'string' ? d.regionCode : null,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : '',
  };
}

function parseSession(data: unknown): AuthSession {
  const user = parseUser(data);
  const token = (data as Record<string, unknown>).accessToken;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
    throw new ApiError('INVALID_RESPONSE', 'Сервер не выдал токен доступа.');
  }
  return { user, accessToken: token };
}

export function createAuthService(config: ApiConfig): AuthService {
  if (config.mode === 'demo') {
    const unavailable = () =>
      Promise.reject(
        new ApiError('NOT_AVAILABLE_IN_DEMO', 'Регистрация доступна только при подключённом сервере (VITE_API_MODE=api).'),
      );
    return { enabled: false, register: unavailable, login: unavailable, me: unavailable, logout: () => Promise.resolve() };
  }

  const http = createHttpClient(config);
  return {
    enabled: true,
    async register(request, options) {
      const data = await http.request('/auth/register', { method: 'POST', body: request, signal: options?.signal });
      return parseSession(data);
    },
    async login(request, options) {
      const data = await http.request('/auth/login', { method: 'POST', body: request, signal: options?.signal });
      return parseSession(data);
    },
    async me(token, options) {
      const data = await http.request('/users/me', { token, signal: options?.signal });
      return parseUser(data);
    },
    async logout(token) {
      await http.request('/auth/logout', { method: 'POST', token });
    },
  };
}
