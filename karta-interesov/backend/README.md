# Backend «Карта интересов»: PHP 8.2 + MySQL 8

REST API без фреймворков и Composer-зависимостей: PDO (только подготовленные запросы), миграции, загрузчик
справочников, серверный таймер, админ-аналитика. Контракт эндпоинтов — `../docs/API_V2.md`.

## Требования
- PHP 8.2+ с расширениями `pdo_mysql`, `mbstring`, `json` (в XAMPP включены по умолчанию).
- MySQL 8. XAMPP поставляет MariaDB — схема написана без возможностей, специфичных для MySQL 8, но целевая
  СУБД проекта — MySQL 8.0.16+ (нужна для проверок `CHECK`). Проверяйте на той СУБД, на которой будете работать.

## Быстрый старт (Windows, VS Code, XAMPP)

Команды — в терминале VS Code из папки `backend`. Путь к PHP в XAMPP обычно `C:\xampp\php\php.exe`
(добавьте `C:\xampp\php` в PATH, чтобы писать просто `php`).

1. **Запустите MySQL** в XAMPP Control Panel (Apache для режима разработки не нужен).
2. **Создайте `.env`:** `copy .env.example .env`. Файл `.env` не попадает в Git. Заполните `DB_*`.
   - Вариант A (рекомендуется): создайте отдельного пользователя БД — выполните `database/create_database.sql`
     в phpMyAdmin, **заменив `<ПАРОЛЬ>` своим**, и впишите этот пароль в `.env`.
   - Вариант B (только локально): `DB_USER=root`, `DB_PASSWORD=` (пустой пароль в XAMPP). Для production запрещено.
3. **Инициализируйте БД:** `php bin/init-db.php` — создаст базу, применит миграции (для уже существующей БД достаточно `php bin/migrate.php`: применится только `004`) и загрузит 29 категорий,
   174 вопроса и 20 регионов. Повторный запуск безопасен (дубликатов не будет).
4. **Создайте администратора:** `php bin/create-admin.php --username=admin` (пароль ≥ 12 символов вводится
   в консоли; в БД сохраняется только хэш). Смена пароля: добавьте `--reset-password`.
   Только для закрытой локальной разработки можно разрешить пароль от 8 символов флагом
   `--allow-weak-local-password`; этот флаг отклоняется при `APP_ENV=production` и не должен использоваться на сервере.
5. **Запустите API:** `php -S localhost:8000 -t public public/index.php`
6. **Проверьте:** откройте `http://localhost:8000/api/v1/health` → `{"status":"ok"}`, затем `/api/v1/questions`.
7. **Сверка данных:** `php bin/verify-db.php` — сравнивает БД с `docs/data/*.json`.

Frontend: `VITE_API_BASE_URL=http://localhost:8000/api/v1` (значение по умолчанию в `../.env.example`).
Origin frontend должен быть в `CORS_ALLOWED_ORIGINS` (по умолчанию `http://localhost:5173`).

> **Этап 4:** frontend в режиме `api` проходит тест по серверным методам (попытка → ответы по одному → пропуски →
> повторный круг → `finish`). Пакетный `POST /attempts` с массивом `answers` по-прежнему отклоняется (`BATCH_SUBMIT_NOT_SUPPORTED`),
> но frontend его больше не вызывает. Подробности — в `../docs/API_V2.md`.

### Пример сценария (PowerShell)
```powershell
$api = "http://localhost:8000/api/v1"
$u = Invoke-RestMethod -Method Post -Uri "$api/users" -ContentType "application/json" -Body '{"regionCode":"zhambyl"}'
$h = @{ Authorization = "Bearer $($u.accessToken)" }
$a = Invoke-RestMethod -Method Post -Uri "$api/attempts" -Headers $h -ContentType "application/json" -Body '{"clientAttemptId":"demo-attempt-0001"}'
$a.currentQuestion          # первый вопрос и его серверный дедлайн
Start-Sleep -Milliseconds 400
Invoke-RestMethod -Method Post -Uri "$api/attempts/$($a.attemptId)/answers" -Headers $h -ContentType "application/json" -Body '{"questionId":1,"value":2}'
```

