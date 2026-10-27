import { ApiError } from '../../types';
import type { SubmitAttemptRequest, TestResult } from '../../types';
import type { ApiConfig } from './config';
import { buildLocalResult } from './localResult';
import { validateSubmitRequest } from './validators';

export interface CallOptions {
  signal?: AbortSignal;
}

/** Публичный API теста: то, что нужно обычному пользователю. */
export interface TestService {
  /** Демо-режим: посчитать результат в браузере. В режиме api не используется (см. attemptService). */
  submitAttempt(request: SubmitAttemptRequest, options?: CallOptions): Promise<TestResult>;
  /** Демо-режим: результат из памяти вкладки. */
  getResult(attemptId: string, options?: CallOptions): Promise<TestResult>;
}

export function createTestService(config: ApiConfig): TestService {
  if (config.mode === 'demo') return createDemoTestService();

  // Режим api: результат создаёт и сохраняет сервер при завершении попытки (attemptService.finish).
  // Старую пакетную отправку всех ответов одним POST /attempts сервер отклоняет
  // (BATCH_SUBMIT_NOT_SUPPORTED), поэтому здесь она намеренно не выполняется.
  const batchNotSupported = () =>
    Promise.reject(
      new ApiError(
        'BATCH_NOT_SUPPORTED',
        'В режиме api ответы отправляются по одному, а результат создаётся методом завершения попытки (attemptService.finish).',
      ),
    );
  return { submitAttempt: batchNotSupported, getResult: batchNotSupported };
}

/**
 * Демо-режим: сервера нет. Результат считается в браузере настоящим алгоритмом
 * и честно помечается persisted: false. Ничего не отправляется и не сохраняется
 * (кроме копии в памяти текущей вкладки, чтобы работал getResult).
 */
function createDemoTestService(): TestService {
  const inMemory = new Map<string, TestResult>();
  return {
    async submitAttempt(request) {
      validateSubmitRequest(request);
      const answers: Record<number, number> = {};
      for (const a of request.answers) answers[a.questionId] = a.value;
      const result = buildLocalResult(answers, request.clientAttemptId);
      inMemory.set(result.attemptId, result);
      return result;
    },
    async getResult(attemptId) {
      const found = inMemory.get(attemptId);
      if (!found) {
        throw new ApiError('NOT_FOUND', 'В демо-режиме результаты не сохраняются между сеансами.');
      }
      return found;
    },
  };
}
