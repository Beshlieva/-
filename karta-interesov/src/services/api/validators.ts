import { CATEGORIES, QUESTIONS, toDisplay } from '../../data/questions';
import { ApiError } from '../../types';
import type {
  AdminOverview,
  AdminResultDetail,
  AdminResultRow,
  AdminSession,
  AdminUserRow,
  AnalyticsSummary,
  AnswerValue,
  AttemptListItem,
  CategoryAggregate,
  CategoryScore,
  Paginated,
  RegionAggregate,
  ServerAttemptState,
  SubmitAttemptRequest,
  TestResult,
} from '../../types';

const CATEGORY_IDS = new Set(CATEGORIES.map(c => c.id));
const QUESTION_IDS = new Set(QUESTIONS.map(q => q.id));
const VALID_VALUES = new Set([-2, -1, 0, 1, 2]);
/** Максимальный по модулю балл направления: вопросов в направлении × 2 (сейчас 6 × 2 = 12). */
const MAX_RAW = 2 * Math.max(...CATEGORIES.map(c => QUESTIONS.filter(q => q.categoryId === c.id).length));

// ───────────────────────── Проверка запроса (до отправки) ─────────────────────────

export function validateSubmitRequest(req: SubmitAttemptRequest): void {
  const fail = (msg: string): never => {
    throw new ApiError('INVALID_REQUEST', `Некорректные данные для отправки: ${msg}`);
  };
  if (!req.clientAttemptId) fail('нет идентификатора попытки.');
  if (req.answers.length === 0) fail('нет ни одного ответа.');
  const seen = new Set<number>();
  for (const a of req.answers) {
    if (!QUESTION_IDS.has(a.questionId)) fail(`неизвестный вопрос ${a.questionId}.`);
    if (seen.has(a.questionId)) fail(`повторный ответ на вопрос ${a.questionId}.`);
    if (!VALID_VALUES.has(a.value)) fail(`недопустимое значение ответа на вопрос ${a.questionId}.`);
    seen.add(a.questionId);
  }
}

// ───────────────────────── Проверка ответов сервера ─────────────────────────

