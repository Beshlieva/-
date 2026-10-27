import { CATEGORIES, QUESTIONS, calculateResults, toDisplay } from '../../data/questions';
import { TEST_VERSION } from '../../types';
import type { AnswersMap, TestResult } from '../../types';

/** TestResult → привычный экранам формат «id направления → сырой балл». */
export function scoresToRecord(result: TestResult): Record<number, number> {
  const record: Record<number, number> = {};
  for (const s of result.scores) record[s.categoryId] = s.rawScore;
  return record;
}

/**
 * Результат, посчитанный в браузере СУЩЕСТВУЮЩИМ алгоритмом calculateResults (data/questions.ts).
 * Не сохраняется нигде (persisted: false).
 */
export function buildLocalResult(answers: AnswersMap, attemptId: string): TestResult {
  const raw = calculateResults(answers);
  return {
    attemptId,
    testVersion: TEST_VERSION,
    answeredCount: QUESTIONS.filter(q => answers[q.id] !== undefined).length,
    scores: CATEGORIES.map(c => ({
      categoryId: c.id,
      rawScore: raw[c.id],
      displayScore: toDisplay(raw[c.id]),
    })),
    calculatedAt: new Date().toISOString(),
    source: 'local',
    persisted: false,
  };
}
