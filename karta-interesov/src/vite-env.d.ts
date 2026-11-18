/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 'supabase' | 'php' | 'demo' — см. .env.example. Без него режим определяется по остальным переменным. */
  readonly VITE_APP_MODE?: string;
  /** Адрес проекта Supabase, например https://xxxx.supabase.co */
  readonly VITE_SUPABASE_URL?: string;
  /** Публичный ключ Supabase (publishable / anon). Секретный ключ сюда записывать нельзя. */
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Для режима php: 'demo' или 'api' */
  readonly VITE_API_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
