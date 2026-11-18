import type { Session, User } from '@supabase/supabase-js';
import { REGIONS } from '../data/regions';
import { ApiError } from '../types';
import type { AuthSession, AuthUser, LoginRequest, RegisterRequest } from '../types';
import type { AuthService } from '../services/api/authService';
import { getSupabaseClient } from './supabase';
import { toApiError } from './supabaseErrors';

/**
 * Регистрация и вход через Supabase Auth (email + пароль).
 *
 * Профиль (имя, возраст, регион) создаёт триггер в базе (supabase/schema.sql, handle_new_user) из данных,
 * переданных в signUp. Браузер в таблицу profiles не пишет: так профиль заполняется и тогда, когда
 * в Supabase включено подтверждение email и сессии сразу после регистрации ещё нет.
 */

function authError(code: string, message: string, status?: number): ApiError {
  return new ApiError('HTTP', message, status, { error: { code, message } });
}

/** Перевод ошибок Supabase Auth на русский и в коды, которые понимает AuthScreen. */
function mapAuthError(error: unknown, context: 'register' | 'login' | 'other'): ApiError {
  const e = (error ?? {}) as { message?: string; status?: number; code?: string };
  const msg = (e.message ?? '').toLowerCase();
  const code = (e.code ?? '').toLowerCase();

  if (code === 'user_already_exists' || code === 'email_exists' || msg.includes('already registered') || msg.includes('already been registered')) {
    return authError('EMAIL_ALREADY_REGISTERED', 'Этот email уже зарегистрирован.', 409);
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return authError('INVALID_CREDENTIALS', 'Неверный email или пароль.', 401);
  }
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return authError(
      'EMAIL_NOT_CONFIRMED',
      'Email ещё не подтверждён. Откройте письмо от сервиса и перейдите по ссылке, затем войдите снова.',
      401,
    );
  }
  if (code === 'weak_password' || msg.includes('password should be') || msg.includes('weak password')) {
    return authError('VALIDATION_ERROR', 'Пароль слишком простой. Используйте не менее 8 символов, буквы и цифры.', 422);
  }
  if (code === 'email_address_invalid' || msg.includes('invalid format') || (msg.includes('email') && msg.includes('invalid'))) {
    return authError('VALIDATION_ERROR', 'Введите корректный email.', 422);
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit' || e.status === 429 || msg.includes('rate limit')) {
    return authError(
      context === 'login' ? 'LOGIN_LOCKED' : 'RATE_LIMITED',
      'Слишком много попыток. Подождите несколько минут и попробуйте снова.',
      429,
    );
  }
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) {
    return authError('SIGNUP_DISABLED', 'Регистрация новых пользователей сейчас отключена.', 403);
  }
  if (code === 'session_not_found' || code === 'refresh_token_not_found' || e.status === 401 || msg.includes('auth session missing')) {
    return authError('AUTH_REQUIRED', 'Сессия истекла. Войдите снова.', 401);
  }
  return toApiError(error, context === 'register' ? 'Регистрация не удалась.' : 'Ошибка входа.');
}

function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Профиль пользователя: из таблицы profiles, а если её строка недоступна — из данных регистрации. */
async function loadUser(user: User): Promise<AuthUser> {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fallbackAge = Number(metaString(meta, 'age'));
  const base: AuthUser = {
    userId: user.id,
    email: user.email ?? '',
    displayName: metaString(meta, 'full_name')
      ?? [metaString(meta, 'first_name'), metaString(meta, 'last_name')].filter(Boolean).join(' '),
    age: Number.isInteger(fallbackAge) && fallbackAge > 0 ? fallbackAge : null,
    regionCode: metaString(meta, 'region_code'),
    createdAt: user.created_at ?? new Date().toISOString(),
  };

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('profiles')
    .select('email, display_name, age, created_at, regions(code)')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) return base;

  const row = data as unknown as {
    email: string | null; display_name: string | null; age: number | null; created_at: string | null;
    regions: { code: string } | { code: string }[] | null;
  };
  const region = Array.isArray(row.regions) ? row.regions[0] : row.regions;
  return {
    userId: user.id,
    email: row.email || base.email,
    displayName: row.display_name || base.displayName,
    age: row.age ?? base.age,
    regionCode: region?.code ?? base.regionCode,
    createdAt: row.created_at || base.createdAt,
  };
}

