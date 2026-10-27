-- 003: администраторы и журнал их действий.

CREATE TABLE admin_users (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username          VARCHAR(64)  NOT NULL,
  password_hash     VARCHAR(255) NOT NULL COMMENT 'Результат password_hash(). Пароль в открытом виде не хранится',
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  failed_logins     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  locked_until      DATETIME(3) NULL,
  token_hash        CHAR(64) NULL COMMENT 'SHA-256 от текущего токена сессии',
  token_expires_at  DATETIME(3) NULL,
  last_login_at     DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_username (username),
  UNIQUE KEY uq_admin_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE admin_audit_logs (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id       BIGINT UNSIGNED NULL,
  username_attempted  VARCHAR(64) NULL COMMENT 'Для неудачных входов, когда администратор не определён',
  action              VARCHAR(64) NOT NULL,
  entity_type         VARCHAR(64) NULL,
  entity_id           VARCHAR(64) NULL,
  details             TEXT NULL COMMENT 'JSON без паролей и токенов',
  ip_address          VARCHAR(45) NOT NULL,
  user_agent          VARCHAR(255) NOT NULL DEFAULT '',
  created_at          DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_audit_admin_created (admin_user_id, created_at),
  KEY idx_audit_action_created (action, created_at),
  CONSTRAINT fk_audit_admin FOREIGN KEY (admin_user_id) REFERENCES admin_users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
