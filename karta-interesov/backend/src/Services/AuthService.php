<?php

declare(strict_types=1);

namespace Karta\Services;

use Karta\Core\Clock;
use Karta\Core\HttpException;
use PDO;
use PDOException;

/**
 * Регистрация и вход студентов по email + паролю.
 *
 * - Пароль хранится только как password_hash(); токен доступа - как SHA-256 (как и раньше).
 * - Токен выдаётся один раз в ответе. При входе выдаётся НОВЫЙ токен, прежний перестаёт действовать
 *   (одна активная сессия на пользователя).
 * - Повторная регистрация с занятым email никогда не возвращает токен существующего аккаунта.
 */
final class AuthService
{
    public const MAX_FAILED_LOGINS = 5;
    public const LOCK_MINUTES = 15;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Clock $clock,
        private readonly Catalog $catalog,
    ) {
    }

    /**
     * @return array<string,mixed>
     */
    public function register(string $firstName, string $lastName, string $email, int $age, string $regionCode, string $password): array
    {
        $regionId = $this->catalog->regionIdByCode($regionCode);
        if ($regionId === null) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['regionCode' => 'Выберите регион из списка.']]);
        }

        $displayName = $firstName . ' ' . $lastName;
        if (mb_strlen($displayName, 'UTF-8') > 100) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['lastName' => 'Имя и фамилия вместе не должны быть длиннее 100 символов.']]);
        }

        $token = bin2hex(random_bytes(32));
        $now = $this->clock->now();
        try {
            $st = $this->pdo->prepare(
                'INSERT INTO users (email, password_hash, display_name, age, region_id, access_token_hash, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)'
            );
            $st->execute([
                $email,
                password_hash($password, PASSWORD_DEFAULT),
                $displayName,
                $age,
                $regionId,
                hash('sha256', $token),
                Clock::db($now),
            ]);
        } catch (PDOException $e) {
            // Уникальный индекс users.email - единственная настоящая защита от дубликатов (в том числе при гонке запросов)
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(
                    409,
                    'EMAIL_ALREADY_REGISTERED',
                    'Пользователь с таким email уже зарегистрирован. Войдите в существующую учётную запись.'
                );
            }
            throw $e;
        }

        return [
            'userId' => (string) $this->pdo->lastInsertId(),
            'email' => $email,
            'displayName' => $displayName,
            'age' => $age,
            'regionCode' => $regionCode,
            'accessToken' => $token,
            'createdAt' => Clock::iso($now),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    public function login(string $email, string $password): array
    {
        $st = $this->pdo->prepare(
            'SELECT u.id, u.email, u.password_hash, u.display_name, u.age, r.code AS region_code, u.created_at, u.failed_logins, u.locked_until
               FROM users u LEFT JOIN regions r ON r.id = u.region_id
              WHERE u.email = ?'
        );
        $st->execute([$email]);
        $row = $st->fetch();

        $now = $this->clock->now();
        $hash = $row !== false && is_string($row['password_hash']) && $row['password_hash'] !== '' ? $row['password_hash'] : null;

        if ($row !== false && $row['locked_until'] !== null && Clock::fromDb((string) $row['locked_until']) > $now) {
            throw new HttpException(429, 'LOGIN_LOCKED', 'Слишком много неудачных попыток входа. Попробуйте позже.');
        }

        // Пароль проверяется всегда (для несуществующего email - по фиктивному хэшу),
        // чтобы время ответа не выдавало, есть ли такой пользователь.
        $ok = password_verify($password, $hash ?? self::dummyHash());
        if ($row === false || $hash === null || !$ok) {
            if ($row !== false) {
                $this->registerFailure((int) $row['id'], (int) $row['failed_logins']);
            }
            throw new HttpException(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль.');
        }

        $token = bin2hex(random_bytes(32));
        $upd = $this->pdo->prepare(
            'UPDATE users SET access_token_hash = ?, failed_logins = 0, locked_until = NULL WHERE id = ?'
        );
        $upd->execute([hash('sha256', $token), (int) $row['id']]);

        if (password_needs_rehash($hash, PASSWORD_DEFAULT)) {
            $re = $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $re->execute([password_hash($password, PASSWORD_DEFAULT), (int) $row['id']]);
        }

        return [
            'userId' => (string) $row['id'],
            'email' => $row['email'],
            'displayName' => $row['display_name'],
            'age' => $row['age'] === null ? null : (int) $row['age'],
            'regionCode' => $row['region_code'],
            'accessToken' => $token,
            'createdAt' => Clock::iso(Clock::fromDb((string) $row['created_at'])),
        ];
    }

    /** Выход: токен заменяется случайным значением, прежний перестаёт работать. */
    public function logout(int $userId): void
    {
        $st = $this->pdo->prepare('UPDATE users SET access_token_hash = ? WHERE id = ?');
        $st->execute([hash('sha256', bin2hex(random_bytes(32))), $userId]);
    }

    private function registerFailure(int $userId, int $previous): void
    {
        $count = $previous + 1;
        $lockedUntil = null;
        if ($count >= self::MAX_FAILED_LOGINS) {
            $lockedUntil = Clock::db($this->clock->now()->modify('+' . self::LOCK_MINUTES . ' minutes'));
            $count = 0;
        }
        $st = $this->pdo->prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?');
        $st->execute([$count, $lockedUntil, $userId]);
    }

    private static function dummyHash(): string
    {
        static $hash = null;
        return $hash ??= password_hash('dummy-password-for-timing', PASSWORD_DEFAULT);
    }
}
