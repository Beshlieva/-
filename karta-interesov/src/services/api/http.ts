import { ApiError } from '../../types';
import type { ApiConfig } from './config';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Позволяет приложению отменить запрос (например, при уходе с экрана). */
  signal?: AbortSignal;
  /** Токен доступа пользователя: уходит в заголовке Authorization: Bearer … */
  token?: string;
}

export interface HttpClient {
  /** Возвращает разобранный JSON (или null для пустого ответа). Формат проверяет вызывающий код. */
  request(path: string, options?: RequestOptions): Promise<unknown>;
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  let url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return url;
}

function extractServerMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null) {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
  }
  return typeof b.message === 'string' ? b.message : null;
}

export function createHttpClient(config: ApiConfig): HttpClient {
  return {
    async request(path, options = {}) {
      if (config.configError || config.baseUrl === null) {
        throw new ApiError('NOT_CONFIGURED', config.configError ?? 'API не настроен.');
      }

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.timeoutMs);

      const external = options.signal;
      const onExternalAbort = () => controller.abort();
      if (external) {
        if (external.aborted) controller.abort();
        else external.addEventListener('abort', onExternalAbort, { once: true });
      }

      const hasBody = options.body !== undefined;
      let response: Response;
      try {
        response = await fetch(buildUrl(config.baseUrl, path, options.query), {
          method: options.method ?? 'GET',
          headers: {
            Accept: 'application/json',
            ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
            ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          },
          body: hasBody ? JSON.stringify(options.body) : undefined,
          // Для авторизации администратора по cookie на другом домене позднее понадобится 'include'
          // (и соответствующая настройка CORS на сервере).
          credentials: 'same-origin',
          signal: controller.signal,
        });
      } catch (cause) {
        if (timedOut) throw new ApiError('TIMEOUT', 'Сервер не ответил вовремя.', undefined, cause);
        if (external?.aborted) throw new ApiError('ABORTED', 'Запрос отменён.', undefined, cause);
        throw new ApiError('NETWORK', 'Не удалось связаться с сервером.', undefined, cause);
      } finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', onExternalAbort);
      }

      const text = await response.text();
      let parsed: unknown = null;
      if (text.trim() !== '') {
        try {
          parsed = JSON.parse(text);
        } catch (cause) {
          if (response.ok) {
            throw new ApiError('INVALID_RESPONSE', 'Сервер вернул не JSON.', response.status, cause);
          }
          // у ответа с ошибкой тело может быть не JSON (например, HTML от прокси) — это не важно
        }
      }

      if (!response.ok) {
        const message = extractServerMessage(parsed) ?? response.statusText;
        const code = response.status === 404 ? 'NOT_FOUND' : 'HTTP';
        throw new ApiError(code, message || `HTTP ${response.status}`, response.status, parsed);
      }
      return parsed;
    },
  };
}
