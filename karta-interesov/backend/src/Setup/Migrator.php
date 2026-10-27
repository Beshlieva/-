<?php

declare(strict_types=1);

namespace Karta\Setup;

use PDO;
use RuntimeException;

/**
 * Применяет database/migrations/*.sql по порядку имён и запоминает их в schema_migrations.
 * Повторный запуск пропускает применённые файлы. Если применённый файл изменили — остановка с ошибкой.
 * (DDL в MySQL неявно фиксируется, поэтому откат миграции при сбое невозможен — пишите их небольшими.)
 */
final class Migrator
{
    public function __construct(private readonly PDO $pdo, private readonly string $dir)
    {
    }

    /** @return string[] применённые в этот запуск миграции */
    public function run(callable $log): array
    {
        $this->pdo->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
               version    VARCHAR(100) NOT NULL,
               checksum   CHAR(64) NOT NULL,
               applied_at DATETIME(3) NOT NULL,
               PRIMARY KEY (version)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );

        $files = glob($this->dir . DIRECTORY_SEPARATOR . '*.sql') ?: [];
        sort($files, SORT_STRING);
        if ($files === []) {
            throw new RuntimeException('Не найдено ни одной миграции в ' . $this->dir);
        }

        $applied = [];
        foreach ($this->pdo->query('SELECT version, checksum FROM schema_migrations')->fetchAll() as $row) {
            $applied[(string) $row['version']] = (string) $row['checksum'];
        }

        $done = [];
        foreach ($files as $file) {
            $version = basename($file);
            $sql = (string) file_get_contents($file);
            // Перевод строк CRLF (Windows) не должен менять контрольную сумму
            $checksum = hash('sha256', str_replace("\r\n", "\n", $sql));

            if (isset($applied[$version])) {
                if ($applied[$version] !== $checksum) {
                    throw new RuntimeException("Миграция {$version} уже применена, но файл изменён. Не редактируйте применённые миграции — создайте новую.");
                }
                $log("пропуск   {$version} (уже применена)");
                continue;
            }

            foreach ($this->statements($sql) as $statement) {
                $this->pdo->exec($statement);
            }
            $ins = $this->pdo->prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, UTC_TIMESTAMP(3))');
            $ins->execute([$version, $checksum]);
            $log("применена {$version}");
            $done[] = $version;
        }
        return $done;
    }

    /** @return string[] */
    private function statements(string $sql): array
    {
        $lines = [];
        foreach (preg_split('/\R/u', $sql) ?: [] as $line) {
            if (str_starts_with(ltrim($line), '--')) {
                continue;
            }
            $lines[] = $line;
        }
        $out = [];
        foreach (explode(';', implode("\n", $lines)) as $stmt) {
            $stmt = trim($stmt);
            if ($stmt !== '') {
                $out[] = $stmt;
            }
        }
        return $out;
    }
}
