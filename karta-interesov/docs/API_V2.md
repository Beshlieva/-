# HTTP API, этап 2 (PHP + MySQL)

Базовый адрес: `http://localhost:8000/api/v1` (см. `API_BASE_PATH` в `backend/.env`). JSON, UTF-8, поля — camelCase,
время — ISO 8601 UTC (`2026-10-11T09:17:30.000Z`).

Ошибки: статус 4xx/5xx и тело `{ "error": { "code": "…", "message": "…", "details": { … } } }`.

## Авторизация

| Кто | Как |
|---|---|
| Пользователь | `Authorization: Bearer <accessToken>` — токен выдаётся один раз в ответе `POST /auth/register`, `POST /auth/login` (или `POST /users`); в БД хранится только SHA-256. Одна активная сессия: новый вход выдаёт новый токен, прежний перестаёт действовать |
| Администратор | `Authorization: Bearer <token>` из `POST /admin/login` (действует `ADMIN_TOKEN_TTL_MINUTES`, одна активная сессия) |

Попытка доступна **только владельцу**: чужой и несуществующий `attemptId` дают одинаковый `404`.

## Регистрация и вход (этап 3)

Поля пользователя: имя и фамилия → `users.display_name`, возраст → `users.age` (миграция `004`), регион → `users.region_id`
(коды из `GET /regions`), пароль → `users.password_hash` (`password_hash()`, сам пароль не хранится).

### `POST /auth/register`
Тело (все поля обязательны, лишние отклоняются): `{ "firstName", "lastName", "email", "age", "regionCode", "password" }`.
`firstName`/`lastName` — 1–50 символов, буквы, пробел, дефис, апостроф, точка; `age` — JSON-целое 10–100;
`password` — 8 символов минимум, не более 72 байт. Email приводится к нижнему регистру. Ответ `201`:
`{ userId, email, displayName, age, regionCode, accessToken, createdAt }` — **токен показывается один раз**.

| Ситуация | Ответ |
|---|---|
| Данные не прошли проверку | `422 VALIDATION_ERROR`, `details.fields` — сообщения по полям |
| Email уже зарегистрирован | `409 EMAIL_ALREADY_REGISTERED`. Дубликат не создаётся, токен существующего аккаунта **не** выдаётся — нужно войти по паролю |

### `POST /auth/login`
Тело `{ "email", "password" }` → `200` с тем же объектом, что и при регистрации (новый `accessToken`).
Неверный email или пароль — одинаковый `401 INVALID_CREDENTIALS` (по ответу нельзя понять, существует ли email).
После 5 неудач подряд для учётной записи вход блокируется на 15 минут (`429 LOGIN_LOCKED`).
Пользователи, созданные ранее через `POST /users` без пароля, войти по паролю не могут.

### `POST /auth/logout` (токен пользователя)
`204`, текущий токен аннулируется.

`GET /users/me` дополнительно возвращает `age`.

## Публичные справочники (без токена)

| Метод и адрес | Ответ |
|---|---|
| `GET /health` | `{ "status": "ok" }` или `503`, если БД недоступна |
| `GET /regions` | `{ "regions": [{ "code", "name", "kind" }] }` — 20 регионов |
| `GET /categories` | `{ "testVersion", "categories": [{ "id", "name", "description", "color", "icon" }] }` — 29 |
| `GET /questions` | `{ "testVersion", "total": 174, "questions": [{ "id", "text", "categoryId" }] }` |

## Пользователи

`POST /users` — тело `{ "email"?, "displayName"?, "regionCode"? }`. Все поля необязательны (анонимный пользователь).
Email приводится к нижнему регистру, уникален (`409 EMAIL_ALREADY_REGISTERED`). Ответ `201`:
`{ userId, email, displayName, regionCode, accessToken, createdAt }`. **Сохраните `accessToken` — повторно он не показывается.**

`GET /users/me` (токен пользователя) — профиль.

## Попытки (токен пользователя)

### `POST /attempts` — создать попытку
Тело: `{ "clientAttemptId": "<8–64 символов [A-Za-z0-9_-]>", "testVersion"?: "golomshtok-174-v1", "regionCode"? }`.
Идемпотентно: повтор с тем же `clientAttemptId` возвращает ту же попытку (`200` вместо `201`).
**Первый вопрос открывается сразу — с этого момента сервер отсчитывает его время.**
Пакетная отправка (`answers` в теле) отклоняется кодом `BATCH_SUBMIT_NOT_SUPPORTED`.

Ответ — *состояние попытки*:

```json
{
  "attemptId": "42", "clientAttemptId": "…", "testVersion": "golomshtok-174-v1",
  "status": "in_progress", "round": 1, "totalQuestions": 174,
  "answeredCount": 3, "skippedCount": 1,
  "roundFinished": false, "canFinish": false,
  "currentQuestion": {
    "questionId": 5, "openedAt": "…", "deadlineAt": "…", "timeLimitMs": 15000, "remainingMs": 11200
  },
  "answers": [{ "questionId": 1, "value": 2 }],
  "skippedQuestionIds": [3],
  "roundProgress": { "position": 5, "size": 174 },
  "startedAt": "…", "completedAt": null, "serverTime": "…"
}
```