### Apache (XAMPP) вместо встроенного сервера
Направьте DocumentRoot (виртуальный хост) на `backend/public`, включите `mod_rewrite` и `AllowOverride All`.
Файл `public/.htaccess` уже есть. Если API живёт не в корне домена, поправьте `API_BASE_PATH`.

## Структура
```
backend/
  public/index.php         единая точка входа (+ .htaccess для Apache)
  src/Core/                Env, Config, Database (PDO), Request/Response, Router, Validator, Clock, Logger
  src/Services/            AttemptService (таймер), Scoring, UserService, AuthService (регистрация/вход), AdminAuthService, AnalyticsService, AuditLog, Catalog
  src/Controllers/         (в т. ч. AuthController) тонкие обработчики: проверка входных данных -> сервис
  src/Setup/               Migrator, CatalogSeeder
  database/migrations/     001 справочники, 002 пользователи/попытки/ответы/результаты, 003 администраторы/аудит,
                           004 возраст и пароль пользователя (регистрация/вход)
  database/create_database.sql   ручное создание БД и пользователя (без реальных паролей)
  bin/                     init-db, migrate, seed, verify-db, create-admin
  storage/logs/            журнал ошибок (в Git не попадает)
```

## Таблицы
`users` (+ `age`, `password_hash`, `failed_logins`, `locked_until` из миграции 004), `regions`, `categories`, `questions`, `test_attempts`, `answers`, `attempt_results`, `admin_users`,
`admin_audit_logs` (+ служебная `schema_migrations`). Внешние ключи, уникальные индексы (в т. ч. `users.email`,
`(user_id, client_attempt_id)`, `(attempt_id, question_id)`) и `CHECK`-ограничения описаны в `database/migrations/`.

## Данные теста
- Источник истины — `src/data/questions.ts` и `src/data/regions.ts`. Из них `npm run catalog:export` выгружает
  `docs/data/*.json`, а `npm run catalog:check` проверяет, что JSON совпадает с исходниками.
- Загрузчик читает эти JSON, проверяет 29 категорий / 174 вопроса / подряд идущие id и **не меняет тексты**.
- Строки сопоставляются по `id` (категории, вопросы) и `code` (регионы) — дубликатов при повторном запуске нет.
  Если строка в БД отличается от файла, `bin/seed.php` останавливается с ошибкой и ничего не пишет: вопросы нельзя
  молча менять, когда уже собраны ответы. Осознанное изменение (новая версия теста): обновите `TEST_VERSION`
  и выполните `php bin/seed.php --update`.

### Регионы
Список — 17 областей и 3 города республиканского значения из `src/data/regions.ts` (административная реформа 2022 г.).
Столбец `regions.code` — **внутренние коды проекта**, а не государственные. Официальный код КАТО хранится
в `regions.kato_code`; он оставлен пустым: из этой среды сверить его с классификатором нельзя, а выдумывать коды
запрещено. Заполните его вручную по официальному классификатору (stat.gov.kz) и проверьте.

## Серверный таймер
- Время открытия вопроса — серверное (`test_attempts.question_opened_at`, UTC). Время браузера не используется.
- Ответ принимается, если пришёл не позже `QUESTION_TIME_MS + ANSWER_GRACE_MS` (по умолчанию 15 000 + 1 000 мс — запас только на задержку сети;
  браузер ответ после 15 с не отправляет вовсе) после открытия вопроса; иначе вопрос
  записывается как пропущенный, а ответ отклоняется (`TIME_EXPIRED`). `QUESTION_TIME_MS` должен совпадать с frontend (15 000).
- Отвечать можно только на текущий вопрос; «забегать вперёд» нельзя.
- Каждая попытка меняется в транзакции под `SELECT … FOR UPDATE`; уникальный ключ `(attempt_id, question_id)`
  исключает дубликаты. Повтор того же ответа — идемпотентный успех, другое значение — `409`.
