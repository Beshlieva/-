-- ============================================================
-- Серверное прохождение теста (RPC для Supabase).
-- Повторяет правила backend/src/Services/AttemptService.php:
--   * время вопроса — 15 с, считает сервер (test_attempts.question_opened_at);
--   * ответ принимается до 15 с + 1 с допуска, позже — вопрос становится пропущенным;
--   * пропуск принимается не раньше 15 с − 1 с допуска (иначе TOO_EARLY с remainingMs);
--   * повторные круги — только по пропущенным вопросам;
--   * результат сохраняется один раз (attempt_finish идемпотентен).
--
-- Ошибки: RAISE EXCEPTION с MESSAGE = машинный код (AUTH_REQUIRED, TOO_EARLY, ...),
-- DETAIL = JSON с подробностями. Клиент разбирает их в src/lib/attemptService.ts.
--
-- Скрипт идемпотентен: его можно выполнять повторно в Supabase → SQL Editor.
-- ============================================================

BEGIN;

-- Старые служебные функции, которые больше не нужны (были доступны всем через API).
DROP FUNCTION IF EXISTS public.attempt_load_for_update(bigint);
DROP FUNCTION IF EXISTS public.attempt_find_answer(bigint, smallint);
-- У attempt_reconcile сменился тип результата (TABLE → void): CREATE OR REPLACE так не умеет.
DROP FUNCTION IF EXISTS public.attempt_reconcile(bigint, timestamptz);

-- ───────────────────────── Служебные функции (недоступны через API) ─────────────────────────

