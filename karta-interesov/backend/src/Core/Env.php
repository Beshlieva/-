<?php

declare(strict_types=1);

namespace Karta\Core;

/** Чтение .env. Реальные переменные окружения имеют приоритет над файлом. */
final class Env
{
    /** @var array<string,string> */
    private static array $values = [];

    public static function load(string $path): void
    {
        if (!is_file($path) || !is_readable($path)) {
            return;
        }
        $lines = file($path, FILE_IGNORE_NEW_LINES);
        if ($lines === false) {
            return;
        }
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $pos = strpos($line, '=');
            if ($pos === false) {
                continue;
            }
            $key = trim(substr($line, 0, $pos));
            $value = trim(substr($line, $pos + 1));
            if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) {
                continue;
            }
            if ($value !== '' && ($value[0] === '"' || $value[0] === "'")) {
                $quote = $value[0];
                $end = strrpos($value, $quote);
                $value = ($end !== false && $end > 0) ? substr($value, 1, $end - 1) : substr($value, 1);
            } else {
                // комментарий в конце строки: "значение   # пояснение"
                $value = trim((string) preg_replace('/\s+#.*$/', '', $value));
            }
            self::$values[$key] = $value;
        }
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $real = getenv($key);
        if ($real !== false) {
            return $real;
        }
        return self::$values[$key] ?? $default;
    }
}
