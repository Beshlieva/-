-- ============================================================
-- Административная аналитика (RPC для панели /#/admin).
-- Повторяет backend/src/Services/AnalyticsService.php.
--
-- Администратор — обычный пользователь Supabase Auth, у которого profiles.role = 'admin'.
-- Назначить администратора (выполнить в SQL Editor, подставив свой email):
--   UPDATE public.profiles SET role = 'admin' WHERE email = 'you@example.com';
--
-- Даты фильтров — UTC, dateTo включительно. Скрипт идемпотентен.
-- ============================================================

BEGIN;

-- ───────────────────────── Служебные функции ─────────────────────────

CREATE OR REPLACE FUNCTION public.admin_require()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Сессия истекла. Войдите снова."}';
    END IF;
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION USING MESSAGE = 'FORBIDDEN', DETAIL = '{"message":"Нет прав администратора."}';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_region_id(p_region_code text)
RETURNS smallint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id smallint;
BEGIN
    IF p_region_code IS NULL OR p_region_code = '' THEN
        RETURN NULL;
    END IF;
    SELECT id INTO v_id FROM public.regions WHERE code = p_region_code;
    IF v_id IS NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'VALIDATION_ERROR',
            DETAIL = '{"message":"Неизвестный регион.","fields":{"regionCode":"Неизвестный регион."}}';
    END IF;
    RETURN v_id;
END;
$$;

-- Начало дня в UTC (NULL → NULL)
CREATE OR REPLACE FUNCTION public.admin_day_start(p_day date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
AS $$ SELECT CASE WHEN p_day IS NULL THEN NULL ELSE (p_day::timestamp AT TIME ZONE 'UTC') END $$;

-- Поиск по имени и email без учёта регистра (спецсимволы LIKE не нужны — используется position)
CREATE OR REPLACE FUNCTION public.admin_matches(p_q text, p_name text, p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_q IS NULL OR btrim(p_q) = ''
        OR position(lower(btrim(p_q)) IN lower(COALESCE(p_name, ''))) > 0
        OR position(lower(btrim(p_q)) IN lower(COALESCE(p_email, ''))) > 0
$$;

-- Завершённые попытки по фильтрам (регион попытки, дата завершения, поиск по участнику)
CREATE OR REPLACE FUNCTION public.admin_completed_attempts(
    p_region_code text, p_date_from date, p_date_to date, p_q text
)
RETURNS TABLE (
    attempt_id bigint,
    completed_at timestamptz,
    started_at timestamptz,
    answered_count smallint,
    test_version text,
    region_id smallint,
    region_code text,
    region_name text,
    display_name text,
    email text,
    age smallint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_region smallint := public.admin_region_id(p_region_code);
    v_from timestamptz := public.admin_day_start(p_date_from);
    v_to timestamptz := public.admin_day_start(p_date_to + 1);
BEGIN
    RETURN QUERY
    SELECT t.id, t.completed_at, t.started_at, t.answered_count, t.test_version,
           t.region_id, g.code, g.name, u.display_name, u.email, u.age
      FROM public.test_attempts t
      JOIN public.profiles u ON u.id = t.user_id
      LEFT JOIN public.regions g ON g.id = t.region_id
     WHERE t.status = 'completed'
       AND (v_region IS NULL OR t.region_id = v_region)
       AND (v_from IS NULL OR t.completed_at >= v_from)
       AND (v_to IS NULL OR t.completed_at < v_to)
       AND public.admin_matches(p_q, u.display_name, u.email);
END;
$$;

-- Средние баллы по направлениям для набора попыток (все 29 направлений, пустые — нули)
CREATE OR REPLACE FUNCTION public.admin_category_aggregates(p_attempt_ids bigint[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'categoryId', c.id,
                   'averageRawScore', COALESCE(round(agg.avg_raw, 2), 0),
                   'averageDisplayScore', COALESCE(round(agg.avg_display)::int, 0),
                   'timesInTop5', COALESCE(agg.top5, 0)
               ) ORDER BY c.id
           ), '[]'::jsonb)
      FROM public.categories c
      LEFT JOIN (
          SELECT r.category_id,
                 AVG(r.raw_score) AS avg_raw,
                 AVG(r.display_score) AS avg_display,
                 SUM(CASE WHEN r.rank_position <= 5 THEN 1 ELSE 0 END)::int AS top5
            FROM public.attempt_results r
           WHERE r.attempt_id = ANY (p_attempt_ids)
           GROUP BY r.category_id
      ) agg ON agg.category_id = c.id
$$;

CREATE OR REPLACE FUNCTION public.admin_top5(p_attempt_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(r.category_id ORDER BY r.rank_position), '[]'::jsonb)
      FROM public.attempt_results r
     WHERE r.attempt_id = p_attempt_id AND r.rank_position <= 5
$$;

-- ───────────────────────── Публичные RPC (только администратор) ─────────────────────────

CREATE OR REPLACE FUNCTION public.admin_overview(p_region_code text, p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_region smallint;
    v_from timestamptz := public.admin_day_start(p_date_from);
    v_to timestamptz := public.admin_day_start(p_date_to + 1);
    v_total_users integer;
    v_started integer;
    v_completed integer;
    v_by_region jsonb;
BEGIN
    PERFORM public.admin_require();
    v_region := public.admin_region_id(p_region_code);

    -- Пользователи — по региону и дате регистрации
    SELECT COUNT(*) INTO v_total_users
      FROM public.profiles u
     WHERE u.role = 'user'
       AND (v_region IS NULL OR u.region_id = v_region)
       AND (v_from IS NULL OR u.created_at >= v_from)
       AND (v_to IS NULL OR u.created_at < v_to);

    -- Начатые — по дате старта
    SELECT COUNT(*) INTO v_started
      FROM public.test_attempts t
     WHERE (v_region IS NULL OR t.region_id = v_region)
       AND (v_from IS NULL OR t.started_at >= v_from)
       AND (v_to IS NULL OR t.started_at < v_to);

    -- Завершённые — по дате завершения
    SELECT COUNT(*) INTO v_completed
      FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, NULL);

    SELECT COALESCE(jsonb_agg(jsonb_build_object('regionCode', x.code, 'users', x.users) ORDER BY x.sort_order), '[]'::jsonb)
      INTO v_by_region
      FROM (
          SELECT g.code, g.sort_order, COUNT(*)::int AS users
            FROM public.profiles u
            JOIN public.regions g ON g.id = u.region_id
           WHERE u.role = 'user'
             AND (v_region IS NULL OR u.region_id = v_region)
             AND (v_from IS NULL OR u.created_at >= v_from)
             AND (v_to IS NULL OR u.created_at < v_to)
           GROUP BY g.id, g.code, g.sort_order
      ) x;

    RETURN jsonb_build_object(
        'totalUsers', v_total_users,
        'startedAttempts', v_started,
        'completedAttempts', v_completed,
        'usersByRegion', v_by_region
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_summary(p_region_code text, p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids bigint[];
    v_avg numeric;
BEGIN
    PERFORM public.admin_require();

    SELECT COALESCE(array_agg(a.attempt_id), ARRAY[]::bigint[]), AVG(a.answered_count)
      INTO v_ids, v_avg
      FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, NULL) a;

    RETURN jsonb_build_object(
        'totalAttempts', COALESCE(array_length(v_ids, 1), 0),
        'averageAnsweredCount', COALESCE(round(v_avg, 1), 0),
        'categories', public.admin_category_aggregates(v_ids)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_region_stats(p_region_code text, p_date_from date, p_date_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_regions jsonb;
BEGIN
    PERFORM public.admin_require();

    -- Попытки без региона в региональную статистику не входят
    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'regionCode', x.region_code,
                   'attempts', x.attempts,
                   'categories', public.admin_category_aggregates(x.ids)
               ) ORDER BY x.sort_order
           ), '[]'::jsonb)
      INTO v_regions
      FROM (
          SELECT a.region_code, g.sort_order, COUNT(*)::int AS attempts, array_agg(a.attempt_id) AS ids
            FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, NULL) a
            JOIN public.regions g ON g.id = a.region_id
           GROUP BY a.region_code, g.sort_order
      ) x;

    RETURN jsonb_build_object('regions', v_regions);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_users(
    p_region_code text, p_date_from date, p_date_to date, p_q text, p_page integer, p_page_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_region smallint;
    v_from timestamptz := public.admin_day_start(p_date_from);
    v_to timestamptz := public.admin_day_start(p_date_to + 1);
    v_page integer := GREATEST(COALESCE(p_page, 1), 1);
    v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
    v_total integer;
    v_items jsonb;
BEGIN
    PERFORM public.admin_require();
    v_region := public.admin_region_id(p_region_code);

    SELECT COUNT(*) INTO v_total
      FROM public.profiles u
     WHERE u.role = 'user'
       AND (v_region IS NULL OR u.region_id = v_region)
       AND (v_from IS NULL OR u.created_at >= v_from)
       AND (v_to IS NULL OR u.created_at < v_to)
       AND public.admin_matches(p_q, u.display_name, u.email);

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'userId', x.id::text,
                   'name', x.display_name,
                   'email', x.email,
                   'age', x.age,
                   'regionCode', x.region_code,
                   'registeredAt', x.created_at,
                   'startedAttempts', (SELECT COUNT(*) FROM public.test_attempts a WHERE a.user_id = x.id),
                   'completedAttempts', (SELECT COUNT(*) FROM public.test_attempts a WHERE a.user_id = x.id AND a.status = 'completed'),
                   'lastCompletedAttemptId', (
                       SELECT a.id::text FROM public.test_attempts a
                        WHERE a.user_id = x.id AND a.status = 'completed'
                        ORDER BY a.completed_at DESC, a.id DESC LIMIT 1
                   )
               ) ORDER BY x.created_at DESC, x.id DESC
           ), '[]'::jsonb)
      INTO v_items
      FROM (
          SELECT u.id, u.display_name, u.email, u.age, u.created_at, g.code AS region_code
            FROM public.profiles u
            LEFT JOIN public.regions g ON g.id = u.region_id
           WHERE u.role = 'user'
             AND (v_region IS NULL OR u.region_id = v_region)
             AND (v_from IS NULL OR u.created_at >= v_from)
             AND (v_to IS NULL OR u.created_at < v_to)
             AND public.admin_matches(p_q, u.display_name, u.email)
           ORDER BY u.created_at DESC, u.id DESC
           LIMIT v_size OFFSET (v_page - 1) * v_size
      ) x;

    RETURN jsonb_build_object('page', v_page, 'pageSize', v_size, 'total', v_total, 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_results(
    p_region_code text, p_date_from date, p_date_to date, p_q text, p_page integer, p_page_size integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_page integer := GREATEST(COALESCE(p_page, 1), 1);
    v_size integer := LEAST(GREATEST(COALESCE(p_page_size, 20), 1), 100);
    v_total integer;
    v_items jsonb;
BEGIN
    PERFORM public.admin_require();

    SELECT COUNT(*) INTO v_total
      FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, p_q);

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'attemptId', x.attempt_id::text,
                   'completedAt', x.completed_at,
                   'answeredCount', COALESCE(x.answered_count, 0),
                   'name', x.display_name,
                   'email', x.email,
                   'age', x.age,
                   'regionCode', x.region_code,
                   'topCategoryIds', public.admin_top5(x.attempt_id)
               ) ORDER BY x.completed_at DESC, x.attempt_id DESC
           ), '[]'::jsonb)
      INTO v_items
      FROM (
          SELECT * FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, p_q) a
           ORDER BY a.completed_at DESC, a.attempt_id DESC
           LIMIT v_size OFFSET (v_page - 1) * v_size
      ) x;

    RETURN jsonb_build_object('page', v_page, 'pageSize', v_size, 'total', v_total, 'items', v_items);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_result_detail(p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v record;
    v_scores jsonb;
BEGIN
    PERFORM public.admin_require();

    SELECT * INTO v
      FROM public.admin_completed_attempts(NULL, NULL, NULL, NULL) a
     WHERE a.attempt_id = p_attempt_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING MESSAGE = 'NOT_FOUND', DETAIL = '{"message":"Результат не найден."}';
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'categoryId', r.category_id,
                   'rawScore', r.raw_score,
                   'displayScore', r.display_score,
                   'rank', r.rank_position
               ) ORDER BY r.rank_position
           ), '[]'::jsonb)
      INTO v_scores
      FROM public.attempt_results r
     WHERE r.attempt_id = p_attempt_id;

    RETURN jsonb_build_object(
        'attemptId', v.attempt_id::text,
        'testVersion', v.test_version,
        'startedAt', v.started_at,
        'completedAt', v.completed_at,
        'answeredCount', COALESCE(v.answered_count, 0),
        'name', v.display_name,
        'email', v.email,
        'age', v.age,
        'regionCode', v.region_code,
        'scores', v_scores
    );
