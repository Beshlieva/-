import { ApiError } from '../types';
import type { AnswersMap, ServerAttemptState } from '../types';
import { MIN_ANSWER_DELAY_MS, QUESTION_TIME_MS } from './testSession';
import type { AttemptService } from '../services/api/attemptService';
import { remainingFromTooEarly, stateFromError } from '../services/api/attemptService';
import { serverErrorCode } from '../services/api/errors';

/**
 * Клиент серверной попытки: без React и без обращения к часам напрямую (время передаётся в `clock`),
 * поэтому логику можно проверить в Node (scripts/verify.ts).
 *
 * Принципы:
 *  - единственный источник истины — сервер. Клиент хранит последнее состояние, присланное сервером,
 *    и по нему рисует вопрос и таймер. Время вопроса контролирует сервер (test_attempts.question_opened_at);
 *  - локальный `deadline` — только для картинки и для решения «пора отправлять пропуск».
 *    Он считается от `remainingMs` сервера с поправкой на сетевую задержку, а не от часов браузера;
 *  - ответ не отправляется, если по локальным часам время вышло, и не отправляется дважды одновременно;
 *  - любое расхождение (NOT_CURRENT_QUESTION, ANSWER_ALREADY_FIXED и т. п.) лечится повторным запросом состояния.
 */

export type AttemptPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface AttemptSnapshot {
  phase: AttemptPhase;
  state: ServerAttemptState | null;
  /** Момент окончания времени текущего вопроса по локальным часам (мс, epoch); null — вопроса нет. */
  deadline: number | null;
  /** Вопрос, который только что был пропущен по времени (для плашки «время вышло»). */
  lastExpiredId: number | null;
  /** Растёт при каждом применении состояния сервера — ключ для плашки и анимаций. */
  revision: number;
  /** Идёт запрос, который меняет попытку. */
  busy: boolean;
  /** Сообщение об ошибке для показа пользователю (сеть, сервер). */
  error: string | null;
}

export interface AttemptControllerOptions {
  service: AttemptService;
  token: string;
  /** Текущее время, мс (по умолчанию Date.now). */
  clock?: () => number;
  /** Создаёт идентификатор новой попытки. */
  newId: () => string;
  /** Текстовое описание ошибки для пользователя. */
  describe: (err: unknown) => string;
  /** Вызывается при любом изменении снимка. */
  onChange?: (snapshot: AttemptSnapshot) => void;
  /** Вызывается, когда сервер сообщил, что токен недействителен (401). */
  onUnauthorized?: () => void;
  /** Задержка перед повтором запроса пропуска/состояния после сетевой ошибки, мс. */
  retryDelayMs?: number;
}

export function answersToMap(state: ServerAttemptState): AnswersMap {
  const map: AnswersMap = {};
  for (const a of state.answers) map[a.questionId] = a.value;
  return map;
}

const RESYNC_CODES = new Set([
  'NOT_CURRENT_QUESTION', 'ANSWER_ALREADY_FIXED', 'ATTEMPT_COMPLETED', 'ROUND_MISMATCH', 'ROUND_NOT_FINISHED',
]);

export class AttemptController {
  private snap: AttemptSnapshot = {
    phase: 'idle', state: null, deadline: null, lastExpiredId: null, revision: 0, busy: false, error: null,
  };
  /** Когда вопрос появился на экране по локальным часам — защита от двойного клика. */
  private shownAt = 0;
  private shownQuestionKey = '';
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readonly clock: () => number;
  private readonly retryDelay: number;

  constructor(private readonly opts: AttemptControllerOptions) {
    this.clock = opts.clock ?? Date.now;
    this.retryDelay = opts.retryDelayMs ?? 2000;
  }

  get snapshot(): AttemptSnapshot {
    return this.snap;
  }

