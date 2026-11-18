import { ApiError, TEST_VERSION } from '../types';
import type { AttemptService, StepOutcome } from '../services/api/attemptService';
import { serverErrorCode } from '../services/api/errors';
import { parseAttemptState, parseTestResult, parseUserResultHistory } from '../services/api/validators';
import { callRpc as defaultRpc, requireUserId as defaultRequireUserId } from './supabaseErrors';

/**
 * Серверное прохождение теста через RPC Supabase (supabase/rpc_attempts.sql).
 * Реализует тот же интерфейс AttemptService, что и клиент PHP API, поэтому AttemptController и экраны
 * работают одинаково. Токен из аргументов не нужен: supabase-js сам подставляет JWT текущей сессии.
 *
 * Ответы сервера проверяются теми же валидаторами (parseAttemptState и др.), что и ответы PHP API.
 */

type Envelope = { state?: unknown; result?: unknown; outcome?: unknown } | null;

const HISTORY_PAGE_SIZE = 10;

function stateOf(data: Envelope) {
  if (!data || typeof data !== 'object' || data.state === undefined) {
    throw new ApiError('INVALID_RESPONSE', 'Некорректный ответ сервера: нет состояния попытки.');
  }
  return parseAttemptState(data.state);
}

function resultOf(data: Envelope) {
  if (!data || typeof data !== 'object' || data.result === undefined) {
    throw new ApiError('INVALID_RESPONSE', 'Некорректный ответ сервера: нет результата.');
  }
  return parseTestResult(data.result);
}

/** Ответ на answer/skip → StepOutcome, как у PHP-клиента (expired ⇔ 409 TIME_EXPIRED). */
function stepOf(data: Envelope): StepOutcome {
  const state = stateOf(data);
  const outcome = data?.outcome;
  if (outcome === 'expired') return { kind: 'expired', state };
  return { kind: 'ok', state, duplicate: outcome === 'duplicate' };
}

function attemptIdArg(attemptId: string): number {
  if (!/^[0-9]{1,15}$/.test(attemptId)) throw new ApiError('INVALID_REQUEST', 'Некорректный номер попытки.');
  return Number(attemptId);
}

type Rpc = <T>(fn: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;

/** rpc и userId подменяются в тестах (src/lib/supabaseContract.test.ts). */
export function createSupabaseAttemptService(
  callRpc: Rpc = defaultRpc,
  requireUserId: () => Promise<string> = defaultRequireUserId,
): AttemptService {
  return {
  enabled: true,

  async start(_token, clientAttemptId, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_create', {
      p_user_id: userId,
      p_client_attempt_id: clientAttemptId,
      p_test_version: TEST_VERSION,
      p_region_code: null,
    }, options?.signal);
    return stateOf(data);
  },

  async active(_token, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_active_state', { p_user_id: userId }, options?.signal);
    return data ? stateOf(data) : null;
  },

  async get(_token, attemptId, options) {
    const userId = await requireUserId();
    try {
      const data = await callRpc<Envelope>('attempt_state', {
        p_user_id: userId,
        p_attempt_id: attemptIdArg(attemptId),
      }, options?.signal);
      return stateOf(data);
    } catch (err) {
      if (serverErrorCode(err) === 'ATTEMPT_NOT_FOUND') return null;
      throw err;
    }
  },

  async answer(_token, attemptId, questionId, value, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_answer', {
      p_user_id: userId,
      p_attempt_id: attemptIdArg(attemptId),
      p_question_id: questionId,
      p_value: value,
    }, options?.signal);
    return stepOf(data);
  },

  async skip(_token, attemptId, questionId, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_skip', {
      p_user_id: userId,
      p_attempt_id: attemptIdArg(attemptId),
      p_question_id: questionId,
    }, options?.signal);
    return stepOf(data);
  },

  async retryRound(_token, attemptId, fromRound, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_retry_round', {
      p_user_id: userId,
      p_attempt_id: attemptIdArg(attemptId),
      p_from_round: fromRound,
    }, options?.signal);
    return stateOf(data);
  },

  async finish(_token, attemptId, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_finish', {
      p_user_id: userId,
      p_attempt_id: attemptIdArg(attemptId),
    }, options?.signal);
    return resultOf(data);
  },

  async result(_token, attemptId, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_result', {
      p_user_id: userId,
      p_attempt_id: attemptIdArg(attemptId),
    }, options?.signal);
    return resultOf(data);
  },

  async latestResult(_token, options) {
    const userId = await requireUserId();
    const data = await callRpc<Envelope>('attempt_latest_completed_result', { p_user_id: userId }, options?.signal);
    return data ? resultOf(data) : null;
  },

  async resultsHistory(_token, page, options) {
    const userId = await requireUserId();
    const data = await callRpc<unknown>('attempt_completed_results', {
      p_user_id: userId,
      p_page: Math.max(1, Math.trunc(page) || 1),
      p_page_size: HISTORY_PAGE_SIZE,
    }, options?.signal);
    return parseUserResultHistory(data);
  },
  };
}

export const attemptService = createSupabaseAttemptService();

export default attemptService;
