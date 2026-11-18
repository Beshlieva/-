/**
 * Контракт «SQL в Supabase ↔ frontend».
 * Фикстура __fixtures__/supabase-rpc-samples.json — настоящие ответы функций из supabase/*.sql,
 * полученные прогоном скриптов на Postgres. Здесь проверяется, что frontend их принимает
 * и что ошибки RPC превращаются в коды, на которые рассчитаны экраны и AttemptController.
 *
 * Запуск: npm test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiError } from '../types';
import { remainingFromTooEarly } from '../services/api/attemptService';
import { serverErrorCode } from '../services/api/errors';
import {
  parseAdminOverview, parseAdminResultDetail, parseAdminResults, parseAdminUsers, parseAnalyticsSummary, parseRegionStats,
} from '../services/api/validators';
import { createSupabaseAttemptService } from './attemptService';
import { toApiError } from './supabaseErrors';

const samples = JSON.parse(readFileSync(new URL('./__fixtures__/supabase-rpc-samples.json', import.meta.url), 'utf8'));

/** Сервис попыток с подменённым RPC: возвращает заданный ответ или бросает ошибку как PostgREST. */
function serviceReturning(data: unknown, calls: { fn: string; args: Record<string, unknown> }[] = []) {
  return createSupabaseAttemptService(
    async <T>(fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (data instanceof Error || (typeof data === 'object' && data !== null && 'pgError' in data)) {
        throw toApiError((data as { pgError: unknown }).pgError ?? data);
      }
      return data as T;
    },
    async () => 'user-1',
  );
}

describe('attemptService (Supabase) принимает ответы SQL', () => {
  it('start → состояние попытки с первым вопросом', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const state = await serviceReturning(samples.createEnvelope, calls).start('', 'client-attempt-1');
    assert.equal(state.status, 'in_progress');
    assert.equal(state.currentQuestion?.questionId, 1);
    assert.equal(state.totalQuestions, 174);
    assert.equal(calls[0].fn, 'attempt_create');
    assert.equal(calls[0].args.p_user_id, 'user-1');
  });

  it('answer с outcome=expired → kind "expired" (раньше kind не было вовсе)', async () => {
    const out = await serviceReturning(samples.expiredEnvelope).answer('', '2', 2, 2);
    assert.equal(out.kind, 'expired');
    assert.ok(out.state.skippedQuestionIds.includes(2));
  });

  it('answer с outcome=accepted/duplicate → kind "ok"', async () => {
    const accepted = await serviceReturning({ ...samples.expiredEnvelope, outcome: 'accepted' }).answer('', '2', 2, 2);
    assert.deepEqual([accepted.kind, accepted.kind === 'ok' && accepted.duplicate], ['ok', false]);
    const dup = await serviceReturning({ ...samples.expiredEnvelope, outcome: 'duplicate' }).answer('', '2', 2, 2);
    assert.deepEqual([dup.kind, dup.kind === 'ok' && dup.duplicate], ['ok', true]);
  });

  it('retryRound → круг 2 с прогрессом по пропущенным', async () => {
    const state = await serviceReturning(samples.retryEnvelope).retryRound('', '2', 1);
    assert.equal(state.round, 2);
    assert.deepEqual(state.roundProgress, { position: 1, size: 3 });
  });

  it('finish → результат по всем 29 направлениям', async () => {
    const result = await serviceReturning(samples.finishEnvelope).finish('', '2');
    assert.equal(result.scores.length, 29);
    assert.equal(result.answeredCount, 174);
    assert.equal(result.source, 'server');
  });

  it('история результатов', async () => {
    const page = await serviceReturning(samples.history).resultsHistory('', 1);
    assert.equal(page.total, 1);
    assert.equal(page.items[0].topCategoryIds.length, 5);
  });

  it('нет активной попытки / результата → null', async () => {
    assert.equal(await serviceReturning(null).active(''), null);
    assert.equal(await serviceReturning(null).latestResult(''), null);
  });

  it('get для чужой/удалённой попытки → null', async () => {
    const state = await serviceReturning({ pgError: { code: 'P0001', message: 'ATTEMPT_NOT_FOUND', details: '{"message":"Попытка не найдена."}' } })
      .get('', '5');
    assert.equal(state, null);
  });
});

describe('toApiError: ошибки RPC → коды приложения', () => {
  it('TOO_EARLY с remainingMs (нужно AttemptController для повторного пропуска)', () => {
    const err = toApiError({ code: 'P0001', message: samples.tooEarly.message, details: samples.tooEarly.detail });
    assert.equal(serverErrorCode(err), 'TOO_EARLY');
    const remaining = remainingFromTooEarly(err);
    assert.ok(remaining !== null && remaining > 13000 && remaining <= 15000);
  });

  it('AUTH_REQUIRED → статус 401 (приложение вернёт ко входу)', () => {
    const err = toApiError({ code: 'P0001', message: 'AUTH_REQUIRED', details: null });
    assert.equal(err.status, 401);
  });

  it('нет прав на функцию / истёкший JWT → 401', () => {
    assert.equal(toApiError({ code: '42501', message: 'permission denied for function attempt_state' }).status, 401);
    assert.equal(toApiError({ code: 'PGRST301', message: 'JWT expired' }).status, 401);
  });

  it('NOT_CURRENT_QUESTION → код для пересинхронизации, сообщение по-русски', () => {
    const err = toApiError({ code: 'P0001', message: 'NOT_CURRENT_QUESTION', details: '{"message":"Это не текущий вопрос."}' });
    assert.equal(serverErrorCode(err), 'NOT_CURRENT_QUESTION');
    assert.equal(err.message, 'Это не текущий вопрос.');
  });

  it('функция не найдена → подсказка выполнить SQL-скрипты', () => {
    const err = toApiError({ code: 'PGRST202', message: 'Could not find the function public.attempt_create' });
    assert.equal(err.code, 'NOT_CONFIGURED');
    assert.match(err.message, /supabase/);
  });

  it('сетевая ошибка → NETWORK', () => {
    const err = toApiError(new TypeError('Failed to fetch'));
    assert.ok(err instanceof ApiError);
    assert.equal(err.code, 'NETWORK');
  });
});

describe('админ-аналитика: ответы SQL проходят валидаторы панели', () => {
  it('overview, summary, regions, users, results, detail', () => {
    assert.equal(parseAdminOverview(samples.admin_overview).completedAttempts, 1);
    assert.equal(parseAnalyticsSummary(samples.admin_summary).categories.length, 29);
    assert.equal(parseRegionStats(samples.admin_region_stats)[0].regionCode, 'almaty-city');
    assert.equal(parseAdminUsers(samples.admin_users).items[0].completedAttempts, 1);
    assert.equal(parseAdminResults(samples.admin_results).items[0].topCategoryIds.length, 5);
    assert.equal(parseAdminResultDetail(samples.admin_result_detail).scores[0].rank, 1);
  });
});
