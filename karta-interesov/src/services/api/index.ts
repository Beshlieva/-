import { createAdminService } from './adminService';
import { createAttemptService } from './attemptService';
import { createAuthService } from './authService';
import { resolveApiConfig } from './config';
import { createTestService } from './testService';

/** Единственное место, где читаются переменные окружения для API. */
export const apiConfig = resolveApiConfig(import.meta.env);

if (apiConfig.configError) {
  console.error(`[api] Ошибка конфигурации: ${apiConfig.configError}`);
}

export const testService = createTestService(apiConfig);
export const adminService = createAdminService(apiConfig);
export const authService = createAuthService(apiConfig);
export const attemptService = createAttemptService(apiConfig);

export { buildSubmitRequest } from './builders';
export { describeError, serverErrorCode, serverFieldErrors } from './errors';
export { buildLocalResult, scoresToRecord } from './localResult';
export type { ApiConfig, ApiMode } from './config';
export type { TestService } from './testService';
export type { AdminService, AdminCallOptions } from './adminService';
export type { AuthService } from './authService';
export type { AttemptService, StepOutcome } from './attemptService';
export { remainingFromTooEarly, stateFromError } from './attemptService';
