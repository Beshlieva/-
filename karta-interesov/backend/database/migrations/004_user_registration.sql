-- 004: регистрация студентов. Только добавление столбцов: существующие таблицы и данные не удаляются и не меняются.
-- Имя и фамилия хранятся в уже существующем столбце users.display_name, регион - в users.region_id.
-- Пользователи, созданные ранее (анонимные), получают NULL в новых столбцах и продолжают работать по своему токену.
-- Вход по email доступен только тем, у кого задан password_hash.

ALTER TABLE users
  ADD COLUMN age TINYINT UNSIGNED NULL COMMENT 'Возраст в годах (10-100). NULL для ранее созданных пользователей' AFTER display_name,
  ADD COLUMN password_hash VARCHAR(255) NULL COMMENT 'Результат password_hash(). NULL - вход по паролю невозможен' AFTER email,
  ADD COLUMN failed_logins SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Неудачные попытки входа подряд' AFTER access_token_hash,
  ADD COLUMN locked_until DATETIME(3) NULL COMMENT 'Вход заблокирован до этого момента (UTC)' AFTER failed_logins,
  ADD CONSTRAINT chk_users_age CHECK (age IS NULL OR age BETWEEN 10 AND 100);
