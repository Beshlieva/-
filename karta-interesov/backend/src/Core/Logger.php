<?php

declare(strict_types=1);

namespace Karta\Core;

/** Журнал ошибок. Токены, пароли и тела запросов в журнал не пишутся. */
final class Logger
{
    public function __construct(private readonly string $file)
    {
    }

    public function error(string $message, ?\Throwable $e = null): void
    {
        $line = sprintf('[%s] %s', gmdate('Y-m-d\TH:i:s\Z'), $message);
        if ($e !== null) {
            $line .= sprintf(' | %s: %s @ %s:%d', $e::class, $e->getMessage(), basename($e->getFile()), $e->getLine());
        }
        $dir = dirname($this->file);
        if (is_dir($dir) && is_writable($dir) && @error_log($line . PHP_EOL, 3, $this->file)) {
            return;
        }
        error_log($line);
    }
}