- Пропуск = строка `status='skipped'`, `value=NULL` (не 0). В повторном круге пропущенный вопрос может стать
  отвеченным; отвеченный не меняется никогда.

## Безопасность
- Пароли администраторов — `password_hash()`; токены пользователей и администраторов хранятся только как SHA-256.
- Все SQL — подготовленные запросы (`ATTR_EMULATE_PREPARES=false`). Входные данные проверяются строго
  (типы, диапазоны, неизвестные поля отклоняются).
- CORS — только перечисленные origin, `*` запрещён. Авторизация по заголовку `Authorization`, не по cookie (нет CSRF).
- Ошибки сервера скрыты от клиента (подробности — в `storage/logs/app.log`); `APP_DEBUG=true` запрещён в production.
- `.env`, журналы и `node_modules` исключены из Git и из архива.

### Проверка потока (после первого запуска)

Сценарий ниже нужно выполнить на вашей машине: PHP и MySQL в среде подготовки этапа 4 не запускались.

1. `php bin/init-db.php`, зарегистрируйте пользователя (`POST /auth/register`) и возьмите `accessToken`.
2. `POST /attempts` → в ответе `currentQuestion.questionId = 1`, `remainingMs ≈ 15000`.
3. `POST /attempts/{id}/answers` `{questionId:1,value:2}` → открыт вопрос 2; повтор того же запроса → `duplicate:true`;
   другое значение → `409 ANSWER_ALREADY_FIXED`.
4. Подождите > 16 с и отправьте ответ на вопрос 2 → `409 TIME_EXPIRED`, вопрос записан как `skipped` (в `answers`: `status='skipped'`, `value=NULL`).
5. `GET /attempts/{id}` несколько раз подряд → вопрос и `remainingMs` не «перезапускаются» (время не продлевается).
6. Ответьте на все вопросы, кроме пропущенных → `roundFinished:true`; `POST /attempts/{id}/finish` → `409 ATTEMPT_INCOMPLETE`;
   `POST /attempts/{id}/retry-round` → ответьте на пропущенные; `POST /attempts/{id}/finish` → `200` и 29 строк в `attempt_results`;
   повторный `finish` → тот же результат, новых строк нет (`SELECT COUNT(*) FROM attempt_results WHERE attempt_id = …` = 29).
7. В состоянии попытки появилось поле `roundProgress` ({position,size}) — оно нужно подписи «Повтор пропусков · N из M».

### Что НЕ сделано (осознанно или из-за среды)
- **Код не запускался.** В среде, где готовились этапы 2–4, нет PHP и MySQL, поэтому PHP-код и SQL не исполнялись.
  Проверено только статически (на этапе 4 PHP изменён минимально: поле `roundProgress`, допуск `ANSWER_GRACE_MS` 2000 → 1000). Первый запуск `bin/init-db.php` и сценарий выше — обязательная проверка у вас.
- Ограничения частоты запросов (особенно `POST /users` и `/admin/login` по IP) нет — настройте на уровне веб-сервера
  или прокси. Блокировка есть только по учётной записи администратора.
- Вход студентов — по email и паролю (`POST /auth/login`). Новый вход выдаёт новый токен и отменяет прежний (одна сессия);
  выход с другого устройства происходит автоматически. Восстановления пароля (почта) нет. Блокировка 5 неудач / 15 минут
  действует на учётную запись — этим можно временно закрыть чужой аккаунт; ограничение по IP настройте на веб-сервере.
- Пользователи, созданные ранее через `POST /users` без пароля, по паролю войти не могут (токен — единственный доступ).
  `POST /users` оставлен для совместимости; email, занятый таким пользователем, зарегистрировать повторно нельзя.
- Для работы за обратным прокси IP клиента берётся из `REMOTE_ADDR` (заголовки `X-Forwarded-*` не доверяются).
- Автоматических тестов PHP нет.
