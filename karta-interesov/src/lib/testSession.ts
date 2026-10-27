import { QUESTIONS } from '../data/questions';
import type { AnswersMap } from '../types';

/**
 * Движок прохождения теста: чистые функции без React и без обращения к часам.
 * Время (`now`, мс с 1970 г.) всегда передаётся снаружи — поэтому логику можно проверить
 * без браузера (см. scripts/verify.ts), а таймер не зависит от частоты перерисовки.
 *
 * Модель:
 *  - тест состоит из «кругов». Круг 1 — все 174 вопроса по порядку; следующие круги —
 *    только те вопросы, на которые ещё нет ответа;
 *  - на каждый вопрос даётся QUESTION_TIME_MS. Момент окончания (`deadline`) фиксируется
 *    в момент открытия вопроса и сохраняется вместе с сессией, поэтому обновление страницы
 *    время не сбрасывает;
 *  - пропуск — это ОТСУТСТВИЕ ответа в `answers`. Он не превращается в 0 и в расчёт не попадает.
 */

/** Время на один вопрос, мс. */
export const QUESTION_TIME_MS = 15_000;
/** Остаток времени, с которого таймер становится красным, мс. */
export const WARNING_THRESHOLD_MS = 5_000;
/**
 * Защита от случайного двойного нажатия: ответ в первые мс после открытия вопроса игнорируется,
 * иначе второй клик по «старой» кнопке засчитывался бы как ответ на следующий вопрос.
 */
export const MIN_ANSWER_DELAY_MS = 250;

const VALID_VALUES: ReadonlySet<number> = new Set([-2, -1, 0, 1, 2]);
const ALL_IDS: readonly number[] = QUESTIONS.map(q => q.id);
const ALL_ID_SET: ReadonlySet<number> = new Set(ALL_IDS);

export interface TestSession {
  /** Номер круга: 1 — основной, 2 и далее — повторное прохождение пропусков. */
  round: number;
  /** Ответы: id вопроса → значение −2…+2. Отсутствие ключа = нет ответа. */
  answers: AnswersMap;
  /** Вопросы текущего круга в порядке показа. */
  queue: number[];
  /** Индекс текущего вопроса в queue. position === queue.length — круг закончен. */
  position: number;
  /** Момент окончания времени на текущий вопрос (мс, epoch). null — круг закончен. */
  deadline: number | null;
  /** Вопрос, время на который только что истекло (для подсказки на экране); сбрасывается ответом. */
  lastExpiredId: number | null;
}

export function totalQuestions(): number {
  return ALL_IDS.length;
}

/** Текущий вопрос или null, если круг закончен. */
export function currentQuestionId(s: TestSession): number | null {
  return s.position < s.queue.length ? s.queue[s.position] : null;
}

export function isRoundFinished(s: TestSession): boolean {
  return s.position >= s.queue.length;
}

/** Вопросы без ответа, по возрастанию id. */
export function unansweredIds(answers: AnswersMap): number[] {
  return ALL_IDS.filter(id => answers[id] === undefined);
}

export function answeredCount(answers: AnswersMap): number {
  return ALL_IDS.length - unansweredIds(answers).length;
}

/** Все ли обязательные вопросы (все 174) имеют ответ — условие показа результата. */
export function isComplete(answers: AnswersMap): boolean {
  return unansweredIds(answers).length === 0;
}

/**
 * Сколько вопросов уже были показаны, но остались без ответа.
 * В основном круге ещё не показанные вопросы пропущенными не считаются.
 */
export function skippedCount(s: TestSession): number {
  if (s.round === 1) {
    return s.queue.slice(0, s.position).filter(id => s.answers[id] === undefined).length;
  }
  return unansweredIds(s.answers).length;
}

/** Оставшееся время на текущий вопрос, мс. Ограничено [0; QUESTION_TIME_MS] — перевод часов назад время не продлевает. */
export function remainingMs(s: TestSession, now: number): number {
  return remainingUntil(s.deadline, now);
}

/** Остаток до момента `deadline` (мс), ограничен [0; QUESTION_TIME_MS]. Общая функция для локального и серверного режимов. */
export function remainingUntil(deadline: number | null, now: number): number {
  if (deadline === null) return 0;
  return Math.min(QUESTION_TIME_MS, Math.max(0, deadline - now));
}

export function createSession(now: number): TestSession {
  return {
    round: 1,
    answers: {},
    queue: [...ALL_IDS],
    position: 0,
    deadline: now + QUESTION_TIME_MS,
    lastExpiredId: null,
  };
}

/** Переход к следующему вопросу круга. Новый вопрос получает собственный deadline. */
function advance(s: TestSession, now: number, patch: Partial<TestSession>): TestSession {
  const position = s.position + 1;
  const finished = position >= s.queue.length;
  return {
    ...s,
    ...patch,
    position,
    deadline: finished ? null : now + QUESTION_TIME_MS,
  };
}

