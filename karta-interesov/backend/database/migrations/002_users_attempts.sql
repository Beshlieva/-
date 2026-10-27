-- 002: пользователи, попытки прохождения, ответы, итоговые результаты.

CREATE TABLE users (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email              VARCHAR(254) NULL COMMENT 'В нижнем регистре. NULL допустим (анонимный пользователь), несколько NULL разрешены',
  display_name       VARCHAR(100) NULL,
  region_id          SMALLINT UNSIGNED NULL,
  access_token_hash  CHAR(64) NOT NULL COMMENT 'SHA-256 от токена доступа. Сам токен не хранится',
  created_at         DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_token (access_token_hash),
  KEY idx_users_region (region_id),
  CONSTRAINT fk_users_region FOREIGN KEY (region_id) REFERENCES regions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE test_attempts (
  id                    BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id               BIGINT UNSIGNED NOT NULL,
  client_attempt_id     VARCHAR(64) NOT NULL COMMENT 'Ключ идемпотентности от клиента',
  test_version          VARCHAR(64) NOT NULL,
  region_id             SMALLINT UNSIGNED NULL,
  status                ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  current_round         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  current_question_id   SMALLINT UNSIGNED NULL COMMENT 'NULL — круг закончен',
  question_opened_at    DATETIME(3) NULL COMMENT 'Серверное время открытия текущего вопроса',
  started_at            DATETIME(3) NOT NULL,
  completed_at          DATETIME(3) NULL,
  answered_count        SMALLINT UNSIGNED NULL COMMENT 'Заполняется при завершении',
  calculated_at         DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attempts_user_client (user_id, client_attempt_id),
  KEY idx_attempts_status (status),
  KEY idx_attempts_completed (completed_at),
  KEY idx_attempts_region_completed (region_id, completed_at),
  CONSTRAINT fk_attempts_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_attempts_region FOREIGN KEY (region_id) REFERENCES regions (id),
  CONSTRAINT fk_attempts_question FOREIGN KEY (current_question_id) REFERENCES questions (id),
  CONSTRAINT chk_attempts_completed CHECK (status = 'in_progress' OR completed_at IS NOT NULL),
  CONSTRAINT chk_attempts_open_question CHECK ((current_question_id IS NULL) = (question_opened_at IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE answers (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  attempt_id   BIGINT UNSIGNED NOT NULL,
  question_id  SMALLINT UNSIGNED NOT NULL,
  status       ENUM('answered','skipped') NOT NULL,
  value        TINYINT NULL COMMENT '-2..2 для answered, NULL для skipped (пропуск не равен нулю)',
  last_round   SMALLINT UNSIGNED NOT NULL COMMENT 'Круг, в котором вопрос получил последнее решение',
  skip_count   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  shown_at     DATETIME(3) NOT NULL COMMENT 'Серверное время, когда вопрос был открыт в последний раз',
  resolved_at  DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_answers_attempt_question (attempt_id, question_id),
  KEY idx_answers_question (question_id),
  KEY idx_answers_attempt_status (attempt_id, status),
  CONSTRAINT fk_answers_attempt FOREIGN KEY (attempt_id) REFERENCES test_attempts (id) ON DELETE CASCADE,
  CONSTRAINT fk_answers_question FOREIGN KEY (question_id) REFERENCES questions (id),
  CONSTRAINT chk_answers_value CHECK (
    (status = 'answered' AND value BETWEEN -2 AND 2) OR (status = 'skipped' AND value IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE attempt_results (
  attempt_id     BIGINT UNSIGNED NOT NULL,
  category_id    SMALLINT UNSIGNED NOT NULL,
  raw_score      TINYINT NOT NULL COMMENT 'Сумма ответов категории (-12..12)',
  display_score  TINYINT UNSIGNED NOT NULL COMMENT 'round((raw+12)/24*100)',
  rank_position  TINYINT UNSIGNED NOT NULL COMMENT '1 = самое высокое направление. При равенстве — меньший id категории',
  PRIMARY KEY (attempt_id, category_id),
  UNIQUE KEY uq_results_attempt_rank (attempt_id, rank_position),
  KEY idx_results_category_rank (category_id, rank_position),
  CONSTRAINT fk_results_attempt FOREIGN KEY (attempt_id) REFERENCES test_attempts (id) ON DELETE CASCADE,
  CONSTRAINT fk_results_category FOREIGN KEY (category_id) REFERENCES categories (id),
  CONSTRAINT chk_results_display CHECK (display_score BETWEEN 0 AND 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
