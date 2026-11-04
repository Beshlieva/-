import { supabase } from './supabase';
import type { ServerAttemptState, TestResult, UserTestResult } from '../types';

export interface CreateAttemptInput {
  clientAttemptId: string;
  testVersion?: string;
  regionCode?: string | null;
}

export interface AnswerInput {
  attemptId: string | number;
  questionId: number;
  value: number;
}

export interface SkipInput {
  attemptId: string | number;
  questionId: number;
}

export interface StartRetryRoundInput {
  attemptId: string | number;
  fromRound?: number | null;
}

export interface StepOutcome {
  outcome: 'accepted' | 'duplicate' | 'expired' | 'skipped';
  state: ServerAttemptState;
}

export interface CompletedResultsPage {
  items: UserTestResult[];
  page: number;
  pageSize: number;
  total: number;
}

const QUESTION_TIME_MS = 15000;
const ANSWER_GRACE_MS = 1000;
const TEST_VERSION = 'golomshtok-174-v1';

function normalizeAttemptState(raw: any): ServerAttemptState {
  const currentQuestion = raw?.currentQuestion ?? null;
  return {
    attemptId: String(raw?.attemptId ?? raw?.id ?? ''),
    clientAttemptId: String(raw?.clientAttemptId ?? raw?.client_attempt_id ?? ''),
    testVersion: String(raw?.testVersion ?? raw?.test_version ?? TEST_VERSION),
    status: raw?.status === 'completed' ? 'completed' : 'in_progress',
    round: Number(raw?.round ?? raw?.current_round ?? 1),
    totalQuestions: Number(raw?.totalQuestions ?? raw?.total_questions ?? 0),
    answeredCount: Number(raw?.answeredCount ?? raw?.answered_count ?? 0),
    skippedCount: Number(raw?.skippedCount ?? raw?.skipped_count ?? 0),
    roundFinished: Boolean(raw?.roundFinished ?? raw?.round_finished ?? false),
    canFinish: Boolean(raw?.canFinish ?? raw?.can_finish ?? false),
    currentQuestion: currentQuestion
      ? {
          questionId: Number(currentQuestion.questionId ?? currentQuestion.question_id ?? 0),
          openedAt: String(currentQuestion.openedAt ?? currentQuestion.opened_at ?? ''),
          deadlineAt: String(currentQuestion.deadlineAt ?? currentQuestion.deadline_at ?? ''),
          timeLimitMs: Number(currentQuestion.timeLimitMs ?? currentQuestion.time_limit_ms ?? QUESTION_TIME_MS),
          remainingMs: Number(currentQuestion.remainingMs ?? currentQuestion.remaining_ms ?? 0),
        }
      : null,
    answers: Array.isArray(raw?.answers) ? raw.answers.map((a: any) => ({
      questionId: Number(a?.questionId ?? a?.question_id ?? 0),
      value: Number(a?.value ?? 0),
    })) : [],
    skippedQuestionIds: Array.isArray(raw?.skippedQuestionIds)
      ? raw.skippedQuestionIds.map((id: any) => Number(id))
      : [],
    roundProgress: raw?.roundProgress ?? null,
    startedAt: String(raw?.startedAt ?? raw?.started_at ?? new Date().toISOString()),
    completedAt: raw?.completedAt ?? raw?.completed_at ?? null,
  } as ServerAttemptState;
}

function normalizeTestResult(raw: any): TestResult {
  return {
    attemptId: String(raw?.attemptId ?? raw?.attempt_id ?? ''),
    testVersion: String(raw?.testVersion ?? raw?.test_version ?? TEST_VERSION),
    answeredCount: Number(raw?.answeredCount ?? raw?.answered_count ?? 0),
    scores: Array.isArray(raw?.scores) ? raw.scores.map((row: any) => ({
      categoryId: Number(row?.categoryId ?? row?.category_id ?? 0),
      rawScore: Number(row?.rawScore ?? row?.raw_score ?? 0),
      displayScore: Number(row?.displayScore ?? row?.display_score ?? 0),
    })) : [],
    calculatedAt: String(raw?.calculatedAt ?? raw?.calculated_at ?? new Date().toISOString()),
    source: raw?.source === 'local' ? 'local' : 'server',
    persisted: raw?.persisted ?? true,
    completedAt: String(raw?.completedAt ?? raw?.completed_at ?? new Date().toISOString()),
    topCategoryIds: Array.isArray(raw?.topCategoryIds)
      ? raw.topCategoryIds.map((id: any) => Number(id))
      : [],
  } as TestResult & UserTestResult;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('AUTH_REQUIRED');
  return data.user.id;
}

