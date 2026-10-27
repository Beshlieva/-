-- Ручной вариант подготовки БД (если не используете bin/init-db.php).
-- Выполните под учётной записью с правами администратора MySQL (например, root в phpMyAdmin).
-- ЗАМЕНИТЕ <ПАРОЛЬ> на свой — реальный пароль в репозиторий не записывается.

CREATE DATABASE IF NOT EXISTS karta_interesov CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'karta_app'@'localhost' IDENTIFIED BY '<ПАРОЛЬ>';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON karta_interesov.* TO 'karta_app'@'localhost';
FLUSH PRIVILEGES;
