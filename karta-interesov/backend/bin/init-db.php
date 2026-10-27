<?php

declare(strict_types=1);

// Полная инициализация БД: создать базу (если нет) -> миграции -> загрузка справочников.
//   php bin/init-db.php [--skip-create]
// Учётная запись из .env должна иметь право CREATE на базу (или создайте её заранее и укажите --skip-create).
require __DIR__ . '/_bootstrap.php';

use Karta\Core\Database;
use Karta\Setup\CatalogSeeder;
use Karta\Setup\Migrator;

$config = karta_config();
try {
    if (!in_array('--skip-create', $argv, true)) {
        $server = Database::connect($config, false);
        // Имя БД уже проверено в Config регулярным выражением [A-Za-z0-9_]
        $server->exec('CREATE DATABASE IF NOT EXISTS `' . $config->dbName . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
        karta_say("База {$config->dbName}: готова.");
    }

    $pdo = Database::connect($config);
    (new Migrator($pdo, __DIR__ . '/../database/migrations'))->run('karta_say');
    $res = (new CatalogSeeder($pdo, $config->catalogDir))->seed(false, 'karta_say');
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}

if ($res['conflicts'] !== []) {
    fwrite(STDERR, "Справочники в БД отличаются от файлов — запись отменена. Подробности: php bin/seed.php\n");
    exit(1);
}
karta_say('Инициализация завершена. Создайте администратора: php bin/create-admin.php --username=<логин>');
