import { createAdminService } from './adminService';
import { createAttemptService } from './attemptService';
import { createAuthService } from './authService';
import { resolveApiConfig, resolveBackend } from './config';
import { createTestService } from './testService';
import { authService as supabaseAuthService } from '../../lib/authService';
import { attemptService as supabaseAttemptService } from '../../lib/attemptService';
import { createSupabaseAdminService } from '../../lib/adminServiceSupabase';

/** Единственное место, где читаются переменные окружения для API. */
export const apiConfig = resolveApiConfig(import.meta.env);

/**
 * Какой backend используется:
 *  - supabase — облачная база Supabase (основной режим, VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY);
 *  - php      — прежний PHP API + MySQL (VITE_APP_MODE=php и VITE_API_BASE_URL);
 *  - demo     — без сервера, тест считается в браузере.
 */
export const backend = resolveBackend(import.meta.env);

if (backend === 'php' && apiConfig.configError) {
  console.error(`[api] Ошибка конфигурации: ${apiConfig.configError}`);
}

const useSupabase = backend === 'supabase';

export const testService = createTestService(apiConfig);
export const adminService = useSupabase ? createSupabaseAdminService() : createAdminService(apiConfig);
export const authService = useSupabase ? supabaseAuthService : createAuthService(apiConfig);
export const attemptService = useSupabase ? supabaseAttemptService : createAttemptService(apiConfig);

export { buildSubmitRequest } from './builders';
export { describeError, serverErrorCode, serverFieldErrors } from './errors';
export { buildLocalResult, scoresToRecord } from './localResult';
export type { ApiConfig, ApiMode, Backend } from './config';
export type { TestService } from './testService';
export type { AdminService, AdminCallOptions } from './adminService';
export type { AuthService } from './authService';
export type { AttemptService, StepOutcome } from './attemptService';
export { remainingFromTooEarly, stateFromError } from './attemptService';