function bad(what: string): never {
  throw new ApiError('INVALID_RESPONSE', `Некорректный ответ сервера: ${what}.`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function num(r: Record<string, unknown>, key: string): number {
  const v = r[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) bad(`поле "${key}" должно быть числом`);
  return v as number;
}

function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  if (typeof v !== 'string' || v === '') bad(`поле "${key}" должно быть непустой строкой`);
  return v as string;
}

function optStr(r: Record<string, unknown>, key: string): string | undefined {
  const v = r[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function list(r: Record<string, unknown>, key: string): unknown[] {
  const v = r[key];
  if (!Array.isArray(v)) bad(`поле "${key}" должно быть массивом`);
  return v as unknown[];
}

/** Результат теста, пришедший с сервера. Сервер — источник истины, но структуру проверяем. */
export function parseTestResult(data: unknown): TestResult {
  if (!isRecord(data)) bad('ожидался объект');
  const d = data as Record<string, unknown>;

  const byId = new Map<number, CategoryScore>();
  for (const item of list(d, 'scores')) {
    if (!isRecord(item)) bad('элемент scores должен быть объектом');
    const r = item as Record<string, unknown>;
    const categoryId = num(r, 'categoryId');
    const rawScore = num(r, 'rawScore');
    if (!CATEGORY_IDS.has(categoryId)) bad(`неизвестное направление ${categoryId}`);
    if (!Number.isInteger(rawScore) || Math.abs(rawScore) > MAX_RAW) {
      bad(`балл направления ${categoryId} вне диапазона ±${MAX_RAW}`);
    }
    const displayScore = typeof r.displayScore === 'number' ? r.displayScore : toDisplay(rawScore);
    byId.set(categoryId, { categoryId, rawScore, displayScore });
  }
  if (byId.size !== CATEGORIES.length) bad(`ожидались баллы по всем ${CATEGORIES.length} направлениям`);

  return {
    attemptId: str(d, 'attemptId'),
    testVersion: str(d, 'testVersion'),
    answeredCount: num(d, 'answeredCount'),
    scores: CATEGORIES.map(c => byId.get(c.id) as CategoryScore),
    calculatedAt: optStr(d, 'calculatedAt') ?? new Date().toISOString(),
    source: 'server',
    persisted: d.persisted === false ? false : true,
  };
}

function parseCategoryAggregate(v: unknown): CategoryAggregate {
  if (!isRecord(v)) bad('элемент categories должен быть объектом');
  const r = v as Record<string, unknown>;
  return {
    categoryId: num(r, 'categoryId'),
    averageRawScore: num(r, 'averageRawScore'),
    averageDisplayScore: num(r, 'averageDisplayScore'),
    timesInTop5: num(r, 'timesInTop5'),
  };
}

export function parseAnalyticsSummary(data: unknown): AnalyticsSummary {
  if (!isRecord(data)) bad('ожидался объект');
  const d = data as Record<string, unknown>;
  return {
    totalAttempts: num(d, 'totalAttempts'),
    averageAnsweredCount: num(d, 'averageAnsweredCount'),
    categories: list(d, 'categories').map(parseCategoryAggregate),
  };
}

export function parseRegionStats(data: unknown): RegionAggregate[] {
  if (!isRecord(data)) bad('ожидался объект');
  return list(data as Record<string, unknown>, 'regions').map(item => {
    if (!isRecord(item)) bad('элемент regions должен быть объектом');
    const r = item as Record<string, unknown>;
    return {
      regionCode: str(r, 'regionCode'),
      attempts: num(r, 'attempts'),
      categories: list(r, 'categories').map(parseCategoryAggregate),
    };
  });
}

export function parseAttemptList(data: unknown): Paginated<AttemptListItem> {
  if (!isRecord(data)) bad('ожидался объект');
  const d = data as Record<string, unknown>;
  return {
    page: num(d, 'page'),
    pageSize: num(d, 'pageSize'),
    total: num(d, 'total'),
    items: list(d, 'items').map(item => {
      if (!isRecord(item)) bad('элемент items должен быть объектом');
      const r = item as Record<string, unknown>;
      return {
        attemptId: str(r, 'attemptId'),
        completedAt: str(r, 'completedAt'),
        regionCode: optStr(r, 'regionCode'),
        answeredCount: num(r, 'answeredCount'),
        topCategoryIds: list(r, 'topCategoryIds').filter((x): x is number => typeof x === 'number'),
      };
    }),
  };
}

function nullableStr(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return typeof v === 'string' ? v : null;
}

function nullableNum(r: Record<string, unknown>, key: string): number | null {
  const v = r[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function rec(v: unknown, what: string): Record<string, unknown> {
  if (!isRecord(v)) bad(`${what} должен быть объектом`);
  return v as Record<string, unknown>;
}

function page<T>(data: unknown, item: (r: Record<string, unknown>) => T): Paginated<T> {
  const d = rec(data, 'ответ');
  return {
    page: num(d, 'page'),
    pageSize: num(d, 'pageSize'),
    total: num(d, 'total'),
    items: list(d, 'items').map(x => item(rec(x, 'элемент items'))),
  };
}

export function parseAdminSession(data: unknown): AdminSession {
  const d = rec(data, 'ответ');
  const token = str(d, 'token');
  if (!/^[a-f0-9]{64}$/.test(token)) bad('токен администратора имеет неверный формат');
  return { token, expiresAt: str(d, 'expiresAt') };
}

export function parseAdminOverview(data: unknown): AdminOverview {
  const d = rec(data, 'ответ');
  return {
    totalUsers: num(d, 'totalUsers'),
    startedAttempts: num(d, 'startedAttempts'),
    completedAttempts: num(d, 'completedAttempts'),
    usersByRegion: list(d, 'usersByRegion').map(x => {
      const r = rec(x, 'элемент usersByRegion');
      return { regionCode: str(r, 'regionCode'), users: num(r, 'users') };
    }),
  };
}

export function parseAdminUsers(data: unknown): Paginated<AdminUserRow> {
  return page(data, r => ({
    userId: str(r, 'userId'),
    name: nullableStr(r, 'name'),
    email: nullableStr(r, 'email'),
    age: nullableNum(r, 'age'),
    regionCode: nullableStr(r, 'regionCode'),
    registeredAt: str(r, 'registeredAt'),
    startedAttempts: num(r, 'startedAttempts'),
    completedAttempts: num(r, 'completedAttempts'),
    lastCompletedAttemptId: nullableStr(r, 'lastCompletedAttemptId'),
  }));
}

export function parseAdminResults(data: unknown): Paginated<AdminResultRow> {
  return page(data, r => ({
    attemptId: str(r, 'attemptId'),
    completedAt: str(r, 'completedAt'),
    answeredCount: num(r, 'answeredCount'),
    name: nullableStr(r, 'name'),
    email: nullableStr(r, 'email'),
    age: nullableNum(r, 'age'),
    regionCode: nullableStr(r, 'regionCode'),
    topCategoryIds: list(r, 'topCategoryIds').filter((x): x is number => typeof x === 'number'),
  }));
}

export function parseAdminResultDetail(data: unknown): AdminResultDetail {
  const d = rec(data, 'ответ');
  return {
    attemptId: str(d, 'attemptId'),
    testVersion: str(d, 'testVersion'),
    startedAt: str(d, 'startedAt'),
    completedAt: str(d, 'completedAt'),
    answeredCount: num(d, 'answeredCount'),
    name: nullableStr(d, 'name'),
    email: nullableStr(d, 'email'),
    age: nullableNum(d, 'age'),
    regionCode: nullableStr(d, 'regionCode'),
    scores: list(d, 'scores').map(x => {
      const r = rec(x, 'элемент scores');
      const categoryId = num(r, 'categoryId');
      if (!CATEGORY_IDS.has(categoryId)) bad(`неизвестное направление ${categoryId}`);
      return { categoryId, rawScore: num(r, 'rawScore'), displayScore: num(r, 'displayScore'), rank: num(r, 'rank') };
    }),
  };
}

/** Состояние попытки с сервера (POST /attempts, GET /attempts/{id}, ответы, пропуски, повторный круг). */
export function parseAttemptState(data: unknown): ServerAttemptState {
  if (!isRecord(data)) bad('ожидался объект состояния попытки');
  const d = data as Record<string, unknown>;

  const status = d.status;
  if (status !== 'in_progress' && status !== 'completed') bad('неизвестный статус попытки');

  let currentQuestion: ServerAttemptState['currentQuestion'] = null;
  if (d.currentQuestion !== null && d.currentQuestion !== undefined) {
    if (!isRecord(d.currentQuestion)) bad('currentQuestion должен быть объектом или null');
    const c = d.currentQuestion as Record<string, unknown>;
    const questionId = num(c, 'questionId');
    if (!QUESTION_IDS.has(questionId)) bad(`неизвестный вопрос ${questionId}`);
    currentQuestion = {
      questionId,
      openedAt: str(c, 'openedAt'),
      deadlineAt: str(c, 'deadlineAt'),
      timeLimitMs: num(c, 'timeLimitMs'),
      remainingMs: Math.max(0, num(c, 'remainingMs')),
    };
  }

  const answers = list(d, 'answers').map(item => {
    if (!isRecord(item)) bad('элемент answers должен быть объектом');
    const r = item as Record<string, unknown>;
    const questionId = num(r, 'questionId');
    const value = num(r, 'value');
    if (!QUESTION_IDS.has(questionId) || !VALID_VALUES.has(value)) bad('недопустимый ответ в состоянии попытки');
    return { questionId, value: value as AnswerValue };
  });

  const skippedQuestionIds = list(d, 'skippedQuestionIds').filter((x): x is number => typeof x === 'number');

  let roundProgress: ServerAttemptState['roundProgress'] = null;
  if (isRecord(d.roundProgress)) {
    const rp = d.roundProgress as Record<string, unknown>;
    if (typeof rp.position === 'number' && typeof rp.size === 'number' && rp.size > 0) {
      roundProgress = { position: rp.position, size: rp.size };
    }
  }

  return {
    attemptId: str(d, 'attemptId'),
    clientAttemptId: str(d, 'clientAttemptId'),
    testVersion: str(d, 'testVersion'),
    status: status as 'in_progress' | 'completed',
    round: num(d, 'round'),
    totalQuestions: num(d, 'totalQuestions'),
    answeredCount: num(d, 'answeredCount'),
    skippedCount: num(d, 'skippedCount'),
    roundFinished: d.roundFinished === true,
    canFinish: d.canFinish === true,
    currentQuestion,
    answers,
    skippedQuestionIds,
    roundProgress,
    startedAt: str(d, 'startedAt'),
    completedAt: optStr(d, 'completedAt') ?? null,
  };
}
