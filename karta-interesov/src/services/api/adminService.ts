import { ApiError } from '../../types';
import type {
  AdminFilters,
  AdminOverview,
  AdminResultDetail,
  AdminResultRow,
  AdminSession,
  AdminUserRow,
  AnalyticsFilters,
  AnalyticsSummary,
  AttemptListItem,
  ListAttemptsParams,
  Paginated,
  RegionAggregate,
} from '../../types';
import type { ApiConfig } from './config';
import { createHttpClient } from './http';
import type { CallOptions } from './testService';
import {
  parseAdminOverview,
  parseAdminResultDetail,
  parseAdminResults,
  parseAdminSession,
  parseAdminUsers,
  parseAnalyticsSummary,
  parseAttemptList,
  parseRegionStats,
} from './validators';

/** Токен администратора (из POST /admin/login). Это НЕ токен студента: сервер проверяет их по разным таблицам. */
export interface AdminCallOptions extends CallOptions {
  token?: string;
}

export interface PageParams {
  page?: number;
  pageSize?: number;
}

/**
 * Административный API. Адреса /admin/...; доступ ограничивается на сервере (токен администратора),
 * скрытие интерфейса на frontend — не защита.
 */
export interface AdminService {
  readonly enabled: boolean;
  login(username: string, password: string, options?: CallOptions): Promise<AdminSession>;
  logout(token: string): Promise<void>;
  getOverview(filters: AnalyticsFilters, options: AdminCallOptions): Promise<AdminOverview>;
  getSummary(filters?: AnalyticsFilters, options?: AdminCallOptions): Promise<AnalyticsSummary>;
  getRegionStats(filters?: AnalyticsFilters, options?: AdminCallOptions): Promise<RegionAggregate[]>;
  listAttempts(params?: ListAttemptsParams, options?: AdminCallOptions): Promise<Paginated<AttemptListItem>>;
  listUsers(filters: AdminFilters & PageParams, options: AdminCallOptions): Promise<Paginated<AdminUserRow>>;
  listResults(filters: AdminFilters & PageParams, options: AdminCallOptions): Promise<Paginated<AdminResultRow>>;
  getResultDetail(attemptId: string, options: AdminCallOptions): Promise<AdminResultDetail>;
  /** Скачивает CSV (UTF-8) с учётом фильтров и поиска. Возвращает файл, а не пишет его на диск сам. */
  exportResultsCsv(filters: AdminFilters, options: AdminCallOptions): Promise<Blob>;
}

export function createAdminService(config: ApiConfig): AdminService {
  if (config.mode === 'demo') {
    // Статистику без сервера взять неоткуда, а выдумывать её нельзя — поэтому честная ошибка.
    const unavailable = (): never => {
      throw new ApiError(
        'NOT_AVAILABLE_IN_DEMO',
        'Административная аналитика доступна только при подключённом серверном API (VITE_API_MODE=api).',
      );
    };
    return {
      enabled: false,
      login: async () => unavailable(),
      logout: async () => unavailable(),
      getOverview: async () => unavailable(),
      getSummary: async () => unavailable(),
      getRegionStats: async () => unavailable(),
      listAttempts: async () => unavailable(),
      listUsers: async () => unavailable(),
      listResults: async () => unavailable(),
      getResultDetail: async () => unavailable(),
      exportResultsCsv: async () => unavailable(),
    };
  }

  const http = createHttpClient(config);
  const get = (path: string, query: object, options?: AdminCallOptions) =>
    http.request(path, { query: query as Record<string, string | number | undefined>, signal: options?.signal, token: options?.token });

  return {
    enabled: true,
    async login(username, password, options) {
      return parseAdminSession(
        await http.request('/admin/login', { method: 'POST', body: { username, password }, signal: options?.signal }),
      );
    },
    async logout(token) {
      await http.request('/admin/logout', { method: 'POST', token });
    },
    async getOverview(filters, options) {
      return parseAdminOverview(await get('/admin/analytics/overview', filters, options));
    },
    async getSummary(filters, options) {
      return parseAnalyticsSummary(await get('/admin/analytics/summary', { ...filters }, options));
    },
    async getRegionStats(filters, options) {
      return parseRegionStats(await get('/admin/analytics/regions', { ...filters }, options));
    },
    async listAttempts(params, options) {
      return parseAttemptList(await get('/admin/attempts', { ...params }, options));
    },
    async listUsers(filters, options) {
      return parseAdminUsers(await get('/admin/users', filters, options));
    },
    async listResults(filters, options) {
      return parseAdminResults(await get('/admin/results', filters, options));
    },
    async getResultDetail(attemptId, options) {
      if (!/^[0-9]{1,18}$/.test(attemptId)) throw new ApiError('INVALID_REQUEST', 'Некорректный номер попытки.');
      return parseAdminResultDetail(await get(`/admin/results/${attemptId}`, {}, options));
    },
    async exportResultsCsv(filters, options) {
      // Файл скачивается обычным fetch с заголовком Authorization (ссылкой <a href> токен не передать).
      if (config.configError || config.baseUrl === null) {
        throw new ApiError('NOT_CONFIGURED', config.configError ?? 'API не настроен.');
      }
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
      const qs = params.toString();
      let response: Response;
      try {
        response = await fetch(`${config.baseUrl}/admin/export/results.csv${qs ? `?${qs}` : ''}`, {
          headers: { Authorization: `Bearer ${options.token ?? ''}`, Accept: 'text/csv' },
          signal: options.signal,
        });
      } catch (cause) {
        throw new ApiError('NETWORK', 'Не удалось связаться с сервером.', undefined, cause);
      }
      if (!response.ok) {
        let body: unknown = null;
        let message = response.statusText;
        try {
          body = await response.json();
          const m = (body as { error?: { message?: unknown } }).error?.message;
          if (typeof m === 'string') message = m;
        } catch {
          /* тело ошибки не JSON */
        }
        throw new ApiError('HTTP', message || `HTTP ${response.status}`, response.status, body);
      }
      return response.blob();
    },
  };
}
