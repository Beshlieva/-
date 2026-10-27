<?php

declare(strict_types=1);

// Сверка БД со справочниками проекта (без изменений данных): php bin/verify-db.php
require __DIR__ . '/_bootstrap.php';

use Karta\Core\Database;
use Karta\Setup\CatalogSeeder;

$config = karta_config();
try {
    $pdo = Database::connect($config);
    $seeder = new CatalogSeeder($pdo, $config->catalogDir);
    $problems = $seeder->verify();

    $counts = [];
    foreach (['categories', 'questions', 'regions'] as $t) {
        $counts[$t] = (int) $pdo->query("SELECT COUNT(*) FROM {$t}")->fetchColumn();
    }
    karta_say(sprintf('Категорий: %d, вопросов: %d, регионов: %d', $counts['categories'], $counts['questions'], $counts['regions']));
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}

if ($problems !== []) {
    fwrite(STDERR, "Найдены расхождения:\n");
    foreach (array_slice($problems, 0, 30) as $p) {
        fwrite(STDERR, "  - {$p}\n");
    }
    exit(1);
}
karta_say('OK: данные в БД совпадают с docs/data/*.json.');
