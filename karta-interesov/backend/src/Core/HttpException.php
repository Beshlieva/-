<?php

declare(strict_types=1);

namespace Karta\Core;

use RuntimeException;

/** Ожидаемая ошибка запроса: превращается в ответ {"error":{"code","message"}} с нужным статусом. */
final class HttpException extends RuntimeException
{
    /** @param array<string,mixed> $details */
    public function __construct(
        public readonly int $status,
        public readonly string $errorCode,
        string $message,
        public readonly array $details = [],
    ) {
        parent::__construct($message);
    }
}