async function rpcOrThrow<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args as any);
  if (error) throw error;
  return data as T;
}

export class AttemptServiceSupabase {
  async createAttempt(input: CreateAttemptInput): Promise<ServerAttemptState> {
    const userId = await requireUserId();
    const payload = {
      p_user_id: userId,
      p_client_attempt_id: input.clientAttemptId,
      p_test_version: input.testVersion ?? TEST_VERSION,
      p_region_code: input.regionCode ?? null,
    };

    const data = await rpcOrThrow<any>('attempt_create', payload);
    return normalizeAttemptState(data?.state ?? data);
  }

  async state(attemptId: string | number): Promise<ServerAttemptState> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_state', {
      p_user_id: userId,
      p_attempt_id: Number(attemptId),
    });
    return normalizeAttemptState(data?.state ?? data);
  }

  async activeState(): Promise<ServerAttemptState | null> {
    const userId = await requireUserId();
    try {
      const data = await rpcOrThrow<any>('attempt_active_state', { p_user_id: userId });
      return data ? normalizeAttemptState(data?.state ?? data) : null;
    } catch (error: any) {
      if (error?.code === 'PGRST116' || error?.message?.includes('NO_ACTIVE_ATTEMPT')) {
        return null;
      }
      throw error;
    }
  }

  async answer(input: AnswerInput): Promise<StepOutcome> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_answer', {
      p_user_id: userId,
      p_attempt_id: Number(input.attemptId),
      p_question_id: Number(input.questionId),
      p_value: Number(input.value),
    });

    const state = normalizeAttemptState(data?.state ?? data);
    const outcome = String(data?.outcome ?? 'accepted');
    return {
      outcome: outcome === 'duplicate' || outcome === 'expired' || outcome === 'skipped' ? outcome : 'accepted',
      state,
    };
  }

  async skip(input: SkipInput): Promise<StepOutcome> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_skip', {
      p_user_id: userId,
      p_attempt_id: Number(input.attemptId),
      p_question_id: Number(input.questionId),
    });

    const state = normalizeAttemptState(data?.state ?? data);
    const outcome = String(data?.outcome ?? 'skipped');
    return {
      outcome: outcome === 'duplicate' ? 'duplicate' : 'skipped',
      state,
    };
  }

  async startRetryRound(input: StartRetryRoundInput): Promise<ServerAttemptState> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_retry_round', {
      p_user_id: userId,
      p_attempt_id: Number(input.attemptId),
      p_from_round: input.fromRound ?? null,
    });
    return normalizeAttemptState(data?.state ?? data);
  }

  async finish(attemptId: string | number): Promise<TestResult> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_finish', {
      p_user_id: userId,
      p_attempt_id: Number(attemptId),
    });
    return normalizeTestResult(data?.result ?? data);
  }

  async result(attemptId: string | number): Promise<TestResult> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_result', {
      p_user_id: userId,
      p_attempt_id: Number(attemptId),
    });
    return normalizeTestResult(data?.result ?? data);
  }

  async latestCompletedResult(): Promise<TestResult | null> {
    const userId = await requireUserId();
    try {
      const data = await rpcOrThrow<any>('attempt_latest_completed_result', { p_user_id: userId });
      if (!data) return null;
      return normalizeTestResult(data?.result ?? data);
    } catch (error: any) {
      if (error?.code === 'PGRST116' || error?.message?.includes('NO_COMPLETED_RESULT')) {
        return null;
      }
      throw error;
    }
  }

  async completedResults(page = 1, pageSize = 10): Promise<CompletedResultsPage> {
    const userId = await requireUserId();
    const data = await rpcOrThrow<any>('attempt_completed_results', {
      p_user_id: userId,
      p_page: Number(page),
      p_page_size: Number(pageSize),
    });

    return {
      items: Array.isArray(data?.items) ? data.items.map((item: any) => normalizeTestResult(item)) : [],
      page: Number(data?.page ?? page),
      pageSize: Number(data?.page_size ?? pageSize),
      total: Number(data?.total ?? 0),
    };
  }
}

export const attemptService = new AttemptServiceSupabase();

export default attemptService;
