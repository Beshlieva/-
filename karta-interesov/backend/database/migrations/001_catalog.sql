-- 001: справочники (регионы, категории интересов, вопросы).
-- Правила миграций: один оператор заканчивается точкой с запятой в конце строки;
-- внутри строк и комментариев точку с запятой не используем.

CREATE TABLE regions (
  id          SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(40)  NOT NULL COMMENT 'Внутренний код проекта (совпадает с src/data/regions.ts)',
  name        VARCHAR(100) NOT NULL,
  kind        ENUM('region','city') NOT NULL,
  kato_code   VARCHAR(10)  NULL COMMENT 'Официальный код КАТО. Заполняется только после сверки с классификатором',
  sort_order  SMALLINT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_regions_code (code),
  UNIQUE KEY uq_regions_name (name),
  UNIQUE KEY uq_regions_kato (kato_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE categories (
  id           SMALLINT UNSIGNED NOT NULL COMMENT 'Идентификатор из проекта (1..29), не AUTO_INCREMENT',
  name         VARCHAR(100) NOT NULL,
  description  VARCHAR(255) NOT NULL,
  color        CHAR(7)      NOT NULL,
  icon         VARCHAR(16)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name (name),
  CONSTRAINT chk_categories_color CHECK (color REGEXP '^#[0-9A-Fa-f]{6}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE questions (
  id           SMALLINT UNSIGNED NOT NULL COMMENT 'Идентификатор из проекта (1..174), не AUTO_INCREMENT',
  category_id  SMALLINT UNSIGNED NOT NULL,
  text         VARCHAR(500) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_questions_category (category_id),
  CONSTRAINT fk_questions_category FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
