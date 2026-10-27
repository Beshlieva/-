<?php

declare(strict_types=1);

// Простой PSR-4 автозагрузчик: Karta\Foo\Bar -> src/Foo/Bar.php. Composer не нужен.
spl_autoload_register(static function (string $class): void {
    $prefix = 'Karta\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file = __DIR__ . DIRECTORY_SEPARATOR . str_replace('\\', DIRECTORY_SEPARATOR, $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