END;
$$;

-- Строки для CSV (сам файл собирает браузер). Не больше 20 000 строк.
CREATE OR REPLACE FUNCTION public.admin_export_rows(p_region_code text, p_date_from date, p_date_to date, p_q text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit constant integer := 20000;
    v_count integer;
    v_rows jsonb;
    v_categories jsonb;
BEGIN
    PERFORM public.admin_require();

    SELECT COUNT(*) INTO v_count
      FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, p_q);

    IF v_count > v_limit THEN
        RAISE EXCEPTION USING MESSAGE = 'EXPORT_TOO_LARGE',
            DETAIL = jsonb_build_object('message', 'Слишком много строк для экспорта (максимум ' || v_limit || '). Сузьте фильтры.')::text;
    END IF;

    SELECT COALESCE(jsonb_agg(
               jsonb_build_object(
                   'attemptId', a.attempt_id::text,
                   'completedAt', a.completed_at,
                   'name', a.display_name,
                   'email', a.email,
                   'age', a.age,
                   'region', a.region_name,
                   'answeredCount', COALESCE(a.answered_count, 0),
                   'scores', (
                       SELECT COALESCE(jsonb_object_agg(r.category_id::text, r.display_score), '{}'::jsonb)
                         FROM public.attempt_results r WHERE r.attempt_id = a.attempt_id
                   ),
                   'top', public.admin_top5(a.attempt_id)
               ) ORDER BY a.completed_at DESC, a.attempt_id DESC
           ), '[]'::jsonb)
      INTO v_rows
      FROM public.admin_completed_attempts(p_region_code, p_date_from, p_date_to, p_q) a;

    SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) ORDER BY c.id)
      INTO v_categories
      FROM public.categories c;

    RETURN jsonb_build_object('rows', v_rows, 'categories', COALESCE(v_categories, '[]'::jsonb));
END;
$$;

-- ───────────────────────── Права ─────────────────────────

REVOKE ALL ON FUNCTION public.admin_require() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_region_id(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_completed_attempts(text, date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_category_aggregates(bigint[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_top5(bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.admin_overview(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_summary(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_region_stats(text, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_users(text, date, date, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_results(text, date, date, text, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_result_detail(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_export_rows(text, date, date, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_overview(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_summary(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_region_stats(text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_users(text, date, date, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_results(text, date, date, text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_result_detail(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_export_rows(text, date, date, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
