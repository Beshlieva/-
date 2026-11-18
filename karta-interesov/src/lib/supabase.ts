import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { ApiError } from '../types';

/**
 * Клиент Supabase. Адрес проекта и публичный (publishable/anon) ключ берутся из VITE_SUPABASE_URL и
 * VITE_SUPABASE_ANON_KEY. Эти значения попадают в код сайта — это нормально: доступ к данным ограничивают
 * политики RLS и проверки внутри RPC (supabase/*.sql). Секретный ключ (sb_secret_…) во frontend не нужен.
 *
 * Если переменные не заданы, модуль НЕ падает при загрузке (раньше это давало белый экран даже в демо-режиме):
 * клиент равен null, а ошибка возникает только при попытке им воспользоваться.
 */
// import.meta.env есть только в сборке Vite; в Node-проверках (npm test) его нет
const env: Partial<ImportMetaEnv> = import.meta.env ?? {};
const supabaseUrl = (env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export function getSupabaseClient(): SupabaseClient<Database> {
  if (!supabase) {
    throw new ApiError(
      'NOT_CONFIGURED',
      'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY — подключение к базе данных не настроено.',
    );
  }
  return supabase;
}
