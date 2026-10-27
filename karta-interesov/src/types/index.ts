/**
 * Общие типы данных frontend ↔ backend.
 * Контракт HTTP API описан в docs/API_CONTRACT.md — при изменении типов обновляйте оба места.
 */

/** Один из пяти вариантов ответа (см. ANSWER_OPTIONS в data/questions.ts). */
export type AnswerValue = -2 | -1 | 0 | 1 | 2;

/**
 * Ответы в формате, который использует приложение: id вопроса → значение ответа.
 * (Тип оставлен как в исходном проекте, чтобы не менять экраны.)
 */
export type AnswersMap = Record<number, number>;

/** Идентификатор версии теста — нужен, чтобы при изменении вопросов не смешивать старые и новые результаты. */
export const TEST_VERSION = 'golomshtok-174-v1';

/** Экраны приложения (в приложении нет роутера — экран хранится в состоянии App). */
export type AppScreen = 'start' | 'auth' | 'instructions' | 'test' | 'completion' | 'results';

/**
 * Данные респондента. Сейчас интерфейс их не собирает — тип подготовлен для будущей аналитики
 * по регионам Казахстана (код региона — из data/regions.ts). Расширяется при появлении регистрации.
 */
export interface Respondent {
  regionCode?: string;
}

// ───────────────────────── Регистрация и вход ─────────────────────────

/** Профиль пользователя, как его возвращает backend (POST /auth/register, /auth/login, GET /users/me). */
export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  age: number | null;
  regionCode: string | null;
  createdAt: string;
}

/** Пользователь + токен доступа. Хранится локально (src/lib/authStorage.ts) и подставляется в запросы к API. */
export interface AuthSession {
  user: AuthUser;
  accessToken: string;
}