-- Пометить вопрос пропущенным в указанном круге (новая строка или повторный пропуск).
CREATE OR REPLACE FUNCTION public.attempt_mark_skipped(
    p_attempt_id bigint,
    p_question_id smallint,
    p_round smallint,
    p_shown_at timestamptz,
    p_now timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
    VALUES (p_attempt_id, p_question_id, 'skipped', NULL, p_round, 1, p_shown_at, p_now)
    ON CONFLICT (attempt_id, question_id) DO UPDATE
       SET last_round  = EXCLUDED.last_round,
           skip_count  = public.answers.skip_count + 1,
           shown_at    = EXCLUDED.shown_at,
           resolved_at = EXCLUDED.resolved_at
     WHERE public.answers.status = 'skipped';
END;
$$;

-- Открыть следующий вопрос круга (или закрыть круг, если вопросов не осталось).
CREATE OR REPLACE FUNCTION public.attempt_open_next(p_attempt_id bigint, p_round smallint, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_next_question_id smallint;
BEGIN
    IF p_round = 1 THEN
        SELECT q.id
          INTO v_next_question_id
          FROM public.questions q
         WHERE NOT EXISTS (
                SELECT 1
                  FROM public.answers a
                 WHERE a.attempt_id = p_attempt_id
                   AND a.question_id = q.id
             )
         ORDER BY q.id
         LIMIT 1;
    ELSE
        SELECT a.question_id
          INTO v_next_question_id
          FROM public.answers a
         WHERE a.attempt_id = p_attempt_id
           AND a.status = 'skipped'
           AND a.last_round < p_round
         ORDER BY a.question_id
         LIMIT 1;
    END IF;

    UPDATE public.test_attempts
       SET current_question_id = v_next_question_id,
           question_opened_at  = CASE WHEN v_next_question_id IS NULL THEN NULL ELSE p_now END
     WHERE id = p_attempt_id;
END;
$$;

-- Если время текущего вопроса вышло (с допуском) — пометить его пропущенным и открыть следующий.
-- Как и в PHP-версии, за одно обращение списывается не больше одного вопроса.
CREATE OR REPLACE FUNCTION public.attempt_reconcile(p_attempt_id bigint, p_now timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_elapsed_ms numeric;
BEGIN
    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;

    IF NOT FOUND OR v_attempt.status <> 'in_progress' OR v_attempt.current_question_id IS NULL THEN
        RETURN;
    END IF;

    v_elapsed_ms := EXTRACT(EPOCH FROM (p_now - v_attempt.question_opened_at)) * 1000;

    IF v_elapsed_ms >= 15000 + 1000 THEN
        PERFORM public.attempt_mark_skipped(
            v_attempt.id, v_attempt.current_question_id, v_attempt.current_round,
            v_attempt.question_opened_at, p_now
        );
        PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, p_now);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_round_progress(p_attempt_id bigint, p_round smallint, p_total integer, p_has_current boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_done integer;
    v_pending integer;
    v_size integer;
    v_position integer;
BEGIN
    SELECT
        COALESCE(SUM(CASE WHEN a.last_round = p_round THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN a.status = 'skipped' AND a.last_round < p_round THEN 1 ELSE 0 END), 0)
      INTO v_done, v_pending
      FROM public.answers a
     WHERE a.attempt_id = p_attempt_id;

    IF p_round = 1 THEN
        v_size := p_total;
    ELSE
        v_size := v_done + v_pending;
    END IF;

    IF p_has_current THEN
        v_position := v_done + 1;
    ELSE
        v_position := v_size;
    END IF;

    RETURN jsonb_build_object(
        'position', GREATEST(1, LEAST(v_position, GREATEST(1, v_size))),
        'size', GREATEST(1, v_size)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_missing_questions(p_attempt_id bigint)
RETURNS smallint[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ids smallint[];
BEGIN
    SELECT array_agg(q.id ORDER BY q.id)
      INTO v_ids
      FROM public.questions q
     WHERE NOT EXISTS (
            SELECT 1
              FROM public.answers a
             WHERE a.attempt_id = p_attempt_id
               AND a.question_id = q.id
               AND a.status = 'answered'
         );

    RETURN COALESCE(v_ids, ARRAY[]::smallint[]);
END;
$$;

-- Баллы по всем направлениям: сырой балл (сумма ответов), 0–100 и место.
CREATE OR REPLACE FUNCTION public.attempt_calculate_scores(p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows jsonb;
BEGIN
    WITH raw_scores AS (
        SELECT q.category_id,
               COALESCE(SUM(a.value), 0) AS raw_score
          FROM public.questions q
          LEFT JOIN public.answers a
                 ON a.question_id = q.id
                AND a.attempt_id = p_attempt_id
                AND a.status = 'answered'
         GROUP BY q.category_id
    ),
    all_categories AS (
        SELECT c.id AS category_id,
               COALESCE(rs.raw_score, 0) AS raw_score
          FROM public.categories c
          LEFT JOIN raw_scores rs ON rs.category_id = c.id
    ),
    ranked AS (
        SELECT ac.category_id,
               ac.raw_score,
               ROUND(((ac.raw_score + 12)::numeric / 24) * 100)::int AS display_score,
               ROW_NUMBER() OVER (ORDER BY ac.raw_score DESC, ac.category_id ASC) AS rank_position
          FROM all_categories ac
    )
    SELECT jsonb_agg(
               jsonb_build_object(
                   'categoryId', category_id,
                   'rawScore', raw_score,
                   'displayScore', display_score,
                   'rank', rank_position
               )
               ORDER BY category_id
           )
      INTO v_rows
      FROM ranked;

    RETURN COALESCE(v_rows, '[]'::jsonb);
END;
$$;

-- Проверка: вызывающий — владелец попытки. Возвращает строку попытки (с блокировкой при p_lock).
CREATE OR REPLACE FUNCTION public.attempt_require_owner(p_user_id uuid, p_attempt_id bigint, p_lock boolean)
RETURNS public.test_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Войдите в систему."}';
    END IF;

    IF p_lock THEN
        SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;
    ELSE
        SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;
    END IF;

    IF NOT FOUND OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_NOT_FOUND', DETAIL = '{"message":"Попытка не найдена."}';
    END IF;

    RETURN v_attempt;
END;
$$;

-- Состояние попытки в формате ServerAttemptState (src/types/index.ts). Без проверки прав — только для вызова изнутри.
CREATE OR REPLACE FUNCTION public.attempt_build_state(p_attempt_id bigint, p_now timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_question_time_ms constant integer := 15000;
    v_total integer;
    v_answered_count integer;
    v_skipped_count integer;
    v_answers jsonb;
    v_skipped_ids jsonb;
    v_current_question jsonb := 'null'::jsonb;
    v_round_progress jsonb := 'null'::jsonb;
    v_deadline timestamptz;
BEGIN
    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;

    v_total := (SELECT COUNT(*) FROM public.questions);
    v_answered_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = v_attempt.id AND status = 'answered');
    v_skipped_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = v_attempt.id AND status = 'skipped');

    v_answers := COALESCE(
        (SELECT jsonb_agg(jsonb_build_object('questionId', a.question_id, 'value', a.value) ORDER BY a.question_id)
           FROM public.answers a
          WHERE a.attempt_id = v_attempt.id AND a.status = 'answered'),
        '[]'::jsonb
    );

    v_skipped_ids := COALESCE(
        (SELECT jsonb_agg(a.question_id ORDER BY a.question_id)
           FROM public.answers a
          WHERE a.attempt_id = v_attempt.id AND a.status = 'skipped'),
        '[]'::jsonb
    );

    IF v_attempt.status = 'in_progress' AND v_attempt.current_question_id IS NOT NULL THEN
        v_deadline := v_attempt.question_opened_at + make_interval(secs => v_question_time_ms / 1000.0);
        v_current_question := jsonb_build_object(
            'questionId', v_attempt.current_question_id,
            'openedAt', v_attempt.question_opened_at,
            'deadlineAt', v_deadline,
            'timeLimitMs', v_question_time_ms,
            'remainingMs', GREATEST(0, LEAST(v_question_time_ms, FLOOR(EXTRACT(EPOCH FROM (v_deadline - p_now)) * 1000)))::integer
        );
    END IF;

    IF v_attempt.status = 'in_progress' THEN
        v_round_progress := public.attempt_round_progress(
            v_attempt.id, v_attempt.current_round, v_total, v_attempt.current_question_id IS NOT NULL
        );
    END IF;

    RETURN jsonb_build_object(
        'attemptId', v_attempt.id::text,
        'clientAttemptId', v_attempt.client_attempt_id,
        'testVersion', v_attempt.test_version,
        'status', v_attempt.status,
        'round', v_attempt.current_round,
        'totalQuestions', v_total,
        'answeredCount', v_answered_count,
        'skippedCount', v_skipped_count,
        'roundFinished', v_attempt.status = 'in_progress' AND v_attempt.current_question_id IS NULL,
        'canFinish', v_attempt.status = 'in_progress' AND v_answered_count = v_total,
        'currentQuestion', v_current_question,
        'answers', v_answers,
        'skippedQuestionIds', v_skipped_ids,
        'roundProgress', v_round_progress,
        'startedAt', v_attempt.started_at,
        'completedAt', v_attempt.completed_at,
        'serverTime', p_now
    );
END;
$$;

-- Результат завершённой попытки в формате UserTestResult. Без проверки прав — только для вызова изнутри.
CREATE OR REPLACE FUNCTION public.attempt_build_result(p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_scores jsonb;
    v_top jsonb;
BEGIN
    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;

    SELECT jsonb_agg(
               jsonb_build_object(
                   'categoryId', ar.category_id,
                   'rawScore', ar.raw_score,
                   'displayScore', ar.display_score,
                   'rank', ar.rank_position
               )
               ORDER BY ar.category_id
           )
      INTO v_scores
      FROM public.attempt_results ar
     WHERE ar.attempt_id = p_attempt_id;

    SELECT jsonb_agg(ar.category_id ORDER BY ar.rank_position)
      INTO v_top
      FROM public.attempt_results ar
     WHERE ar.attempt_id = p_attempt_id
       AND ar.rank_position <= 5;

    RETURN jsonb_build_object(
        'attemptId', v_attempt.id::text,
        'testVersion', v_attempt.test_version,
        'answeredCount', COALESCE(v_attempt.answered_count, 0),
        'persisted', true,
        'calculatedAt', v_attempt.calculated_at,
        'completedAt', v_attempt.completed_at,
        'topCategoryIds', COALESCE(v_top, '[]'::jsonb),
        'scores', COALESCE(v_scores, '[]'::jsonb)
    );
END;
$$;

-- ───────────────────────── Публичные RPC (только для вошедших пользователей) ─────────────────────────

CREATE OR REPLACE FUNCTION public.attempt_state(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_now timestamptz := clock_timestamp();
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, true);
    PERFORM public.attempt_reconcile(v_attempt.id, v_now);
    RETURN jsonb_build_object('state', public.attempt_build_state(v_attempt.id, v_now));
END;
$$;

-- Последняя незавершённая попытка пользователя; NULL, если её нет.
CREATE OR REPLACE FUNCTION public.attempt_active_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt_id bigint;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Войдите в систему."}';
    END IF;

    SELECT id
      INTO v_attempt_id
      FROM public.test_attempts
     WHERE user_id = p_user_id
       AND status = 'in_progress'
     ORDER BY id DESC
     LIMIT 1;

    IF v_attempt_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN public.attempt_state(p_user_id, v_attempt_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_create(
    p_user_id uuid,
    p_client_attempt_id text,
    p_test_version text,
    p_region_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_expected_version constant text := 'golomshtok-174-v1';
    v_region_id smallint;
    v_attempt_id bigint;
    v_email text;
    v_now timestamptz := clock_timestamp();
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Войдите в систему."}';
    END IF;

    IF p_client_attempt_id IS NULL OR length(p_client_attempt_id) < 8 OR length(p_client_attempt_id) > 64 THEN
        RAISE EXCEPTION USING MESSAGE = 'VALIDATION_ERROR', DETAIL = '{"message":"Некорректный идентификатор попытки."}';
    END IF;

    IF p_test_version IS NOT NULL AND p_test_version <> v_expected_version THEN
        RAISE EXCEPTION USING MESSAGE = 'VALIDATION_ERROR',
            DETAIL = jsonb_build_object('message', 'Неподдерживаемая версия теста. Ожидается ' || v_expected_version)::text;
    END IF;

    -- Профиль обязателен (test_attempts.user_id → profiles.id). Обычно его создаёт триггер при регистрации;
    -- на случай пользователей, созданных до появления триггера, создаём профиль здесь.
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
        SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;
        INSERT INTO public.profiles (id, email, display_name)
        VALUES (p_user_id, COALESCE(v_email, p_user_id::text || '@unknown'), split_part(COALESCE(v_email, ''), '@', 1))
        ON CONFLICT (id) DO NOTHING;
    END IF;

    IF p_region_code IS NOT NULL THEN
        SELECT r.id INTO v_region_id FROM public.regions r WHERE r.code = p_region_code;
        IF v_region_id IS NULL THEN
            RAISE EXCEPTION USING MESSAGE = 'VALIDATION_ERROR', DETAIL = '{"message":"Неизвестный регион."}';
        END IF;
    ELSE
        SELECT pr.region_id INTO v_region_id FROM public.profiles pr WHERE pr.id = p_user_id;
    END IF;

    INSERT INTO public.test_attempts (user_id, client_attempt_id, test_version, region_id, status, current_round, started_at)
    VALUES (p_user_id, p_client_attempt_id, v_expected_version, v_region_id, 'in_progress', 1, v_now)
    ON CONFLICT ON CONSTRAINT uq_attempts_user_client DO NOTHING
    RETURNING id INTO v_attempt_id;

    IF v_attempt_id IS NULL THEN
        -- Повтор с тем же clientAttemptId — возвращаем существующую попытку
        SELECT id INTO v_attempt_id
          FROM public.test_attempts
         WHERE user_id = p_user_id AND client_attempt_id = p_client_attempt_id;
        RETURN jsonb_build_object('created', false) || public.attempt_state(p_user_id, v_attempt_id);
    END IF;

    PERFORM public.attempt_open_next(v_attempt_id, 1::smallint, v_now);
    RETURN jsonb_build_object('created', true, 'state', public.attempt_build_state(v_attempt_id, v_now));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_answer(p_user_id uuid, p_attempt_id bigint, p_question_id smallint, p_value smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_existing public.answers%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_elapsed_ms numeric;
    v_question_time_ms constant integer := 15000;
    v_answer_grace_ms constant integer := 1000;
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, true);

    IF p_value IS NULL OR p_value < -2 OR p_value > 2 THEN
        RAISE EXCEPTION USING MESSAGE = 'VALIDATION_ERROR', DETAIL = '{"message":"Недопустимое значение ответа."}';
    END IF;

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_COMPLETED', DETAIL = '{"message":"Попытка уже завершена."}';
    END IF;

    SELECT * INTO v_existing
      FROM public.answers
     WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF FOUND AND v_existing.status = 'answered' THEN
        IF v_existing.value = p_value THEN
            RETURN jsonb_build_object('outcome', 'duplicate', 'state', public.attempt_build_state(p_attempt_id, v_now));
        END IF;
        RAISE EXCEPTION USING MESSAGE = 'ANSWER_ALREADY_FIXED',
            DETAIL = '{"message":"Ответ на этот вопрос уже зафиксирован и не может быть изменён."}';
    END IF;

    IF v_attempt.current_question_id IS DISTINCT FROM p_question_id THEN
        RAISE EXCEPTION USING MESSAGE = 'NOT_CURRENT_QUESTION', DETAIL = '{"message":"Это не текущий вопрос."}';
    END IF;

    v_elapsed_ms := EXTRACT(EPOCH FROM (v_now - v_attempt.question_opened_at)) * 1000;

    IF v_elapsed_ms > v_question_time_ms + v_answer_grace_ms THEN
        -- Время вышло: ответ «задним числом» не принимается, вопрос становится пропущенным
        PERFORM public.attempt_mark_skipped(
            v_attempt.id, v_attempt.current_question_id, v_attempt.current_round, v_attempt.question_opened_at, v_now
        );
        PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);
        RETURN jsonb_build_object('outcome', 'expired', 'state', public.attempt_build_state(p_attempt_id, v_now));
    END IF;

    INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
    VALUES (p_attempt_id, p_question_id, 'answered', p_value, v_attempt.current_round, 0, v_attempt.question_opened_at, v_now)
    ON CONFLICT (attempt_id, question_id) DO UPDATE
       SET status      = 'answered',
           value       = EXCLUDED.value,
           last_round  = EXCLUDED.last_round,
           shown_at    = EXCLUDED.shown_at,
           resolved_at = EXCLUDED.resolved_at
     WHERE public.answers.status = 'skipped';

    PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);
    RETURN jsonb_build_object('outcome', 'accepted', 'state', public.attempt_build_state(p_attempt_id, v_now));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_skip(p_user_id uuid, p_attempt_id bigint, p_question_id smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_existing public.answers%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_elapsed_ms numeric;
    v_question_time_ms constant integer := 15000;
    v_skip_tolerance_ms constant integer := 1000;
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, true);

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_COMPLETED', DETAIL = '{"message":"Попытка уже завершена."}';
    END IF;

    SELECT * INTO v_existing
      FROM public.answers
     WHERE attempt_id = p_attempt_id AND question_id = p_question_id;

    IF FOUND AND v_existing.status = 'answered' THEN
        RAISE EXCEPTION USING MESSAGE = 'ANSWER_ALREADY_FIXED',
            DETAIL = '{"message":"На этот вопрос уже есть ответ — пропустить его нельзя."}';
    END IF;

    -- Повтор того же пропуска в этом круге — идемпотентный успех
    IF FOUND AND v_existing.last_round = v_attempt.current_round
       AND v_attempt.current_question_id IS DISTINCT FROM p_question_id THEN
        RETURN jsonb_build_object('outcome', 'duplicate', 'state', public.attempt_build_state(p_attempt_id, v_now));
    END IF;

    IF v_attempt.current_question_id IS DISTINCT FROM p_question_id THEN
        RAISE EXCEPTION USING MESSAGE = 'NOT_CURRENT_QUESTION', DETAIL = '{"message":"Это не текущий вопрос."}';
    END IF;

    v_elapsed_ms := EXTRACT(EPOCH FROM (v_now - v_attempt.question_opened_at)) * 1000;

    IF v_elapsed_ms < v_question_time_ms - v_skip_tolerance_ms THEN
        RAISE EXCEPTION USING MESSAGE = 'TOO_EARLY',
            DETAIL = jsonb_build_object(
                'message', 'Время на вопрос ещё не истекло.',
                'remainingMs', GREATEST(0, FLOOR(v_question_time_ms - v_elapsed_ms))::integer
            )::text;
    END IF;

    PERFORM public.attempt_mark_skipped(
        v_attempt.id, v_attempt.current_question_id, v_attempt.current_round, v_attempt.question_opened_at, v_now
    );
    PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);
    RETURN jsonb_build_object('outcome', 'skipped', 'state', public.attempt_build_state(p_attempt_id, v_now));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_retry_round(p_user_id uuid, p_attempt_id bigint, p_from_round smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_skipped_count integer;
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, true);

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_COMPLETED', DETAIL = '{"message":"Попытка уже завершена."}';
    END IF;

    -- Идемпотентность: круг уже начат этим же запросом
    IF p_from_round IS NOT NULL AND v_attempt.current_round = p_from_round + 1 THEN
        RETURN public.attempt_state(p_user_id, p_attempt_id);
    END IF;

    IF p_from_round IS NOT NULL AND p_from_round <> v_attempt.current_round THEN
        RAISE EXCEPTION USING MESSAGE = 'ROUND_MISMATCH', DETAIL = '{"message":"Номер круга не совпадает с состоянием попытки."}';
    END IF;

    PERFORM public.attempt_reconcile(p_attempt_id, v_now);
    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;

    IF v_attempt.current_question_id IS NOT NULL THEN
        RAISE EXCEPTION USING MESSAGE = 'ROUND_NOT_FINISHED', DETAIL = '{"message":"Текущий круг ещё не закончен."}';
    END IF;

    SELECT COUNT(*) INTO v_skipped_count
      FROM public.answers
     WHERE attempt_id = p_attempt_id AND status = 'skipped';

    IF v_skipped_count = 0 THEN
        RAISE EXCEPTION USING MESSAGE = 'NO_SKIPPED_QUESTIONS', DETAIL = '{"message":"Пропущенных вопросов нет."}';
    END IF;

    UPDATE public.test_attempts
       SET current_round = current_round + 1
     WHERE id = p_attempt_id;

    PERFORM public.attempt_open_next(p_attempt_id, (v_attempt.current_round + 1)::smallint, v_now);
    RETURN jsonb_build_object('state', public.attempt_build_state(p_attempt_id, v_now));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_finish(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_now timestamptz := clock_timestamp();
    v_total_questions integer;
    v_answered_count integer;
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, true);

    -- Повторный вызов возвращает уже сохранённый результат
    IF v_attempt.status = 'completed' THEN
        RETURN jsonb_build_object('result', public.attempt_build_result(p_attempt_id));
    END IF;

    v_total_questions := (SELECT COUNT(*) FROM public.questions);
    v_answered_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = p_attempt_id AND status = 'answered');

    IF v_answered_count < v_total_questions THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_INCOMPLETE',
            DETAIL = jsonb_build_object(
                'message', 'Ответы есть не на все вопросы.',
                'missingQuestionIds', to_jsonb(public.attempt_missing_questions(p_attempt_id))
            )::text;
    END IF;

    INSERT INTO public.attempt_results (attempt_id, category_id, raw_score, display_score, rank_position)
    SELECT p_attempt_id, s."categoryId", s."rawScore", s."displayScore", s."rank"
      FROM jsonb_to_recordset(public.attempt_calculate_scores(p_attempt_id)) AS s(
               "categoryId" smallint,
               "rawScore" smallint,
               "displayScore" smallint,
               "rank" smallint
           )
    ON CONFLICT (attempt_id, category_id) DO UPDATE
       SET raw_score     = EXCLUDED.raw_score,
           display_score = EXCLUDED.display_score,
           rank_position = EXCLUDED.rank_position;

    UPDATE public.test_attempts
       SET status = 'completed',
           completed_at = v_now,
           calculated_at = v_now,
           answered_count = v_answered_count,
           current_question_id = NULL,
           question_opened_at = NULL
     WHERE id = p_attempt_id;

    RETURN jsonb_build_object('result', public.attempt_build_result(p_attempt_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_result(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
BEGIN
    v_attempt := public.attempt_require_owner(p_user_id, p_attempt_id, false);

    IF v_attempt.status <> 'completed' THEN
        RAISE EXCEPTION USING MESSAGE = 'ATTEMPT_NOT_COMPLETED', DETAIL = '{"message":"Тест ещё не завершён."}';
    END IF;

    RETURN jsonb_build_object('result', public.attempt_build_result(p_attempt_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_latest_completed_result(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt_id bigint;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Войдите в систему."}';
    END IF;

    SELECT id
      INTO v_attempt_id
      FROM public.test_attempts
     WHERE user_id = p_user_id
       AND status = 'completed'
     ORDER BY completed_at DESC, id DESC
     LIMIT 1;

    IF v_attempt_id IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object('result', public.attempt_build_result(v_attempt_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_completed_results(p_user_id uuid, p_page integer, p_page_size integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_page integer := GREATEST(COALESCE(p_page, 1), 1);
    v_page_size integer := LEAST(GREATEST(COALESCE(p_page_size, 10), 1), 100);
    v_total integer;
    v_items jsonb;
BEGIN
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION USING MESSAGE = 'AUTH_REQUIRED', DETAIL = '{"message":"Войдите в систему."}';
    END IF;

    SELECT COUNT(*) INTO v_total
      FROM public.test_attempts
     WHERE user_id = p_user_id AND status = 'completed';

    SELECT COALESCE(jsonb_agg(public.attempt_build_result(pa.id) ORDER BY pa.completed_at DESC, pa.id DESC), '[]'::jsonb)
      INTO v_items
      FROM (
          SELECT id, completed_at
            FROM public.test_attempts
           WHERE user_id = p_user_id AND status = 'completed'
           ORDER BY completed_at DESC, id DESC
           LIMIT v_page_size
          OFFSET (v_page - 1) * v_page_size
      ) pa;

    RETURN jsonb_build_object(
        'items', v_items,
        'page', v_page,
        'pageSize', v_page_size,
        'total', v_total
    );
END;
$$;

-- ───────────────────────── Права ─────────────────────────
-- Служебные функции нельзя вызывать через API (раньше любой, даже без входа, мог
-- переключать вопросы в чужих попытках через /rpc/attempt_open_next).
REVOKE ALL ON FUNCTION public.attempt_mark_skipped(bigint, smallint, smallint, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_open_next(bigint, smallint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_reconcile(bigint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_round_progress(bigint, smallint, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_missing_questions(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_calculate_scores(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_require_owner(uuid, bigint, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_build_state(bigint, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_build_result(bigint) FROM PUBLIC, anon, authenticated;

-- Публичные RPC — только для вошедших пользователей (проверка владельца — внутри функций).
REVOKE ALL ON FUNCTION public.attempt_state(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_active_state(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_create(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_answer(uuid, bigint, smallint, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_skip(uuid, bigint, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_retry_round(uuid, bigint, smallint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_finish(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_result(uuid, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_latest_completed_result(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attempt_completed_results(uuid, integer, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.attempt_state(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_active_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_create(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_answer(uuid, bigint, smallint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_skip(uuid, bigint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_retry_round(uuid, bigint, smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_finish(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_result(uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_latest_completed_result(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_completed_results(uuid, integer, integer) TO authenticated;

-- Обновить кэш схемы PostgREST, чтобы изменения RPC сразу стали видны API.
NOTIFY pgrst, 'reload schema';

COMMIT;