/** Сессия Supabase → AuthSession приложения. */
export async function toAuthSession(session: Session): Promise<AuthSession> {
  return { accessToken: session.access_token, user: await loadUser(session.user) };
}

/** Куда Supabase вернёт пользователя по ссылке из письма подтверждения: на текущий сайт. */
function redirectUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return `${window.location.origin}${window.location.pathname}`;
}

async function register(payload: RegisterRequest): Promise<AuthSession> {
  const firstName = payload.firstName.trim();
  const lastName = payload.lastName.trim();
  const email = payload.email.trim().toLowerCase();
  if (!REGIONS.some(r => r.code === payload.regionCode)) {
    throw authError('VALIDATION_ERROR', 'Выберите регион из списка.', 422);
  }

  const client = getSupabaseClient();
  let result;
  try {
    result = await client.auth.signUp({
      email,
      password: payload.password,
      options: {
        emailRedirectTo: redirectUrl(),
        data: {
          first_name: firstName,
          last_name: lastName,
          full_name: [firstName, lastName].filter(Boolean).join(' '),
          age: String(payload.age),
          region_code: payload.regionCode,
        },
      },
    });
  } catch (err) {
    throw toApiError(err, 'Регистрация не удалась.');
  }
  if (result.error) throw mapAuthError(result.error, 'register');

  const { session, user } = result.data;
  // При включённом подтверждении email Supabase не сообщает, что адрес уже занят: возвращает
  // пользователя без identities. Показываем ту же подсказку, что и для занятого email.
  if (!session && user && Array.isArray(user.identities) && user.identities.length === 0) {
    throw authError('EMAIL_ALREADY_REGISTERED', 'Этот email уже зарегистрирован.', 409);
  }
  if (!session) {
    throw authError(
      'EMAIL_CONFIRMATION_REQUIRED',
      `Мы отправили письмо на ${email}. Перейдите по ссылке из письма, чтобы подтвердить адрес, а затем войдите.`,
    );
  }
  return toAuthSession(session);
}

async function login(payload: LoginRequest): Promise<AuthSession> {
  const client = getSupabaseClient();
  let result;
  try {
    result = await client.auth.signInWithPassword({ email: payload.email.trim().toLowerCase(), password: payload.password });
  } catch (err) {
    throw toApiError(err, 'Ошибка входа.');
  }
  if (result.error) throw mapAuthError(result.error, 'login');
  if (!result.data.session) throw authError('LOGIN_FAILED', 'Не удалось войти. Попробуйте ещё раз.');
  return toAuthSession(result.data.session);
}

/** Текущий пользователь. 401, если сессии нет или она недействительна — тогда приложение вернёт ко входу. */
async function me(): Promise<AuthUser> {
  const client = getSupabaseClient();
  let result;
  try {
    result = await client.auth.getUser();
  } catch (err) {
    throw toApiError(err);
  }
  if (result.error || !result.data.user) {
    const mapped = mapAuthError(result.error ?? { status: 401 }, 'other');
    // Сетевую ошибку не превращаем в 401: иначе пользователя выкинет из учётной записи при плохой связи
    throw mapped;
  }
  return loadUser(result.data.user);
}

async function logout(): Promise<void> {
  const client = getSupabaseClient();
  // scope: 'local' — выйти в этом браузере, даже если сервер недоступен
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error) throw mapAuthError(error, 'other');
}

export const authService: AuthService = {
  enabled: true,
  register,
  login,
  me: () => me(),
  logout: () => logout(),
};

export default authService;