export interface RegisterRequest {
  firstName: string;
  lastName: string;
  email: string;
  age: number;
  regionCode: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AnswerItem {
  questionId: number;
  value: AnswerValue;
}

/** Запрос «сохранить прохождение теста и получить результат». */
export interface SubmitAttemptRequest {
  /** Уникальный id попытки, создаётся на клиенте. Сервер использует его как ключ идемпотентности. */
  clientAttemptId: string;
  testVersion: string;
  respondent?: Respondent;
  answers: AnswerItem[];
  /** ISO 8601, момент начала теста (если известен). */
  startedAt?: string;
  /** ISO 8601, момент отправки. */
  completedAt: string;
}

export interface CategoryScore {
  categoryId: number;
  /** Сырой балл категории: от −12 до +12. */
  rawScore: number;
  /** Балл по шкале 0–100 (см. toDisplay в data/questions.ts). */
  displayScore: number;
}

/**
 * 'local'  — результат посчитан в браузере существующим алгоритмом calculateResults;
 * 'server' — результат вернул backend.
 */
export type ResultSource = 'local' | 'server';

export interface TestResult {
  attemptId: string;
  testVersion: string;
  answeredCount: number;
  /** Баллы по всем 29 направлениям, по возрастанию categoryId. */
  scores: CategoryScore[];
  calculatedAt: string;
  source: ResultSource;
  /** true — попытка сохранена на сервере. В демо-режиме всегда false. */
  persisted: boolean;
}

// ───────────────────────── Серверная попытка (этап 4) ─────────────────────────

/** Текущий вопрос попытки. Время считает сервер: клиент только показывает `remainingMs`. */
export interface ServerCurrentQuestion {
  questionId: number;
  openedAt: string;
  deadlineAt: string;
  timeLimitMs: number;
  /** Сколько осталось на момент формирования ответа сервера, мс. */
  remainingMs: number;
}

/** Состояние попытки, как его возвращает backend (docs/API_V2.md, «Попытки»). */
export interface ServerAttemptState {
  attemptId: string;
  clientAttemptId: string;
  testVersion: string;
  status: 'in_progress' | 'completed';
  round: number;
  totalQuestions: number;
  answeredCount: number;
  skippedCount: number;
  roundFinished: boolean;
  canFinish: boolean;
  currentQuestion: ServerCurrentQuestion | null;
  answers: AnswerItem[];
  skippedQuestionIds: number[];
  /** Позиция в текущем круге: для повторных кругов — «N из M пропущенных». null, если сервер не прислал. */
  roundProgress: { position: number; size: number } | null;
  startedAt: string;
  completedAt: string | null;
}

// ───────────────────────── Административная аналитика ─────────────────────────

export interface AnalyticsFilters {
  /** Код региона из data/regions.ts. */
  regionCode?: string;
  /** ISO-дата (YYYY-MM-DD), включительно. */
  dateFrom?: string;
  dateTo?: string;
}

export interface CategoryAggregate {
  categoryId: number;
  averageRawScore: number;
  averageDisplayScore: number;
  /** Сколько раз направление попадало в топ-5 респондента. */
  timesInTop5: number;
}

export interface AnalyticsSummary {
  totalAttempts: number;
  averageAnsweredCount: number;
  categories: CategoryAggregate[];
}

export interface RegionAggregate {
  regionCode: string;
  attempts: number;
  categories: CategoryAggregate[];
}

/** Строка списка прохождений для администратора. Персональных данных здесь нет. */
export interface AttemptListItem {
  attemptId: string;
  completedAt: string;
  regionCode?: string;
  answeredCount: number;
  topCategoryIds: number[];
}

export interface ListAttemptsParams extends AnalyticsFilters {
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ───────────────────────── Панель администратора ─────────────────────────

/** Фильтры панели. Поиск q действует только на таблицы и экспорт, регион и период — на всё. */
export interface AdminFilters extends AnalyticsFilters {
  q?: string;
}

export interface AdminSession {
  token: string;
  expiresAt: string;
}

export interface AdminOverview {
  totalUsers: number;
  startedAttempts: number;
  completedAttempts: number;
  usersByRegion: { regionCode: string; users: number }[];
}

export interface AdminUserRow {
  userId: string;
  name: string | null;
  email: string | null;
  age: number | null;
  regionCode: string | null;
  registeredAt: string;
  startedAttempts: number;
  completedAttempts: number;
  lastCompletedAttemptId: string | null;
}

export interface AdminResultRow {
  attemptId: string;
  completedAt: string;
  answeredCount: number;
  name: string | null;
  email: string | null;
  age: number | null;
  regionCode: string | null;
  topCategoryIds: number[];
}

export interface AdminResultDetail {
  attemptId: string;
  testVersion: string;
  startedAt: string;
  completedAt: string;
  answeredCount: number;
  name: string | null;
  email: string | null;
  age: number | null;
  regionCode: string | null;
  /** По возрастанию места: первый элемент — самое высокое направление. */
  scores: { categoryId: number; rawScore: number; displayScore: number; rank: number }[];
}

// ───────────────────────── Ошибки API ─────────────────────────

export type ApiErrorCode =
  | 'NOT_CONFIGURED'         // неверные переменные окружения
  | 'NOT_AVAILABLE_IN_DEMO'  // функция требует сервер, а включён демо-режим
  | 'NETWORK'                // нет связи с сервером
  | 'TIMEOUT'                // сервер не ответил за VITE_API_TIMEOUT_MS
  | 'ABORTED'                // запрос отменён самим приложением
  | 'HTTP'                   // сервер вернул статус 4xx/5xx
  | 'NOT_FOUND'              // результат не найден
  | 'INVALID_RESPONSE'       // ответ сервера не соответствует контракту
  | 'BATCH_NOT_SUPPORTED'    // пакетная отправка ответов в режиме api запрещена (ответы уходят по одному)
  | 'INVALID_REQUEST';       // данные не прошли проверку на клиенте до отправки

export class ApiError extends Error {
  code: ApiErrorCode;
  status?: number;
  details?: unknown;

  constructor(code: ApiErrorCode, message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
