<?php

declare(strict_types=1);

namespace Karta\Services;

use Karta\Core\Clock;
use Karta\Core\HttpException;
use PDO;
use PDOException;

final class UserService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly Clock $clock,
        private readonly Catalog $catalog,
    ) {
    }

    /**
     * Создать пользователя. Токен доступа возвращается один раз; в БД хранится только его SHA-256.
     *
     * @return array<string,mixed>
     */
    public function create(?string $email, ?string $displayName, ?string $regionCode): array
    {
        $regionId = null;
        if ($regionCode !== null) {
            $regionId = $this->catalog->regionIdByCode($regionCode);
            if ($regionId === null) {
                throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['regionCode' => 'Неизвестный регион.']]);
            }
        }

        $token = bin2hex(random_bytes(32));
        $now = $this->clock->now();
        try {
            $st = $this->pdo->prepare(
                'INSERT INTO users (email, display_name, region_id, access_token_hash, created_at) VALUES (?, ?, ?, ?, ?)'
            );
            $st->execute([$email, $displayName, $regionId, hash('sha256', $token), Clock::db($now)]);
        } catch (PDOException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                throw new HttpException(409, 'EMAIL_ALREADY_REGISTERED', 'Пользователь с таким email уже зарегистрирован.');
            }
            throw $e;
        }

        return [
            'userId' => (string) $this->pdo->lastInsertId(),
            'email' => $email,
            'displayName' => $displayName,
            'regionCode' => $regionCode,
            'accessToken' => $token,
            'createdAt' => Clock::iso($now),
        ];
    }

    /**
     * Пользователь по токену доступа или null.
     *
     * @return array{id:int,email:?string,display_name:?string,age:?int,region_id:?int,region_code:?string,created_at:string}|null
     */
    public function findByToken(string $token): ?array
    {
        if (preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            return null;
        }
        $st = $this->pdo->prepare(
            'SELECT u.id, u.email, u.display_name, u.age, u.region_id, r.code AS region_code, u.created_at
               FROM users u LEFT JOIN regions r ON r.id = u.region_id
              WHERE u.access_token_hash = ?'
        );
        $st->execute([hash('sha256', $token)]);
        $row = $st->fetch();
        if ($row === false) {
            return null;
        }
        return [
            'id' => (int) $row['id'],
            'email' => $row['email'],
            'display_name' => $row['display_name'],
            'age' => $row['age'] === null ? null : (int) $row['age'],
            'region_id' => $row['region_id'] === null ? null : (int) $row['region_id'],
            'region_code' => $row['region_code'],
            'created_at' => $row['created_at'],
        ];
    }
}
