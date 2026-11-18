import { ApiError } from '../types';
import { getSupabaseClient } from './supabase';

/**
 * Перевод ошибок Supabase в ApiError того же вида, что отдавал PHP API:
 * details = { error: { code, message, details } }. Благодаря этому экраны и AttemptController
 * (serverErrorCode, remainingFromTooEarly, stateFromError) работают без изменений.
 *
 * RPC из supabase/*.sql бросают исключение с MESSAGE = машинный код (TOO_EARLY, ATTEMPT_NOT_FOUND, …)
 * и DETAIL = JSON ({ message, remainingMs, … }). PostgREST возвращает их как { code, message, details, hint }.
 */

/** HTTP-статус, который вернул бы PHP API для этого кода. */
const STATUS_BY_CODE: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  ATTEMPT_NOT_FOUND: 404,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 422,
  EXPORT_TOO_LARGE: 422,
};

/** Сообщения по умолчанию, если сервер не прислал своё. */
const MESSAGE_BY_CODE: Record<string, string> = {
  AUTH_REQUIRED: 'Сессия истекла. Войдите снова.',
  FORBIDDEN: 'Недостаточно прав.',
  ATTEMPT_NOT_FOUND: 'Попытка не найдена.',
  ATTEMPT_COMPLETED: 'Попытка уже завершена.',
  ATTEMPT_NOT_COMPLETED: 'Тест ещё не завершён.',
  ATTEMPT_INCOMPLETE: 'Ответы есть не на все вопросы.',
  NOT_CURRENT_QUESTION: 'Это не текущий вопрос.',
  ANSWER_ALREADY_FIXED: 'Ответ на этот вопрос уже зафиксирован.',
  TOO_EARLY: 'Время на вопрос ещё не истекло.',
  ROUND_MISMATCH: 'Номер круга не совпадает с состоянием попытки.',
  ROUND_NOT_FINISHED: 'Текущий круг ещё не закончен.',
  NO_SKIPPED_QUESTIONS: 'Пропущенных вопросов нет.',
  VALIDATION_ERROR: 'Данные не прошли проверку.',
  NOT_FOUND: 'Не найдено.',
};

function parseJson(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || !text.trim().startsWith('{')) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Ошибка сети (fetch не дошёл до сервера). */
function isNetworkError(message: string): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(message);
}

export function toApiError(err: unknown, fallback = 'Ошибка обращения к базе данных.'): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') return new ApiError('ABORTED', 'Запрос был отменён.');

  const e = (typeof err === 'object' && err !== null ? err : {}) as {
    message?: unknown; details?: unknown; code?: unknown; hint?: unknown; status?: unknown; name?: unknown;
  };
  const rawMessage = typeof e.message === 'string' ? e.message.trim() : '';

  if (isNetworkError(rawMessage)) {
    return new ApiError('NETWORK', 'Нет связи с сервером. Проверьте подключение к интернету.', undefined, err);
  }

  // PostgREST: нет прав на функцию/таблицу, JWT истёк (проверяем раньше машинных кодов: «JWT expired» — не код)
  const pgCode = typeof e.code === 'string' ? e.code : '';
  if (pgCode === '42501' || pgCode === 'PGRST301' || pgCode === 'PGRST302' || /jwt expired|invalid jwt/i.test(rawMessage)) {
    return new ApiError('HTTP', MESSAGE_BY_CODE.AUTH_REQUIRED, 401, { error: { code: 'AUTH_REQUIRED', message: rawMessage } });
  }
  if (pgCode === 'PGRST202') {
    return new ApiError(
      'NOT_CONFIGURED',
      'В базе данных нет нужной функции. Выполните SQL-скрипты из папки supabase/ (см. supabase/README.md).',
      undefined,
      { error: { code: 'FUNCTION_NOT_FOUND', message: rawMessage } },
    );
  }

  // Машинный код из RAISE EXCEPTION: всё сообщение целиком — код (MESSAGE = 'TOO_EARLY')
  const codeMatch = /^([A-Z][A-Z0-9_]{2,})$/.exec(rawMessage);
  if (codeMatch) {
    const code = codeMatch[1];
    const extra = parseJson(e.details) ?? {};
    const message = typeof extra.message === 'string' && extra.message ? extra.message : MESSAGE_BY_CODE[code] ?? rawMessage;
    const details: Record<string, unknown> = { ...extra };
    const status = STATUS_BY_CODE[code] ?? 409;
    return new ApiError(status === 404 ? 'NOT_FOUND' : 'HTTP', message, status, { error: { code, message, details } });
  }

  const status = typeof e.status === 'number' ? e.status : undefined;
  return new ApiError('HTTP', rawMessage || fallback, status, { error: { code: pgCode || 'UNKNOWN', message: rawMessage } });
}

/** Вызов RPC с переводом ошибок. Поддерживает отмену через AbortSignal. */
export async function callRpc<T>(fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const client = getSupabaseClient();
  let builder = client.rpc(fn as never, args as never);
  if (signal) builder = builder.abortSignal(signal);
  let response: { data: unknown; error: unknown };
  try {
    response = await builder;
  } catch (err) {
    throw toApiError(err);
  }
  if (signal?.aborted) throw new ApiError('ABORTED', 'Запрос был отменён.');
  if (response.error) throw toApiError(response.error);
  return response.data as T;
}

/** id текущего пользователя по локальной сессии Supabase (без сетевого запроса). 401, если не вошёл. */
export async function requireUserId(): Promise<string> {
  const client = getSupabaseClient();
  const { data } = await client.auth.getSession();
  const id = data.session?.user?.id;
  if (!id) {
    throw new ApiError('HTTP', MESSAGE_BY_CODE.AUTH_REQUIRED, 401, { error: { code: 'AUTH_REQUIRED' } });
  }
  return id;
}