/**
 * Записать ответ на текущий вопрос. Возвращает ТУ ЖЕ сессию (по ссылке), если действие недопустимо:
 *  - вопрос не текущий (устаревший клик, повторное нажатие — второй ответ на тот же вопрос невозможен);
 *  - круг закончен;
 *  - время вышло (такой вопрос пропускается функцией expireQuestion, а не получает ответ «задним числом»);
 *  - слишком рано после открытия вопроса (защита от двойного нажатия);
 *  - недопустимое значение.
 */
export function answerQuestion(s: TestSession, questionId: number, value: number, now: number): TestSession {
  const current = currentQuestionId(s);
  if (current === null || current !== questionId || s.deadline === null) return s;
  if (!VALID_VALUES.has(value)) return s;
  if (now >= s.deadline) return s;
  const openedAt = s.deadline - QUESTION_TIME_MS;
  if (now >= openedAt && now - openedAt < MIN_ANSWER_DELAY_MS) return s;
  return advance(s, now, {
    answers: { ...s.answers, [questionId]: value },
    lastExpiredId: null,
  });
}

/**
 * Пометить текущий вопрос пропущенным. Срабатывает только если время действительно вышло
 * (now >= deadline) и вопрос всё ещё текущий — поэтому повторные таймеры и «опоздавшие» вызовы
 * не могут перепрыгнуть через вопрос. Ответ в answers НЕ записывается (пропуск ≠ 0).
 */
export function expireQuestion(s: TestSession, questionId: number, now: number): TestSession {
  const current = currentQuestionId(s);
  if (current === null || current !== questionId || s.deadline === null) return s;
  if (now < s.deadline) return s;
  return advance(s, now, { lastExpiredId: questionId });
}

/**
 * Начать повторный круг только по пропущенным вопросам.
 * Допустимо лишь когда текущий круг закончен и пропуски есть; иначе сессия не меняется.
 */
export function startRetryRound(s: TestSession, now: number): TestSession {
  if (!isRoundFinished(s)) return s;
  const queue = unansweredIds(s.answers);
  if (queue.length === 0) return s;
  return {
    ...s,
    round: s.round + 1,
    queue,
    position: 0,
    deadline: now + QUESTION_TIME_MS,
    lastExpiredId: null,
  };
}

/**
 * Применить к восстановленной сессии время, прошедшее, пока страница была закрыта:
 * если deadline уже прошёл — вопрос считается пропущенным (ровно один вопрос за загрузку,
 * следующий получает свои 15 секунд с момента открытия). Многократное обновление страницы
 * время текущего вопроса не продлевает.
 */
export function reconcileOnLoad(s: TestSession, now: number): TestSession {
  const id = currentQuestionId(s);
  if (id === null || s.deadline === null) return s;
  // Если системные часы переведены назад, deadline оказывается дальше, чем возможно, — ограничиваем.
  const capped = s.deadline - now > QUESTION_TIME_MS ? { ...s, deadline: now + QUESTION_TIME_MS } : s;
  return expireQuestion(capped, id, now);
}

/** Проверка структуры восстановленной сессии (данные из localStorage недоверенные). */
export function parseSession(raw: unknown): TestSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;

  if (!Number.isInteger(d.round) || (d.round as number) < 1) return null;
  if (!Number.isInteger(d.position) || (d.position as number) < 0) return null;
  if (typeof d.answers !== 'object' || d.answers === null || Array.isArray(d.answers)) return null;
  if (!Array.isArray(d.queue)) return null;

  const answers: AnswersMap = {};
  for (const [k, v] of Object.entries(d.answers as Record<string, unknown>)) {
    const id = Number(k);
    if (!ALL_ID_SET.has(id) || typeof v !== 'number' || !VALID_VALUES.has(v)) return null;
    answers[id] = v;
  }

  const queue: number[] = [];
  const seen = new Set<number>();
  for (const id of d.queue as unknown[]) {
    if (typeof id !== 'number' || !ALL_ID_SET.has(id) || seen.has(id)) return null;
    seen.add(id);
    queue.push(id);
  }

  const position = d.position as number;
  if (position > queue.length) return null;
  // Ещё не показанные вопросы не могут иметь ответа
  for (let i = position; i < queue.length; i++) {
    if (answers[queue[i]] !== undefined) return null;
  }

  const finished = position === queue.length;
  const deadline = d.deadline;
  if (finished) {
    if (deadline !== null) return null;
  } else if (typeof deadline !== 'number' || !Number.isFinite(deadline)) {
    return null;
  }

  const lastExpiredId =
    typeof d.lastExpiredId === 'number' && ALL_ID_SET.has(d.lastExpiredId) ? d.lastExpiredId : null;

  return {
    round: d.round as number,
    answers,
    queue,
    position,
    deadline: finished ? null : (deadline as number),
    lastExpiredId,
  };
}
