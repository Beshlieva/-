-- ============================================================
-- Row Level Security для Supabase.
--
-- Принципы:
--   * справочники (регионы, направления, вопросы) читают все, в том числе до входа;
--   * пользователь читает только свои профиль, попытки, ответы и результаты, администратор — всё;
--   * НИКТО не пишет в эти таблицы напрямую через API: профиль создаёт триггер при регистрации,
--     попытки/ответы/результаты — только RPC из rpc_attempts.sql (SECURITY DEFINER), которые
--     проверяют таймер и права. Раньше прямые INSERT/UPDATE позволяли подделать результат,
--     а UPDATE профиля — выдать себе роль admin.
--
-- Скрипт идемпотентен: его можно выполнять повторно в Supabase → SQL Editor.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- ───────── profiles: только чтение своего профиля (админ — всех) ─────────
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles
    FOR SELECT
    TO authenticated
    USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- ───────── справочники: читают все ─────────
DROP POLICY IF EXISTS "regions_select_authenticated" ON public.regions;
DROP POLICY IF EXISTS "regions_select_all" ON public.regions;
CREATE POLICY "regions_select_all"
    ON public.regions
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "categories_select_authenticated" ON public.categories;
DROP POLICY IF EXISTS "categories_select_all" ON public.categories;
CREATE POLICY "categories_select_all"
    ON public.categories
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "questions_select_authenticated" ON public.questions;
DROP POLICY IF EXISTS "questions_select_all" ON public.questions;
CREATE POLICY "questions_select_all"
    ON public.questions
    FOR SELECT
    TO anon, authenticated
    USING (true);

-- ───────── test_attempts: чтение своих (админ — всех), запись только через RPC ─────────
DROP POLICY IF EXISTS "test_attempts_select_own" ON public.test_attempts;
CREATE POLICY "test_attempts_select_own"
    ON public.test_attempts
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "test_attempts_insert_own" ON public.test_attempts;
DROP POLICY IF EXISTS "test_attempts_update_own" ON public.test_attempts;

-- ───────── answers ─────────
DROP POLICY IF EXISTS "answers_select_own" ON public.answers;
CREATE POLICY "answers_select_own"
    ON public.answers
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.test_attempts ta
            WHERE ta.id = answers.attempt_id
              AND ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "answers_insert_own" ON public.answers;
DROP POLICY IF EXISTS "answers_update_own" ON public.answers;

-- ───────── attempt_results ─────────
DROP POLICY IF EXISTS "attempt_results_select_own" ON public.attempt_results;
CREATE POLICY "attempt_results_select_own"
    ON public.attempt_results
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.test_attempts ta
            WHERE ta.id = attempt_results.attempt_id
              AND ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "attempt_results_insert_own" ON public.attempt_results;
DROP POLICY IF EXISTS "attempt_results_update_own" ON public.attempt_results;

-- ───────── устаревшие таблицы PHP-админки: доступ только администратору на чтение ─────────
-- (в Supabase-версии администратор — это пользователь с profiles.role = 'admin')
DROP POLICY IF EXISTS "admin_users_select_admin" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_insert_admin" ON public.admin_users;
DROP POLICY IF EXISTS "admin_users_update_admin" ON public.admin_users;

DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.admin_audit_logs;
CREATE POLICY "audit_logs_select_admin"
    ON public.admin_audit_logs
    FOR SELECT
    TO authenticated
    USING (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_insert_admin" ON public.admin_audit_logs;
DROP POLICY IF EXISTS "audit_logs_update_admin" ON public.admin_audit_logs;

-- Таблица admin_users хранит хэши паролей PHP-админки — через API её не отдаём никому.
REVOKE ALL ON public.admin_users FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
