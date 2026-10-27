<?php

declare(strict_types=1);

// Загрузить категории, вопросы и регионы: php bin/seed.php [--update]
// Без --update существующие строки не меняются; расхождения с файлами считаются ошибкой.
require __DIR__ . '/_bootstrap.php';

use Karta\Core\Database;
use Karta\Setup\CatalogSeeder;

$config = karta_config();
$update = in_array('--update', $argv, true);
try {
    $pdo = Database::connect($config);
    $res = (new CatalogSeeder($pdo, $config->catalogDir))->seed($update, 'karta_say');
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}

if ($res['conflicts'] !== []) {
    fwrite(STDERR, "\nДанные в БД отличаются от файлов справочников. НИЧЕГО НЕ ЗАПИСАНО.\n");
    foreach (array_slice($res['conflicts'], 0, 20) as $c) {
        fwrite(STDERR, "  - {$c}\n");
    }
    fwrite(STDERR, "Если изменение осознанное (новая версия теста) — запустите: php bin/seed.php --update\n");
    exit(1);
}
karta_say(sprintf('Готово: добавлено %d, обновлено %d, без изменений %d.', $res['inserted'], $res['updated'], $res['unchanged']));
