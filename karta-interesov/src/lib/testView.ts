import { currentQuestionId, answeredCount, skippedCount, totalQuestions } from './testSession';
import type { TestSession } from './testSession';
import type { AttemptSnapshot } from './serverAttempt';

/**
 * Всё, что нужно экрану вопроса. Экран не знает, откуда пришло состояние: из локального движка
 * (демо-режим, src/lib/testSession.ts) или с сервера (режим api, src/lib/serverAttempt.ts).
 */
export interface TestView {
  round: number;
  questionId: number | null;
  answered: number;
  skipped: number;
  total: number;
  /** Позиция в круге (с 1) и размер круга — для подписи «Повтор пропусков · N из M». */
  position: number;
  queueSize: number;
  /** Момент окончания времени текущего вопроса (мс, epoch). */
  deadline: number | null;
  lastExpiredId: number | null;
  /** Меняется при каждом новом состоянии — перезапускает показ плашки «время вышло». */
  noticeKey: number;
  /** Идёт запрос к серверу: повторные нажатия игнорируются. */
  busy: boolean;
  /** Сообщение об ошибке связи с сервером (показывается плашкой). */
  error: string | null;
}

export function viewFromLocal(s: TestSession): TestView {
  return {
    round: s.round,
    questionId: currentQuestionId(s),
    answered: answeredCount(s.answers),
    skipped: skippedCount(s),
    total: totalQuestions(),
    position: s.position + 1,
    queueSize: s.queue.length,
    deadline: s.deadline,
    lastExpiredId: s.lastExpiredId,
    noticeKey: s.position,
    busy: false,
    error: null,
  };
}

export function viewFromServer(snap: AttemptSnapshot): TestView {
  const st = snap.state;
  return {
    round: st?.round ?? 1,
    questionId: st?.currentQuestion?.questionId ?? null,
    answered: st?.answeredCount ?? 0,
    skipped: st?.skippedCount ?? 0,
    total: st?.totalQuestions ?? totalQuestions(),
    position: st?.roundProgress?.position ?? 1,
    queueSize: st?.roundProgress?.size ?? totalQuestions(),
    deadline: snap.deadline,
    lastExpiredId: snap.lastExpiredId,
    noticeKey: snap.revision,
    busy: snap.busy,
    error: snap.error,
  };
}
