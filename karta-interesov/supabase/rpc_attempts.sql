BEGIN;

CREATE OR REPLACE FUNCTION public.attempt_load_for_update(p_attempt_id bigint)
RETURNS TABLE (
    id bigint,
    user_id uuid,
    client_attempt_id text,
    test_version text,
    region_id smallint,
    status text,
    current_round smallint,
    current_question_id smallint,
    question_opened_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    answered_count smallint,
    calculated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT a.id,
           a.user_id,
           a.client_attempt_id,
           a.test_version,
           a.region_id,
           a.status,
           a.current_round,
           a.current_question_id,
           a.question_opened_at,
           a.started_at,
           a.completed_at,
           a.answered_count,
           a.calculated_at
      FROM public.test_attempts a
     WHERE a.id = p_attempt_id
     FOR UPDATE;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_find_answer(p_attempt_id bigint, p_question_id smallint)
RETURNS TABLE (
    id bigint,
    attempt_id bigint,
    question_id smallint,
    status text,
    value smallint,
    last_round smallint,
    skip_count smallint,
    shown_at timestamptz,
    resolved_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT a.id,
           a.attempt_id,
           a.question_id,
           a.status,
           a.value,
           a.last_round,
           a.skip_count,
           a.shown_at,
           a.resolved_at
      FROM public.answers a
     WHERE a.attempt_id = p_attempt_id
       AND a.question_id = p_question_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_reconcile(p_attempt_id bigint, p_now timestamptz)
RETURNS TABLE (
    id bigint,
    user_id uuid,
    client_attempt_id text,
    test_version text,
    region_id smallint,
    status text,
    current_round smallint,
    current_question_id smallint,
    question_opened_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    answered_count smallint,
    calculated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt public.test_attempts%ROWTYPE;
    v_question_opened timestamptz;
    v_elapsed_ms bigint;
BEGIN
    SELECT *
      INTO v_attempt
      FROM public.test_attempts
     WHERE id = p_attempt_id
     FOR UPDATE;

    IF v_attempt.id IS NULL THEN
        RETURN;
    END IF;

    IF v_attempt.status <> 'in_progress' OR v_attempt.current_question_id IS NULL THEN
        RETURN QUERY
        SELECT a.id,
               a.user_id,
               a.client_attempt_id,
               a.test_version,
               a.region_id,
               a.status,
               a.current_round,
               a.current_question_id,
               a.question_opened_at,
               a.started_at,
               a.completed_at,
               a.answered_count,
               a.calculated_at
          FROM public.test_attempts a
         WHERE a.id = p_attempt_id;
        RETURN;
    END IF;

    v_question_opened := v_attempt.question_opened_at;
    v_elapsed_ms := EXTRACT(EPOCH FROM (p_now - v_question_opened)) * 1000;

    IF v_elapsed_ms >= 15000 + 1000 THEN
        INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
        SELECT v_attempt.id,
               v_attempt.current_question_id,
               'skipped',
               NULL,
               v_attempt.current_round,
               1,
               v_question_opened,
               p_now
        WHERE NOT EXISTS (
            SELECT 1
              FROM public.answers a
             WHERE a.attempt_id = v_attempt.id
               AND a.question_id = v_attempt.current_question_id
        )
        ON CONFLICT (attempt_id, question_id) DO UPDATE
           SET last_round = EXCLUDED.last_round,
               skip_count = public.answers.skip_count + 1,
               shown_at = EXCLUDED.shown_at,
               resolved_at = EXCLUDED.resolved_at;

        PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, p_now);
    END IF;

    RETURN QUERY
    SELECT a.id,
           a.user_id,
           a.client_attempt_id,
           a.test_version,
           a.region_id,
           a.status,
           a.current_round,
           a.current_question_id,
           a.question_opened_at,
           a.started_at,
           a.completed_at,
           a.answered_count,
           a.calculated_at
      FROM public.test_attempts a
     WHERE a.id = p_attempt_id;
END;
$$;

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

    IF v_next_question_id IS NULL THEN
        UPDATE public.test_attempts
           SET current_question_id = NULL,
               question_opened_at = NULL
         WHERE id = p_attempt_id;
    ELSE
        UPDATE public.test_attempts
           SET current_question_id = v_next_question_id,
               question_opened_at = p_now
         WHERE id = p_attempt_id;
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

CREATE OR REPLACE FUNCTION public.attempt_state(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_now timestamptz;
    v_query_total integer;
    v_answered_count integer;
    v_skipped_count integer;
    v_answers jsonb;
    v_skipped_ids jsonb;
    v_current_question jsonb;
    v_round_progress jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT *
      INTO v_attempt
      FROM public.test_attempts
     WHERE id = p_attempt_id
     FOR UPDATE;

    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    v_now := now();
    SELECT * INTO v_attempt FROM public.attempt_reconcile(v_attempt.id, v_now) LIMIT 1;

    v_query_total := (SELECT COUNT(*) FROM public.questions);
    v_answered_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = v_attempt.id AND status = 'answered');
    v_skipped_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = v_attempt.id AND status = 'skipped');

    v_answers := COALESCE(
        (
            SELECT jsonb_agg(
                       jsonb_build_object(
                           'questionId', a.question_id,
                           'value', a.value
                       )
                       ORDER BY a.question_id
                   )
              FROM public.answers a
             WHERE a.attempt_id = v_attempt.id
               AND a.status = 'answered'
        ),
        '[]'::jsonb
    );

    v_skipped_ids := COALESCE(
        (
            SELECT jsonb_agg(a.question_id ORDER BY a.question_id)
              FROM public.answers a
             WHERE a.attempt_id = v_attempt.id
               AND a.status = 'skipped'
        ),
        '[]'::jsonb
    );

    IF v_attempt.current_question_id IS NOT NULL AND v_attempt.question_opened_at IS NOT NULL THEN
        v_current_question := jsonb_build_object(
            'questionId', v_attempt.current_question_id,
            'openedAt', v_attempt.question_opened_at,
            'deadlineAt', v_attempt.question_opened_at + (15000 || ' milliseconds')::interval,
            'timeLimitMs', 15000,
            'remainingMs', GREATEST(0, LEAST(15000, EXTRACT(EPOCH FROM ((v_attempt.question_opened_at + (15000 || ' milliseconds')::interval) - v_now)) * 1000::numeric::bigint))
        );
    ELSE
        v_current_question := 'null'::jsonb;
    END IF;

    v_round_progress := CASE
        WHEN v_attempt.status = 'in_progress' THEN
            public.attempt_round_progress(v_attempt.id, v_attempt.current_round, v_query_total, v_attempt.current_question_id IS NOT NULL)
        ELSE
            NULL
    END;

    RETURN jsonb_build_object(
        'state', jsonb_build_object(
            'attemptId', v_attempt.id::text,
            'clientAttemptId', v_attempt.client_attempt_id,
            'testVersion', v_attempt.test_version,
            'status', v_attempt.status,
            'round', v_attempt.current_round,
            'totalQuestions', v_query_total,
            'answeredCount', v_answered_count,
            'skippedCount', v_skipped_count,
            'roundFinished', v_attempt.status = 'in_progress' AND v_attempt.current_question_id IS NULL,
            'canFinish', v_attempt.status = 'in_progress' AND v_answered_count = v_query_total,
            'currentQuestion', v_current_question,
            'answers', v_answers,
            'skippedQuestionIds', v_skipped_ids,
            'roundProgress', v_round_progress,
            'startedAt', v_attempt.started_at,
            'completedAt', v_attempt.completed_at,
            'serverTime', v_now
        )
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_active_state(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt_id bigint;
    v_state jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT id
      INTO v_attempt_id
      FROM public.test_attempts
     WHERE user_id = p_user_id
       AND status = 'in_progress'
     ORDER BY id DESC
     LIMIT 1;

    IF v_attempt_id IS NULL THEN
        RAISE EXCEPTION 'NO_ACTIVE_ATTEMPT';
    END IF;

    SELECT public.attempt_state(p_user_id, v_attempt_id) INTO v_state;
    RETURN v_state;
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
    v_expected_version text := 'golomshtok-174-v1';
    v_region_id smallint;
    v_existing_id bigint;
    v_attempt_id bigint;
    v_attempt_state jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    IF p_test_version IS NOT NULL AND p_test_version <> v_expected_version THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Неподдерживаемая версия теста. Ожидается %', v_expected_version;
    END IF;

    IF p_region_code IS NOT NULL THEN
        SELECT r.id INTO v_region_id
          FROM public.regions r
         WHERE r.code = p_region_code;

        IF v_region_id IS NULL THEN
            RAISE EXCEPTION 'VALIDATION_ERROR: Неизвестный регион.';
        END IF;
    ELSE
        SELECT pr.region_id INTO v_region_id
          FROM public.profiles pr
         WHERE pr.id = p_user_id;
    END IF;

    SELECT id
      INTO v_existing_id
      FROM public.test_attempts
     WHERE user_id = p_user_id
       AND client_attempt_id = p_client_attempt_id;

    IF v_existing_id IS NOT NULL THEN
        SELECT public.attempt_state(p_user_id, v_existing_id) INTO v_attempt_state;
        RETURN jsonb_build_object('created', false, 'state', v_attempt_state->'state');
    END IF;

    BEGIN
        INSERT INTO public.test_attempts (
            user_id,
            client_attempt_id,
            test_version,
            region_id,
            status,
            current_round,
            started_at
        )
        VALUES (
            p_user_id,
            p_client_attempt_id,
            v_expected_version,
            v_region_id,
            'in_progress',
            1,
            now()
        )
        RETURNING id INTO v_attempt_id;

        PERFORM public.attempt_open_next(v_attempt_id, 1, now());

        SELECT public.attempt_state(p_user_id, v_attempt_id) INTO v_attempt_state;
        RETURN jsonb_build_object('created', true, 'state', v_attempt_state->'state');
    EXCEPTION
        WHEN unique_violation THEN
            SELECT id INTO v_existing_id
              FROM public.test_attempts
             WHERE user_id = p_user_id
               AND client_attempt_id = p_client_attempt_id;

            IF v_existing_id IS NOT NULL THEN
                SELECT public.attempt_state(p_user_id, v_existing_id) INTO v_attempt_state;
                RETURN jsonb_build_object('created', false, 'state', v_attempt_state->'state');
            END IF;

            RAISE;
    END;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_answer(p_user_id uuid, p_attempt_id bigint, p_question_id smallint, p_value smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_existing record;
    v_now timestamptz;
    v_opened timestamptz;
    v_elapsed_ms bigint;
    v_state jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION 'ATTEMPT_COMPLETED';
    END IF;

    SELECT * INTO v_existing FROM public.answers WHERE attempt_id = p_attempt_id AND question_id = p_question_id;
    IF v_existing.id IS NOT NULL AND v_existing.status = 'answered' THEN
        IF v_existing.value = p_value THEN
            SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
            RETURN jsonb_build_object('outcome', 'duplicate', 'state', v_state->'state');
        END IF;
        RAISE EXCEPTION 'ANSWER_ALREADY_FIXED';
    END IF;

    IF v_attempt.current_question_id IS NULL OR v_attempt.current_question_id <> p_question_id THEN
        RAISE EXCEPTION 'NOT_CURRENT_QUESTION';
    END IF;

    v_now := now();
    v_opened := v_attempt.question_opened_at;
    v_elapsed_ms := EXTRACT(EPOCH FROM (v_now - v_opened)) * 1000;

    IF v_elapsed_ms > (15000 + 1000) THEN
        INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
        SELECT v_attempt.id, v_attempt.current_question_id, 'skipped', NULL, v_attempt.current_round, 1, v_opened, v_now
        WHERE NOT EXISTS (
            SELECT 1
              FROM public.answers a
             WHERE a.attempt_id = v_attempt.id
               AND a.question_id = v_attempt.current_question_id
        )
        ON CONFLICT (attempt_id, question_id) DO UPDATE
           SET last_round = EXCLUDED.last_round,
               skip_count = public.answers.skip_count + 1,
               shown_at = EXCLUDED.shown_at,
               resolved_at = EXCLUDED.resolved_at;

        PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);

        SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
        RETURN jsonb_build_object('outcome', 'expired', 'state', v_state->'state');
    END IF;

    IF v_existing.id IS NULL THEN
        INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
        VALUES (p_attempt_id, p_question_id, 'answered', p_value, v_attempt.current_round, 0, v_opened, v_now);
    ELSE
        UPDATE public.answers
           SET status = 'answered',
               value = p_value,
               last_round = v_attempt.current_round,
               shown_at = v_opened,
               resolved_at = v_now
         WHERE attempt_id = p_attempt_id
           AND question_id = p_question_id
           AND status = 'skipped';
    END IF;

    PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);

    SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
    RETURN jsonb_build_object('outcome', 'accepted', 'state', v_state->'state');
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_skip(p_user_id uuid, p_attempt_id bigint, p_question_id smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_existing record;
    v_opened timestamptz;
    v_now timestamptz;
    v_elapsed_ms bigint;
    v_min_elapsed_ms bigint;
    v_state jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION 'ATTEMPT_COMPLETED';
    END IF;

    SELECT * INTO v_existing FROM public.answers WHERE attempt_id = p_attempt_id AND question_id = p_question_id;
    IF v_existing.id IS NOT NULL AND v_existing.status = 'answered' THEN
        RAISE EXCEPTION 'ANSWER_ALREADY_FIXED';
    END IF;

    IF v_existing.id IS NOT NULL AND v_existing.last_round = v_attempt.current_round AND v_attempt.current_question_id <> p_question_id THEN
        SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
        RETURN jsonb_build_object('outcome', 'duplicate', 'state', v_state->'state');
    END IF;

    IF v_attempt.current_question_id IS NULL OR v_attempt.current_question_id <> p_question_id THEN
        RAISE EXCEPTION 'NOT_CURRENT_QUESTION';
    END IF;

    v_now := now();
    v_opened := v_attempt.question_opened_at;
    v_elapsed_ms := EXTRACT(EPOCH FROM (v_now - v_opened)) * 1000;
    v_min_elapsed_ms := 15000 - 1000;

    IF v_elapsed_ms < v_min_elapsed_ms THEN
        RAISE EXCEPTION 'TOO_EARLY';
    END IF;

    INSERT INTO public.answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
    SELECT v_attempt.id, v_attempt.current_question_id, 'skipped', NULL, v_attempt.current_round, 1, v_opened, v_now
    WHERE NOT EXISTS (
        SELECT 1
          FROM public.answers a
         WHERE a.attempt_id = v_attempt.id
           AND a.question_id = v_attempt.current_question_id
    )
    ON CONFLICT (attempt_id, question_id) DO UPDATE
       SET last_round = EXCLUDED.last_round,
           skip_count = public.answers.skip_count + 1,
           shown_at = EXCLUDED.shown_at,
           resolved_at = EXCLUDED.resolved_at;

    PERFORM public.attempt_open_next(v_attempt.id, v_attempt.current_round, v_now);

    SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
    RETURN jsonb_build_object('outcome', 'skipped', 'state', v_state->'state');
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_retry_round(p_user_id uuid, p_attempt_id bigint, p_from_round smallint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_now timestamptz;
    v_state jsonb;
    v_skipped_count integer;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    IF v_attempt.status <> 'in_progress' THEN
        RAISE EXCEPTION 'ATTEMPT_COMPLETED';
    END IF;

    IF p_from_round IS NOT NULL AND v_attempt.current_round = p_from_round + 1 THEN
        SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
        RETURN v_state;
    END IF;

    IF p_from_round IS NOT NULL AND p_from_round <> v_attempt.current_round THEN
        RAISE EXCEPTION 'ROUND_MISMATCH';
    END IF;

    IF v_attempt.current_question_id IS NOT NULL THEN
        RAISE EXCEPTION 'ROUND_NOT_FINISHED';
    END IF;

    SELECT COUNT(*) INTO v_skipped_count
      FROM public.answers
     WHERE attempt_id = p_attempt_id
       AND status = 'skipped';

    IF v_skipped_count = 0 THEN
        RAISE EXCEPTION 'NO_SKIPPED_QUESTIONS';
    END IF;

    v_now := now();
    UPDATE public.test_attempts
       SET current_round = current_round + 1
     WHERE id = p_attempt_id;

    PERFORM public.attempt_open_next(p_attempt_id, v_attempt.current_round + 1, v_now);

    SELECT public.attempt_state(p_user_id, p_attempt_id) INTO v_state;
    RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_finish(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_now timestamptz;
    v_total_questions integer;
    v_answered_count integer;
    v_missing smallint[];
    v_result jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id FOR UPDATE;
    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    IF v_attempt.status = 'completed' THEN
        SELECT public.attempt_result(p_user_id, p_attempt_id) INTO v_result;
        RETURN v_result;
    END IF;

    v_now := now();
    SELECT * INTO v_attempt FROM public.attempt_reconcile(v_attempt.id, v_now) LIMIT 1;

    v_total_questions := (SELECT COUNT(*) FROM public.questions);
    v_answered_count := (SELECT COUNT(*) FROM public.answers WHERE attempt_id = p_attempt_id AND status = 'answered');

    IF v_answered_count < v_total_questions THEN
        v_missing := public.attempt_missing_questions(p_attempt_id);
        RAISE EXCEPTION 'ATTEMPT_INCOMPLETE';
    END IF;

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
    ranked AS (
        SELECT c.id AS category_id,
               COALESCE(rs.raw_score, 0) AS raw_score,
               ROUND(((COALESCE(rs.raw_score, 0) + 12)::numeric / 24) * 100)::int AS display_score,
               ROW_NUMBER() OVER (ORDER BY COALESCE(rs.raw_score, 0) DESC, c.id ASC) AS rank_position
          FROM public.categories c
          LEFT JOIN raw_scores rs ON rs.category_id = c.id
    )
    INSERT INTO public.attempt_results (attempt_id, category_id, raw_score, display_score, rank_position)
    SELECT p_attempt_id,
           category_id,
           raw_score,
           display_score,
           rank_position
      FROM ranked
    ON CONFLICT (attempt_id, category_id)
    DO UPDATE SET raw_score = EXCLUDED.raw_score,
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

    SELECT public.attempt_result(p_user_id, p_attempt_id) INTO v_result;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_result(p_user_id uuid, p_attempt_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_attempt record;
    v_scores jsonb;
    v_top jsonb;
    v_result jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    SELECT * INTO v_attempt FROM public.test_attempts WHERE id = p_attempt_id;
    IF v_attempt.id IS NULL OR v_attempt.user_id <> p_user_id THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_FOUND';
    END IF;

    IF v_attempt.status <> 'completed' THEN
        RAISE EXCEPTION 'ATTEMPT_NOT_COMPLETED';
    END IF;

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

    v_result := jsonb_build_object(
        'attemptId', v_attempt.id::text,
        'testVersion', v_attempt.test_version,
        'answeredCount', v_attempt.answered_count,
        'persisted', true,
        'calculatedAt', v_attempt.calculated_at,
        'completedAt', v_attempt.completed_at,
        'topCategoryIds', COALESCE(v_top, '[]'::jsonb),
        'scores', COALESCE(v_scores, '[]'::jsonb)
    );

    RETURN jsonb_build_object('result', v_result);
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
    v_result jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
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

    SELECT public.attempt_result(p_user_id, v_attempt_id) INTO v_result;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_completed_results(p_user_id uuid, p_page integer, p_page_size integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_total integer;
    v_offset integer;
    v_items jsonb;
BEGIN
    IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
        RAISE EXCEPTION 'AUTH_REQUIRED';
    END IF;

    IF p_page IS NULL OR p_page < 1 THEN
        p_page := 1;
    END IF;

    IF p_page_size IS NULL OR p_page_size < 1 THEN
        p_page_size := 10;
    END IF;

    v_total := (
        SELECT COUNT(*)
          FROM public.test_attempts
         WHERE user_id = p_user_id
           AND status = 'completed'
    );

    v_offset := (p_page - 1) * p_page_size;

    WITH page_attempts AS (
        SELECT id
          FROM public.test_attempts
         WHERE user_id = p_user_id
           AND status = 'completed'
         ORDER BY completed_at DESC, id DESC
         LIMIT p_page_size
        OFFSET v_offset
    )
    SELECT COALESCE(
               jsonb_agg((public.attempt_result(p_user_id, pa.id))->'result' ORDER BY (SELECT completed_at FROM public.test_attempts WHERE id = pa.id) DESC, pa.id DESC),
               '[]'::jsonb
           )
      INTO v_items
      FROM page_attempts pa;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'page', p_page,
        'pageSize', p_page_size,
        'total', v_total
    );
END;
$$;

COMMIT;