  dispose(): void {
    this.disposed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  // ───────────────────────── Запуск и восстановление ─────────────────────────

  /**
   * Восстановить попытку после обновления страницы или входа с другого устройства:
   * сначала по сохранённой ссылке, затем — последняя незавершённая попытка пользователя.
   * Сервер при этом сам списывает истёкшее время (один вопрос за обращение) и время не продлевает.
   */
  async restore(attemptId: string | null): Promise<ServerAttemptState | null> {
    this.patch({ phase: 'loading', error: null });
    try {
      let t = attemptId
        ? await this.timed(() => this.opts.service.get(this.opts.token, attemptId))
        : { state: null, sentAt: 0, receivedAt: 0 };
      if (!t.state) t = await this.timed(() => this.opts.service.active(this.opts.token));
      if (!t.state) {
        this.patch({ phase: 'idle', state: null, deadline: null });
        return null;
      }
      this.apply(t.state, t.sentAt, t.receivedAt, null);
      return t.state;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  /** Начать тест: продолжить существующую незавершённую попытку или создать новую. */
  async begin(): Promise<ServerAttemptState | null> {
    this.patch({ phase: 'loading', error: null });
    try {
      let t = await this.timed(() => this.opts.service.active(this.opts.token));
      if (!t.state) t = await this.timed(() => this.opts.service.start(this.opts.token, this.opts.newId()));
      if (!t.state) throw new ApiError('INVALID_RESPONSE', 'Сервер не создал попытку.');
      this.apply(t.state, t.sentAt, t.receivedAt, null);
      return t.state;
    } catch (err) {
      this.fail(err);
      return null;
    }
  }

  // ───────────────────────── Ответ, пропуск, повторный круг ─────────────────────────

  /** Отправить ответ на текущий вопрос. Возвращает true, если запрос был отправлен. */
  async answer(questionId: number, value: number): Promise<boolean> {
    const s = this.snap;
    if (s.phase !== 'ready' || s.busy || !s.state || !s.state.currentQuestion) return false;
    if (s.state.currentQuestion.questionId !== questionId) return false;
    if (!Number.isInteger(value) || value < -2 || value > 2) return false;
    const now = this.clock();
    // Просроченный ответ не отправляем вообще: этим займётся пропуск по таймеру
    if (s.deadline === null || now >= s.deadline) return false;
    // Защита от двойного нажатия: клик в первые мс после появления вопроса не считается ответом
    if (now - this.shownAt < MIN_ANSWER_DELAY_MS) return false;

    const attemptId = s.state.attemptId;
    this.patch({ busy: true, error: null });
    const sentAt = this.clock();
    try {
      const out = await this.opts.service.answer(this.opts.token, attemptId, questionId, value);
      const receivedAt = this.clock();
      this.apply(out.state, sentAt, receivedAt, out.kind === 'expired' ? questionId : null);
      return true;
    } catch (err) {
      await this.recover(err, attemptId);
      return true;
    } finally {
      this.finishBusy();
    }
  }

  /**
   * Время текущего вопроса вышло (по локальным часам) → просим сервер отметить пропуск.
   * Сервер примет его только если время действительно вышло; иначе вернёт TOO_EARLY с остатком.
   */
  async expire(questionId: number): Promise<boolean> {
    const s = this.snap;
    if (s.phase !== 'ready' || s.busy || !s.state || !s.state.currentQuestion) return false;
    if (s.state.currentQuestion.questionId !== questionId) return false;
    if (s.deadline === null || this.clock() < s.deadline) return false;

    const attemptId = s.state.attemptId;
    this.patch({ busy: true });
    const sentAt = this.clock();
    try {
      const out = await this.opts.service.skip(this.opts.token, attemptId, questionId);
      this.apply(out.state, sentAt, this.clock(), questionId);
      return true;
    } catch (err) {
      const early = remainingFromTooEarly(err);
      if (early !== null) {
        // Часы клиента и сервера немного расходятся: ждём указанный сервером остаток и пробуем снова
        this.patch({ deadline: this.clock() + early });
        return true;
      }
      await this.recover(err, attemptId);
      return true;
    } finally {
      this.finishBusy();
    }
  }

  /** Начать повторный круг по пропущенным вопросам. */
  async retryRound(): Promise<boolean> {
    const s = this.snap;
    if (s.phase !== 'ready' || s.busy || !s.state) return false;
    const attemptId = s.state.attemptId;
    const fromRound = s.state.round;
    this.patch({ busy: true, error: null });
    const sentAt = this.clock();
    try {
      const state = await this.opts.service.retryRound(this.opts.token, attemptId, fromRound);
      this.apply(state, sentAt, this.clock(), null);
      return true;
    } catch (err) {
      await this.recover(err, attemptId);
      return false;
    } finally {
      this.finishBusy();
    }
  }

  /** Принудительно обновить состояние с сервера (например, после возврата во вкладку). */
  async resync(): Promise<void> {
    const s = this.snap;
    if (s.phase !== 'ready' || s.busy || !s.state) return;
    const attemptId = s.state.attemptId;
    this.patch({ busy: true });
    try {
      const t = await this.timed(() => this.opts.service.get(this.opts.token, attemptId));
      if (t.state) this.apply(t.state, t.sentAt, t.receivedAt, this.snap.lastExpiredId);
    } catch (err) {
      this.handleError(err);
    } finally {
      this.finishBusy();
    }
  }

  // ───────────────────────── Внутренняя кухня ─────────────────────────

  /** Запрос состояния с засечкой времени отправки и получения (для поправки на задержку сети). */
  private async timed(
    call: () => Promise<ServerAttemptState | null>,
  ): Promise<{ state: ServerAttemptState | null; sentAt: number; receivedAt: number }> {
    const sentAt = this.clock();
    const state = await call();
    return { state, sentAt, receivedAt: this.clock() };
  }

  /** Применить состояние сервера. `expiredId` — вопрос, пропущенный по времени (для плашки). */
  private apply(state: ServerAttemptState, sentAt: number, receivedAt: number, expiredId: number | null): void {
    let deadline: number | null = null;
    const q = state.currentQuestion;
    if (q) {
      // Сервер посчитал remainingMs примерно в середине запроса: deadline = середина + остаток.
      const midpoint = (sentAt + receivedAt) / 2;
      const limit = Math.min(q.timeLimitMs, QUESTION_TIME_MS);
      deadline = Math.min(midpoint + q.remainingMs, receivedAt + limit);
      const key = `${state.round}:${q.questionId}`;
      if (key !== this.shownQuestionKey) {
        this.shownQuestionKey = key;
        this.shownAt = receivedAt;
      }
    } else {
      this.shownQuestionKey = '';
    }
    this.snap = {
      ...this.snap,
      phase: 'ready', state, deadline, error: null,
      lastExpiredId: expiredId,
      revision: this.snap.revision + 1,
    };
    this.emit();
  }

  /** Ошибка запроса к серверу: расхождение состояний лечим повторным запросом, остальное показываем. */
  private async recover(err: unknown, attemptId: string): Promise<void> {
    const code = serverErrorCode(err);
    const carried = stateFromError(err);
    if (carried) {
      this.apply(carried, this.clock(), this.clock(), this.snap.lastExpiredId);
      return;
    }
    if (code !== null && RESYNC_CODES.has(code)) {
      try {
        const sentAt = this.clock();
        const fresh = await this.opts.service.get(this.opts.token, attemptId);
        if (fresh) this.apply(fresh, sentAt, this.clock(), this.snap.lastExpiredId);
        return;
      } catch (inner) {
        this.handleError(inner);
        return;
      }
    }
    this.handleError(err);
  }

  private handleError(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) {
      // Токен недействителен: повторять бессмысленно, приложение вернёт пользователя ко входу
      this.opts.onUnauthorized?.();
      this.patch({ error: this.opts.describe(err) });
      return;
    }
    this.patch({ error: this.opts.describe(err) });
    this.scheduleRetry();
  }

  /** После сетевой ошибки сервер мог принять или не принять запрос — повторно спрашиваем его состояние. */
  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== null) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.disposed) return;
      void this.resync();
    }, this.retryDelay);
  }

  private fail(err: unknown): void {
    if (err instanceof ApiError && err.status === 401) this.opts.onUnauthorized?.();
    this.patch({ phase: 'error', error: this.opts.describe(err) });
  }

  private finishBusy(): void {
    this.patch({ busy: false });
    // Пока шёл запрос, время вопроса могло выйти: сразу пропускаем, а не ждём следующего события
    const s = this.snap;
    const q = s.state?.currentQuestion;
    if (!this.disposed && s.phase === 'ready' && q && s.deadline !== null && this.clock() >= s.deadline && !s.error) {
      void this.expire(q.questionId);
    }
  }

  private patch(p: Partial<AttemptSnapshot>): void {
    this.snap = { ...this.snap, ...p };
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    this.opts.onChange?.(this.snap);
  }
}
