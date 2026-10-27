import { ApiError } from '../../types';

/** Человекочитаемое описание ошибки для показа пользователю. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'NETWORK':
        return 'Не удалось связаться с сервером. Проверьте подключение к интернету.';
      case 'TIMEOUT':
        return 'Сервер не ответил вовремя. Попробуйте ещё раз.';
      case 'HTTP':
      case 'NOT_FOUND':
        return `Сервер вернул ошибку${err.status ? ` (${err.status})` : ''}${err.message ? `: ${err.message}` : '.'}`;
      case 'INVALID_RESPONSE':
        return 'Сервер вернул данные в неожиданном формате.';
      case 'BATCH_NOT_SUPPORTED':
      case 'NOT_CONFIGURED':
      case 'NOT_AVAILABLE_IN_DEMO':
      case 'INVALID_REQUEST':
        return err.message;
      case 'ABORTED':
        return 'Запрос был отменён.';
    }
  }
  return 'Произошла непредвиденная ошибка.';
}

/** Машинный код ошибки из тела ответа сервера ({ error: { code } }) или null. */
export function serverErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.details;
  if (typeof body !== 'object' || body === null) return null;
  const e = (body as Record<string, unknown>).error;
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

/** Ошибки по полям формы из ответа 422 ({ error: { details: { fields } } }). Пустой объект, если их нет. */
export function serverFieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {};
  const body = err.details;
  if (typeof body !== 'object' || body === null) return {};
  const e = (body as Record<string, unknown>).error;
  if (typeof e !== 'object' || e === null) return {};
  const d = (e as Record<string, unknown>).details;
  if (typeof d !== 'object' || d === null) return {};
  const fields = (d as Record<string, unknown>).fields;
  if (typeof fields !== 'object' || fields === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}
