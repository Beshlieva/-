import { ApiError } from '../types';
import type { AdminFilters, AnalyticsFilters, Paginated, AttemptListItem } from '../types';
import type { AdminService } from '../services/api/adminService';
import {
  parseAdminOverview,
  parseAdminResultDetail,
  parseAdminResults,
  parseAdminUsers,
  parseAnalyticsSummary,
  parseRegionStats,
} from '../services/api/validators';
import { getSupabaseClient } from './supabase';
import { callRpc, toApiError } from './supabaseErrors';

/**
 * Панель администратора на Supabase (RPC из supabase/admin.sql).
 * Администратор — пользователь Supabase Auth с profiles.role = 'admin'; вход — по email и паролю.
 * Права проверяет база (public.is_admin() внутри каждой функции), а не интерфейс.
 */

/** Сколько живёт вход в панель в этой вкладке (как ADMIN_TOKEN_TTL_MINUTES у PHP API). */
const ADMIN_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function filterArgs(f: AnalyticsFilters = {}) {
  return {
    p_region_code: f.regionCode || null,
    p_date_from: f.dateFrom && DATE_RE.test(f.dateFrom) ? f.dateFrom : null,
    p_date_to: f.dateTo && DATE_RE.test(f.dateTo) ? f.dateTo : null,
  };
}

function searchArg(q?: string): string | null {
  const v = (q ?? '').trim().slice(0, 100);
  return v || null;
}

/** Ячейка CSV: кавычки, защита от формул Excel (как в PHP AdminController::csvLine). */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (s !== '' && '=+-@\t\r'.includes(s[0])) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

interface ExportData {
  rows: {
    attemptId: string; completedAt: string; name: string | null; email: string | null; age: number | null;
    region: string | null; answeredCount: number; scores: Record<string, number>; top: number[];
  }[];
  categories: { id: number; name: string }[];
}

export function createSupabaseAdminService(): AdminService {
  return {
    enabled: true,

    async login(email, password) {
      const client = getSupabaseClient();
      let result;
      try {
        result = await client.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      } catch (err) {
        throw toApiError(err);
      }
      if (result.error) {
        const status = result.error.status === 429 ? 429 : 401;
        const message = status === 429
          ? 'Слишком много попыток входа. Подождите несколько минут.'
          : /not confirmed/i.test(result.error.message)
            ? 'Email не подтверждён.'
            : 'Неверный email или пароль.';
        throw new ApiError('HTTP', message, status, { error: { code: 'INVALID_CREDENTIALS', message } });
      }
      const session = result.data.session;
      if (!session) throw new ApiError('HTTP', 'Не удалось войти.', 401);

      const isAdmin = await callRpc<boolean>('is_admin', {});
      if (!isAdmin) {
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        throw new ApiError('HTTP', 'У этой учётной записи нет прав администратора.', 401, { error: { code: 'FORBIDDEN' } });
      }
      return { token: session.access_token, expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_MS).toISOString() };
    },

    async logout() {
      await getSupabaseClient().auth.signOut({ scope: 'local' });
    },

    async getOverview(filters, options) {
      return parseAdminOverview(await callRpc('admin_overview', filterArgs(filters), options?.signal));
    },

    async getSummary(filters, options) {
      return parseAnalyticsSummary(await callRpc('admin_summary', filterArgs(filters), options?.signal));
    },

    async getRegionStats(filters, options) {
      return parseRegionStats(await callRpc('admin_region_stats', filterArgs(filters), options?.signal));
    },

    async listAttempts(params = {}, options): Promise<Paginated<AttemptListItem>> {
      const data = parseAdminResults(await callRpc('admin_results', {
        ...filterArgs(params), p_q: null, p_page: params.page ?? 1, p_page_size: params.pageSize ?? 20,
      }, options?.signal));
      return {
        ...data,
        items: data.items.map(r => ({
          attemptId: r.attemptId, completedAt: r.completedAt, regionCode: r.regionCode ?? undefined,
          answeredCount: r.answeredCount, topCategoryIds: r.topCategoryIds,
        })),
      };
    },

    async listUsers(filters, options) {
      return parseAdminUsers(await callRpc('admin_users', {
        ...filterArgs(filters), p_q: searchArg(filters.q), p_page: filters.page ?? 1, p_page_size: filters.pageSize ?? 20,
      }, options?.signal));
    },

    async listResults(filters, options) {
      return parseAdminResults(await callRpc('admin_results', {
        ...filterArgs(filters), p_q: searchArg(filters.q), p_page: filters.page ?? 1, p_page_size: filters.pageSize ?? 20,
      }, options?.signal));
    },

    async getResultDetail(attemptId, options) {
      if (!/^[0-9]{1,15}$/.test(attemptId)) throw new ApiError('INVALID_REQUEST', 'Некорректный номер попытки.');
      return parseAdminResultDetail(await callRpc('admin_result_detail', { p_attempt_id: Number(attemptId) }, options?.signal));
    },

    async exportResultsCsv(filters: AdminFilters, options) {
      const data = await callRpc<ExportData>('admin_export_rows', {
        ...filterArgs(filters), p_q: searchArg(filters.q),
      }, options?.signal);
      const names = new Map(data.categories.map(c => [c.id, c.name]));
      const header = ['ID попытки', 'Дата завершения (UTC)', 'Имя', 'Email', 'Возраст', 'Регион', 'Отвечено вопросов'];
      for (const c of data.categories) header.push(`${c.name} (баллы 0–100)`);
      for (let i = 1; i <= 5; i++) header.push(`Направление №${i}`);

      const lines = [header.map(csvCell).join(';')];
      for (const row of data.rows) {
        const line: unknown[] = [
          row.attemptId, new Date(row.completedAt).toISOString(), row.name ?? '', row.email ?? '',
          row.age ?? '', row.region ?? '', row.answeredCount,
        ];
        for (const c of data.categories) line.push(row.scores[String(c.id)] ?? '');
        for (let i = 0; i < 5; i++) line.push(row.top[i] !== undefined ? names.get(row.top[i]) ?? '' : '');
        lines.push(line.map(csvCell).join(';'));
      }
      // UTF-8 с BOM и разделителем «;» — так файл корректно открывается в Excel с русской локалью
      return new Blob(['﻿', lines.join('\r\n'), '\r\n'], { type: 'text/csv;charset=utf-8' });
    },
  };
}
