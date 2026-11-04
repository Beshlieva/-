-- RLS policies for Supabase.
-- Enables row-level security and authorizes access by authenticated user / admin role.

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

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles
    FOR SELECT
    USING (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles
    FOR INSERT
    WITH CHECK (auth.uid() = id OR public.is_admin());

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles
    FOR UPDATE
    USING (auth.uid() = id OR public.is_admin())
    WITH CHECK (auth.uid() = id OR public.is_admin());

-- regions: all authenticated users can read
DROP POLICY IF EXISTS "regions_select_authenticated" ON public.regions;
CREATE POLICY "regions_select_authenticated"
    ON public.regions
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- categories: all authenticated users can read
DROP POLICY IF EXISTS "categories_select_authenticated" ON public.categories;
CREATE POLICY "categories_select_authenticated"
    ON public.categories
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- questions: all authenticated users can read
DROP POLICY IF EXISTS "questions_select_authenticated" ON public.questions;
CREATE POLICY "questions_select_authenticated"
    ON public.questions
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- test_attempts: user sees own attempts, admin sees all
DROP POLICY IF EXISTS "test_attempts_select_own" ON public.test_attempts;
CREATE POLICY "test_attempts_select_own"
    ON public.test_attempts
    FOR SELECT
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "test_attempts_insert_own" ON public.test_attempts;
CREATE POLICY "test_attempts_insert_own"
    ON public.test_attempts
    FOR INSERT
    WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "test_attempts_update_own" ON public.test_attempts;
CREATE POLICY "test_attempts_update_own"
    ON public.test_attempts
    FOR UPDATE
    USING (user_id = auth.uid() OR public.is_admin())
    WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- answers: user sees own answers, admin sees all
DROP POLICY IF EXISTS "answers_select_own" ON public.answers;
CREATE POLICY "answers_select_own"
    ON public.answers
    FOR SELECT
    USING (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "answers_insert_own" ON public.answers;
CREATE POLICY "answers_insert_own"
    ON public.answers
    FOR INSERT
    WITH CHECK (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "answers_update_own" ON public.answers;
CREATE POLICY "answers_update_own"
    ON public.answers
    FOR UPDATE
    USING (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    )
    WITH CHECK (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

-- attempt_results: user sees own results, admin sees all
DROP POLICY IF EXISTS "attempt_results_select_own" ON public.attempt_results;
CREATE POLICY "attempt_results_select_own"
    ON public.attempt_results
    FOR SELECT
    USING (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "attempt_results_insert_own" ON public.attempt_results;
CREATE POLICY "attempt_results_insert_own"
    ON public.attempt_results
    FOR INSERT
    WITH CHECK (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

DROP POLICY IF EXISTS "attempt_results_update_own" ON public.attempt_results;
CREATE POLICY "attempt_results_update_own"
    ON public.attempt_results
    FOR UPDATE
    USING (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    )
    WITH CHECK (
        attempt_id IN (
            SELECT ta.id
            FROM public.test_attempts ta
            WHERE ta.user_id = auth.uid()
        ) OR public.is_admin()
    );

-- admin users: admin only
DROP POLICY IF EXISTS "admin_users_select_admin" ON public.admin_users;
CREATE POLICY "admin_users_select_admin"
    ON public.admin_users
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "admin_users_insert_admin" ON public.admin_users;
CREATE POLICY "admin_users_insert_admin"
    ON public.admin_users
    FOR INSERT
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_users_update_admin" ON public.admin_users;
CREATE POLICY "admin_users_update_admin"
    ON public.admin_users
    FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- admin audit logs: admin only
DROP POLICY IF EXISTS "audit_logs_select_admin" ON public.admin_audit_logs;
CREATE POLICY "audit_logs_select_admin"
    ON public.admin_audit_logs
    FOR SELECT
    USING (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_insert_admin" ON public.admin_audit_logs;
CREATE POLICY "audit_logs_insert_admin"
    ON public.admin_audit_logs
    FOR INSERT
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "audit_logs_update_admin" ON public.admin_audit_logs;
CREATE POLICY "audit_logs_update_admin"
    ON public.admin_audit_logs
    FOR UPDATE
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

COMMIT;
