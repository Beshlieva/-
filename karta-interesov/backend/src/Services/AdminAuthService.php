<?php

declare(strict_types=1);

namespace Karta\Services;

use Karta\Core\Clock;
use Karta\Core\Config;
use Karta\Core\HttpException;
use Karta\Core\Request;
use PDO;

final class AdminAuthService
{
    private ?string $dummyHash = null;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Config $config,
        private readonly Clock $clock,
        private readonly AuditLog $audit,
    ) {
    }

    /**
     * Вход администратора. Возвращает токен сессии (хранится только его SHA-256).
     * После ADMIN_MAX_FAILED_LOGINS неудачных попыток учётная запись блокируется на ADMIN_LOCK_MINUTES.
     *
     * @return array{token:string,expiresAt:string}
     */
    public function login(Request $request, string $username, string $password): array
    {
        $now = $this->clock->now();

        $st = $this->pdo->prepare('SELECT * FROM admin_users WHERE username = ?');
        $st->execute([$username]);
        $admin = $st->fetch();

        if ($admin === false) {
            // Выравниваем время ответа, чтобы по нему нельзя было отличить «нет такого логина»
            password_verify($password, $this->dummyHash());
            $this->audit->write($request, 'admin.login_failed', null, null, null, ['reason' => 'unknown_user'], $username);
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.');
        }

        $adminId = (int) $admin['id'];

        if ($admin['locked_until'] !== null && Clock::ms(Clock::fromDb((string) $admin['locked_until'])) > Clock::ms($now)) {
            $this->audit->write($request, 'admin.login_blocked', $adminId, 'admin_user', (string) $adminId, ['reason' => 'locked']);
            throw new HttpException(429, 'ACCOUNT_LOCKED', 'Слишком много неудачных попыток входа. Повторите позже.');
        }

        $ok = (int) $admin['is_active'] === 1 && password_verify($password, (string) $admin['password_hash']);
        if (!$ok) {
            $failed = (int) $admin['failed_logins'] + 1;
            $lockedUntil = null;
            if ($failed >= $this->config->adminMaxFailedLogins) {
                $lockedUntil = Clock::db(Clock::fromMs(Clock::ms($now) + $this->config->adminLockMinutes * 60000));
                $failed = 0;
            }
            $upd = $this->pdo->prepare('UPDATE admin_users SET failed_logins = ?, locked_until = ? WHERE id = ?');
            $upd->execute([$failed, $lockedUntil, $adminId]);
            $this->audit->write($request, 'admin.login_failed', $adminId, 'admin_user', (string) $adminId, [
                'reason' => (int) $admin['is_active'] === 1 ? 'bad_password' : 'inactive',
                'locked' => $lockedUntil !== null,
            ]);
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Неверный логин или пароль.');
        }

        if (password_needs_rehash((string) $admin['password_hash'], PASSWORD_DEFAULT)) {
            $re = $this->pdo->prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?');
            $re->execute([password_hash($password, PASSWORD_DEFAULT), $adminId]);
        }

        $token = bin2hex(random_bytes(32));
        $expires = Clock::fromMs(Clock::ms($now) + $this->config->adminTokenTtlMinutes * 60000);
        $upd = $this->pdo->prepare(
            'UPDATE admin_users
                SET token_hash = ?, token_expires_at = ?, failed_logins = 0, locked_until = NULL, last_login_at = ?
              WHERE id = ?'
        );
        $upd->execute([hash('sha256', $token), Clock::db($expires), Clock::db($now), $adminId]);
        $this->audit->write($request, 'admin.login', $adminId, 'admin_user', (string) $adminId);

        return ['token' => $token, 'expiresAt' => Clock::iso($expires)];
    }

    /**
     * Администратор по токену из заголовка Authorization или null.
     *
     * @return array{id:int,username:string}|null
     */
    public function authenticate(?string $token): ?array
    {
        if ($token === null || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            return null;
        }
        $st = $this->pdo->prepare(
            'SELECT id, username, token_expires_at FROM admin_users WHERE token_hash = ? AND is_active = 1'
        );
        $st->execute([hash('sha256', $token)]);
        $row = $st->fetch();
        if ($row === false || $row['token_expires_at'] === null) {
            return null;
        }
        if (Clock::ms(Clock::fromDb((string) $row['token_expires_at'])) <= Clock::ms($this->clock->now())) {
            return null;
        }
        return ['id' => (int) $row['id'], 'username' => (string) $row['username']];
    }

    public function logout(Request $request, int $adminId): void
    {
        $st = $this->pdo->prepare('UPDATE admin_users SET token_hash = NULL, token_expires_at = NULL WHERE id = ?');
        $st->execute([$adminId]);
        $this->audit->write($request, 'admin.logout', $adminId, 'admin_user', (string) $adminId);
    }

    private function dummyHash(): string
    {
        return $this->dummyHash ??= password_hash(bin2hex(random_bytes(8)), PASSWORD_DEFAULT);
    }
}
