<?php

declare(strict_types=1);

namespace Karta\Services;

use Karta\Core\Clock;
use Karta\Core\Logger;
use Karta\Core\Request;
use PDO;

final class AuditLog
{
    public function __construct(private readonly PDO $pdo, private readonly Clock $clock, private readonly Logger $logger)
    {
    }

    /**
     * Запись в admin_audit_logs. Сбой журнала не должен ломать основной запрос, но фиксируется в логе ошибок.
     *
     * @param array<string,mixed> $details не должен содержать паролей и токенов
     */
    public function write(
        Request $request,
        string $action,
        ?int $adminId,
        ?string $entityType = null,
        ?string $entityId = null,
        array $details = [],
        ?string $usernameAttempted = null,
    ): void {
        try {
            $st = $this->pdo->prepare(
                'INSERT INTO admin_audit_logs
                   (admin_user_id, username_attempted, action, entity_type, entity_id, details, ip_address, user_agent, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $st->execute([
                $adminId,
                $usernameAttempted !== null ? mb_substr($usernameAttempted, 0, 64, 'UTF-8') : null,
                $action,
                $entityType,
                $entityId,
                $details === [] ? null : json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                mb_substr($request->ip, 0, 45, 'UTF-8'),
                $request->userAgent,
                Clock::db($this->clock->now()),
            ]);
        } catch (\Throwable $e) {
            $this->logger->error('Не удалось записать admin_audit_logs (action=' . $action . ')', $e);
        }
    }
}
