# Контракт HTTP API (frontend ⇄ backend)

> **Этап 2:** актуальный контракт серверной части — `docs/API_V2.md` (ответы по одному, серверный таймер). Описанная ниже пакетная отправка `POST /attempts` с массивом `answers` сервером не принимается.


Frontend **никогда не подключается к MySQL напрямую** — только к HTTP API. Этот документ описывает,
что уже ждёт клиентский код в `src/services/api/` и в каком формате нужно отвечать из PHP.

Базовый адрес задаётся переменной `VITE_API_BASE_URL` (например `https://example.kz/api/v1`).
Формат — JSON, кодировка UTF-8. Имена полей — camelCase.

Типы TypeScript, соответствующие этому контракту, — в `src/types/index.ts`.

## Общие правила

- **Расчёт на сервере.** Сервер обязан пересчитывать баллы сам по присланным ответам (алгоритм — `calculateResults`
  в `src/data/questions.ts`) и не доверять никаким баллам от клиента. Клиент баллы и не присылает.
- **Идемпотентность.** `clientAttemptId` — уникальный ключ попытки. Повторный `POST /attempts` с тем же
  `clientAttemptId` должен вернуть уже сохранённый результат, а не создавать дубликат (клиент может повторить запрос
  после сбоя сети; в режиме разработки React StrictMode также отправляет запрос дважды).
- **Ошибки:** статус 4xx/5xx и тело `{ "error": { "message": "понятный текст" } }`. Клиент показывает `message` пользователю.
- **Администратор.** Все адреса `/admin/...` должны проверять авторизацию администратора **на сервере**.
  Данные обычных пользователей и административная аналитика разделены на уровне адресов и прав доступа.
  Секретов, паролей и ключей во frontend нет и быть не должно (все `VITE_*` публичны).
- **CORS.** Если frontend и API на разных доменах — разрешите origin frontend. Для авторизации по cookie
  потребуется `credentials: 'include'` на клиенте (место отмечено в `src/services/api/http.ts`).

## Публичные адреса

### `POST /attempts` — сохранить прохождение и получить результат

Запрос:

```json
{
  "clientAttemptId": "0b9f7c1e-5f0e-4a43-9c0e-0d3a5b7d9a11",
  "testVersion": "golomshtok-174-v1",
  "respondent": { "regionCode": "zhambyl" },
  "answers": [
    { "questionId": 1, "value": 2 },
    { "questionId": 2, "value": -1 }
  ],
  "startedAt": "2026-10-11T09:00:00.000Z",
  "completedAt": "2026-10-11T09:17:30.000Z"
}
```

- `answers` — от 1 до 174 элементов, `questionId` 1…174 без повторов, `value` ∈ {-2, -1, 0, 1, 2}.
  Приложение допускает показ результата при неполном тесте, поэтому отвечать может быть меньше 174.
- `respondent` и `startedAt` необязательны. Сейчас интерфейс регион не запрашивает (для этого нужен новый шаг в UI).
- Коды регионов — `src/data/regions.ts`.

Ответ `200` (или `201`):

```json
{
  "attemptId": "42",
  "testVersion": "golomshtok-174-v1",
  "answeredCount": 174,
  "persisted": true,
  "calculatedAt": "2026-10-11T09:17:31.000Z",
  "scores": [
    { "categoryId": 1, "rawScore": 7, "displayScore": 80 }
  ]
}
```

- `scores` — **ровно 29 элементов**, по одному на каждое направление (`categoryId` 1…29).
- `rawScore` — целое от −12 до +12 (6 вопросов × от −2 до +2), `displayScore` — `round((rawScore + 12) / 24 * 100)`.
- Клиент отклонит ответ с неполным набором направлений или баллом вне диапазона (`INVALID_RESPONSE`).

### `GET /attempts/{attemptId}/result` — получить сохранённый результат

Ответ — тот же объект, что и у `POST /attempts`. Если попытки нет — `404`.

## Административные адреса (требуют авторизации)

Общие фильтры в query-строке: `regionCode`, `dateFrom`, `dateTo` (`YYYY-MM-DD`, включительно).

### `GET /admin/analytics/summary`

```json
{
  "totalAttempts": 1250,
  "averageAnsweredCount": 171.4,
  "categories": [
    { "categoryId": 11, "averageRawScore": 3.2, "averageDisplayScore": 63, "timesInTop5": 410 }
  ]
}
```

### `GET /admin/analytics/regions`

```json
{
  "regions": [
    {
      "regionCode": "zhambyl",
      "attempts": 87,
      "categories": [
        { "categoryId": 5, "averageRawScore": 2.1, "averageDisplayScore": 59, "timesInTop5": 30 }
      ]
    }
  ]
}
```

### `GET /admin/attempts?page=1&pageSize=20`

```json
{
  "page": 1,
  "pageSize": 20,
  "total": 1250,
  "items": [
    {
      "attemptId": "42",
      "completedAt": "2026-10-11T09:17:30.000Z",
      "regionCode": "zhambyl",
      "answeredCount": 174,
      "topCategoryIds": [11, 2, 9, 10, 1]
    }
  ]
}
```

Персональных данных (имён, контактов) в административных списках нет — добавлять их стоит только осознанно,
вместе с продуманной авторизацией и политикой хранения данных.

## Подсказка по таблицам MySQL (необязательная)

| Таблица | Назначение |
|---|---|
| `categories`, `questions` | справочники; загружаются из `docs/data/*.json` |
| `regions` | справочник регионов; из `src/data/regions.ts` |
| `attempts` | `id`, `client_attempt_id` (UNIQUE), `test_version`, `region_code`, `started_at`, `completed_at` |
| `attempt_answers` | `attempt_id`, `question_id`, `value` (UNIQUE по паре attempt_id + question_id) |
| `attempt_scores` | `attempt_id`, `category_id`, `raw_score` — хранить рассчитанные баллы удобно для аналитики |

## Что сейчас делает frontend

| Режим | Как включается | Поведение |
|---|---|---|
| `demo` (по умолчанию) | `VITE_API_MODE=demo` | Сервер не нужен. Результат считается в браузере существующим алгоритмом, ничего не отправляется и не сохраняется; под результатом показывается пояснение. Административные функции возвращают ошибку `NOT_AVAILABLE_IN_DEMO` — статистика не имитируется. |
| `api` | `VITE_API_MODE=api` + `VITE_API_BASE_URL` | Запросы идут на сервер. При ошибке пользователь видит сообщение, может повторить запрос или посмотреть результат «без сохранения» (посчитанный локально). |
