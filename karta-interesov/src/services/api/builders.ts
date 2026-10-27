import { QUESTIONS } from '../../data/questions';
import { TEST_VERSION } from '../../types';
import type { AnswerItem, AnswersMap, AnswerValue, Respondent, SubmitAttemptRequest } from '../../types';

export interface BuildSubmitInput {
  clientAttemptId: string;
  answers: AnswersMap;
  startedAt: string | null;
  respondent?: Respondent;
}

/** Превращает состояние приложения в тело запроса POST /attempts (ответы — по порядку вопросов). */
export function buildSubmitRequest(input: BuildSubmitInput): SubmitAttemptRequest {
  const answers: AnswerItem[] = QUESTIONS
    .filter(q => input.answers[q.id] !== undefined)
    .map(q => ({ questionId: q.id, value: input.answers[q.id] as AnswerValue }));

  return {
    clientAttemptId: input.clientAttemptId,
    testVersion: TEST_VERSION,
    respondent: input.respondent,
    answers,
    startedAt: input.startedAt ?? undefined,
    completedAt: new Date().toISOString(),
  };
}
