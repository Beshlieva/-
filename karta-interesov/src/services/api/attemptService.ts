import { ApiError } from '../../types';
import type { ServerAttemptState, TestResult } from '../../types';
import type { ApiConfig } from './config';
import { serverErrorCode } from './errors';
import { createHttpClient } from './http';
import { parseAttemptState, parseTestResult } from './validators';

export interface AttemptCallOptions {
  signal?: AbortSignal;
}

/** Итог отправки ответа или пропуска. */
export type StepOutcome =
  | { kind: 'ok'; state: ServerAttemptState; duplicate: boolean }
  /** Сервер отклонил ответ как просроченный и сам пометил вопрос пропущенным (409 TIME_EXPIRED). */
  | { kind: 'expired'; state: ServerAttemptState };

/**
 * Прохождение теста по серверным методам (docs/API_V2.md): создание попытки, ответы по одному,
 * пропуски, повторный круг, завершение. Время каждого вопроса контролирует сервер.
 * Все методы требуют токен пользователя.
 */
export interface AttemptService {
  /** Доступно ли серверное прохождение (в демо-режиме нет). */
  readonly enabled: boolean;
  /** POST /attempts — идемпотентно по clientAttemptId; первый вопрос открывается сразу. */
  start(token: string, clientAttemptId: string, options?: AttemptCallOptions): Promise<ServerAttemptState>;
  /** GET /attempts/active — последняя незавершённая попытка; null, если её нет. */
  active(token: string, options?: AttemptCallOptions): Promise<ServerAttemptState | null>;
  /** GET /attempts/{id} — состояние (null, если попытка не найдена). */
  get(token: string, attemptId: string, options?: AttemptCallOptions): Promise<ServerAttemptState | null>;
  /** POST /attempts/{id}/answers */
  answer(token: string, attemptId: string, questionId: number, value: number, options?: AttemptCallOptions): Promise<StepOutcome>;
  /** POST /attempts/{id}/skips — сервер принимает пропуск, только когда время вопроса вышло. */
  skip(token: string, attemptId: string, questionId: number, options?: AttemptCallOptions): Promise<StepOutcome>;
  /** POST /attempts/{id}/retry-round */
  retryRound(token: string, attemptId: string, fromRound: number, options?: AttemptCallOptions): Promise<ServerAttemptState>;
  /** POST /attempts/{id}/finish — идемпотентно: повтор возвращает тот же сохранённый результат. */
  finish(token: string, attemptId: string, options?: AttemptCallOptions): Promise<TestResult>;
  /** GET /attempts/{id}/result */
  result(token: string, attemptId: string, options?: AttemptCallOptions): Promise<TestResult>;
}

/** Тело ошибки сервера → поле error.details (или null). */
function errorDetails(err: ApiError): Record<string, unknown> | null {
  const body = err.details;
  if (typeof body !== 'object' || body === null) return null;
  const e = (body as Record<string, unknown>).error;
  if (typeof e !== 'object' || e === null) return null;
  const d = (e as Record<string, unknown>).details;
  return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : null;
}

/** Если сервер прислал актуальное состояние в details.state (TIME_EXPIRED), достаём его. */
export function stateFromError(err: unknown): ServerAttemptState | null {
  if (!(err instanceof ApiError)) return null;
  const d = errorDetails(err);
  if (!d || d.state === undefined) return null;
  try {
    return parseAttemptState(d.state);
  } catch {
    return null;
  }
}

/** Миллисекунды до возможного пропуска из ответа TOO_EARLY (details.remainingMs) или null. */
export function remainingFromTooEarly(err: unknown): number | null {
  if (!(err instanceof ApiError) || serverErrorCode(err) !== 'TOO_EARLY') return null;
  const v = errorDetails(err)?.remainingMs;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null;
}

export function createAttemptService(config: ApiConfig): AttemptService {
  if (config.mode === 'demo') {
    const unavailable = () =>
      Promise.reject(new ApiError('NOT_AVAILABLE_IN_DEMO', 'Серверное прохождение доступно только при VITE_API_MODE=api.'));
    return {
      enabled: false,
      start: unavailable, active: unavailable, get: unavailable, answer: unavailable,
      skip: unavailable, retryRound: unavailable, finish: unavailable, result: unavailable,
    };
  }

  const http = createHttpClient(config);
  const path = (id: string, tail = '') => `/attempts/${encodeURIComponent(id)}${tail}`;

  /** Ответ на answers/skips: 200 → состояние, 409 TIME_EXPIRED → «просрочено» с состоянием сервера. */
  async function step(
    attemptId: string, tail: string, body: unknown, token: string, signal?: AbortSignal,
  ): Promise<StepOutcome> {
    try {
      const data = await http.request(path(attemptId, tail), { method: 'POST', body, token, signal });
      const duplicate = typeof data === 'object' && data !== null && (data as Record<string, unknown>).duplicate === true;
      return { kind: 'ok', state: parseAttemptState(data), duplicate };
    } catch (err) {
      if (serverErrorCode(err) === 'TIME_EXPIRED') {
        const state = stateFromError(err);
        if (state) return { kind: 'expired', state };
      }
      throw err;
    }
  }

  return {
    enabled: true,
    async start(token, clientAttemptId, options) {
      // Тело — только clientAttemptId и версия теста. Массив answers не отправляется никогда:
      // сервер отвечает на него BATCH_SUBMIT_NOT_SUPPORTED.
      const data = await http.request('/attempts', {
        method: 'POST', body: { clientAttemptId }, token, signal: options?.signal,
      });
      return parseAttemptState(data);
    },
    async active(token, options) {
      try {
        return parseAttemptState(await http.request('/attempts/active', { token, signal: options?.signal }));
      } catch (err) {
        if (serverErrorCode(err) === 'NO_ACTIVE_ATTEMPT') return null;
        throw err;
      }
    },
    async get(token, attemptId, options) {
      try {
        return parseAttemptState(await http.request(path(attemptId), { token, signal: options?.signal }));
      } catch (err) {
        if (serverErrorCode(err) === 'ATTEMPT_NOT_FOUND') return null;
        throw err;
      }
    },
    answer(token, attemptId, questionId, value, options) {
      return step(attemptId, '/answers', { questionId, value }, token, options?.signal);
    },
    skip(token, attemptId, questionId, options) {
      return step(attemptId, '/skips', { questionId }, token, options?.signal);
    },
    async retryRound(token, attemptId, fromRound, options) {
      const data = await http.request(path(attemptId, '/retry-round'), {
        method: 'POST', body: { fromRound }, token, signal: options?.signal,
      });
      return parseAttemptState(data);
    },
    async finish(token, attemptId, options) {
      const data = await http.request(path(attemptId, '/finish'), { method: 'POST', body: {}, token, signal: options?.signal });
      return parseTestResult(data);
    },
    async result(token, attemptId, options) {
      return parseTestResult(await http.request(path(attemptId, '/result'), { token, signal: options?.signal }));
    },
  };
}
