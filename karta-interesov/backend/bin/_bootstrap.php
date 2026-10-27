<?php

declare(strict_types=1);

// Общий запуск CLI-скриптов: только из командной строки, с проверкой версии PHP и конфигурации.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
if (PHP_VERSION_ID < 80200) {
    fwrite(STDERR, "Нужен PHP 8.2 или новее. Сейчас: " . PHP_VERSION . "\n");
    exit(1);
}
foreach (['pdo_mysql', 'mbstring', 'json'] as $ext) {
    if (!extension_loaded($ext)) {
        fwrite(STDERR, "Не включено расширение PHP: {$ext}. Включите его в php.ini (в XAMPP: extension={$ext}).\n");
        exit(1);
    }
}

date_default_timezone_set('UTC');
mb_internal_encoding('UTF-8');
set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
    if ((error_reporting() & $no) === 0) {
        return false;
    }
    throw new ErrorException($str, 0, $no, $file, $line);
});

require __DIR__ . '/../src/autoload.php';

use Karta\Core\Config;

function karta_config(): Config
{
    try {
        return Config::fromEnv();
    } catch (Throwable $e) {
        fwrite(STDERR, 'Ошибка конфигурации: ' . $e->getMessage() . "\n");
        exit(1);
    }
}

function karta_say(string $line): void
{
    fwrite(STDOUT, $line . "\n");
}
