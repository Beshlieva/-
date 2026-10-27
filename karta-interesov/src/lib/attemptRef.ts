/**
 * Ссылка на текущую серверную попытку в localStorage ЭТОГО браузера: только id попытки и владелец.
 *
 * Это НЕ хранилище результатов и ответов: ни ответов, ни баллов, ни таймера здесь нет. Всё это лежит на
 * сервере (MySQL) и запрашивается заново при каждой загрузке страницы. Ссылка нужна лишь затем, чтобы
 * после обновления страницы сразу открыть нужную попытку (в том числе уже завершённую — её результат).
 * Если ссылки нет или она устарела, приложение берёт последнюю незавершённую попытку с сервера.
 */
const KEY = 'karta-interesov:attempt-ref:v1';

interface AttemptRef {
  userId: string;
  attemptId: string;
}

export function loadAttemptRef(userId: string): string | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (typeof d !== 'object' || d === null) return null;
    const r = d as Partial<AttemptRef>;
    if (r.userId !== userId || typeof r.attemptId !== 'string' || !/^[0-9]{1,20}$/.test(r.attemptId)) return null;
    return r.attemptId;
  } catch {
    return null;
  }
}

export function saveAttemptRef(userId: string, attemptId: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ userId, attemptId } satisfies AttemptRef));
  } catch {
    /* без ссылки приложение найдёт незавершённую попытку через GET /attempts/active */
  }
}

export function clearAttemptRef(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