`roundProgress` — позиция в текущем круге: в круге 1 `size` = 174, в повторном круге — число вопросов, пропущенных к его началу
(подпись «Повтор пропусков · N из M»); у завершённой попытки `null`. `currentQuestion` равен `null`, когда круг закончен (`roundFinished: true`). `serverTime` — только для отображения.

### `GET /attempts/active` — последняя незавершённая попытка пользователя (`404 NO_ACTIVE_ATTEMPT`, если нет)
### `GET /attempts/{id}` — состояние попытки
Если время текущего вопроса давно вышло (страницу закрыли), этот вопрос помечается пропущенным, а следующий
открывается с текущего серверного времени — **один вопрос за обращение**. Обновление страницы время не продлевает.

### `POST /attempts/{id}/answers` — сохранить ответ
Тело: `{ "questionId": <int>, "value": -2|-1|0|1|2 }` (только настоящие JSON-целые).

| Ситуация | Результат |
|---|---|
| Вопрос текущий, время не вышло | `200`, состояние со следующим вопросом, `"duplicate": false` |
| Тот же ответ на уже отвеченный вопрос (повтор запроса) | `200`, состояние без изменений, `"duplicate": true` |
| Другое значение для уже отвеченного вопроса | `409 ANSWER_ALREADY_FIXED`, ответ не меняется |
| Вопрос не текущий (ответ «вперёд», на закрытый круг) | `409 NOT_CURRENT_QUESTION` |
| Время вышло (> `QUESTION_TIME_MS` + `ANSWER_GRACE_MS` после открытия; по умолчанию 15 000 + 1 000 мс) | `409 TIME_EXPIRED`, вопрос записан как пропущенный, актуальное состояние в `details.state` |
| Тест уже завершён | `409 ATTEMPT_COMPLETED` |

### `POST /attempts/{id}/skips` — отметить вопрос пропущенным
Тело: `{ "questionId": <int> }`. Принимается, только если время вопроса действительно вышло
(допуск `SKIP_TOLERANCE_MS`); иначе `409 TOO_EARLY` с `details.remainingMs`. Повтор — `200` с `"duplicate": true`.
Пропуск сохраняется как строка `answers.status = 'skipped'`, `value = NULL` — **не как 0**, в баллы не входит.

### `POST /attempts/{id}/retry-round` — повторный круг по пропущенным
Тело (необязательно): `{ "fromRound": <int> }` — делает повтор запроса идемпотентным.
Ошибки: `409 ROUND_NOT_FINISHED`, `409 NO_SKIPPED_QUESTIONS`, `409 ROUND_MISMATCH`.
В повторном круге пропущенный вопрос можно ответить (`skipped → answered`); отвеченный не меняется никогда.

### `POST /attempts/{id}/finish` — завершить тест и сохранить результат
Требует ответов на все 174 вопроса (`409 ATTEMPT_INCOMPLETE` с `details.missingQuestionIds`).
Баллы считает сервер по сохранённым ответам тем же алгоритмом, что `calculateResults` во frontend.
Повторный вызов возвращает тот же результат.

### `GET /attempts/{id}/result` — сохранённый результат (`409 ATTEMPT_NOT_COMPLETED`, пока тест не завершён)

```json
{
  "attemptId": "42", "testVersion": "golomshtok-174-v1", "answeredCount": 174, "persisted": true,
  "calculatedAt": "…", "topCategoryIds": [11, 2, 9, 10, 1],
  "scores": [{ "categoryId": 1, "rawScore": 7, "displayScore": 80, "rank": 4 }]
}
```
`scores` — ровно 29 элементов; `rank` 1 — самое высокое направление, при равенстве баллов выше категория с меньшим `id`
(как порядок сортировки в `ResultsScreen`). Формат совместим с `parseTestResult` во frontend.

## Администратор

| Метод и адрес | Описание |
|---|---|
| `POST /admin/login` | `{ "username", "password" }` → `{ token, tokenType, expiresAt }`. Неверные данные — `401`; после `ADMIN_MAX_FAILED_LOGINS` неудач — `429` на `ADMIN_LOCK_MINUTES` |
| `POST /admin/logout` | `204`, токен аннулируется |
| `GET /admin/analytics/summary` | как в `docs/API_CONTRACT.md` |
| `GET /admin/analytics/regions` | как в `docs/API_CONTRACT.md` (попытки без региона не входят) |
| `GET /admin/attempts?page=&pageSize=` | как в `docs/API_CONTRACT.md`; `pageSize` ≤ 100 |
| `GET /admin/audit-logs?page=&pageSize=` | журнал действий администраторов |

Фильтры: `regionCode`, `dateFrom`, `dateTo` (`YYYY-MM-DD`, UTC, включительно). В аналитике только завершённые попытки;
персональных данных (email, имя) в ответах нет. Каждый вход, выход и просмотр данных пишется в `admin_audit_logs`.

## Что изменилось по сравнению с `docs/API_CONTRACT.md`

Старый контракт описывал одноразовую отправку всех ответов (`POST /attempts` с массивом `answers`). Она несовместима
с серверным таймером (по такому запросу невозможно проверить, сколько времени ушло на каждый вопрос), поэтому сервер
принимает ответы по одному. Административные адреса и формат результата сохранены.
**С этапа 4 frontend в режиме `VITE_API_MODE=api` использует только методы этого документа (создание попытки, ответы по одному,
пропуски, повторный круг, `finish`); пакетная отправка не вызывается. Режим `demo` работает локально, как раньше.**
