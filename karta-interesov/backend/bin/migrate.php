<?php

declare(strict_types=1);

// Применить SQL-миграции: php bin/migrate.php
require __DIR__ . '/_bootstrap.php';

use Karta\Core\Database;
use Karta\Setup\Migrator;

$config = karta_config();
try {
    $pdo = Database::connect($config);
    $done = (new Migrator($pdo, __DIR__ . '/../database/migrations'))->run('karta_say');
    karta_say($done === [] ? 'Схема актуальна.' : 'Применено миграций: ' . count($done));
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}
