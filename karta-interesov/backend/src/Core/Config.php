<?php

declare(strict_types=1);

namespace Karta\Core;

use RuntimeException;

final class Config
{
    /** @param string[] $corsOrigins */
    public function __construct(
        public readonly string $appEnv,
        public readonly bool $debug,
        public readonly string $apiBasePath,
        public readonly array $corsOrigins,
        public readonly string $dbHost,
        public readonly int $dbPort,
        public readonly string $dbName,
        public readonly string $dbUser,
        public readonly string $dbPassword,
        public readonly string $testVersion,
        public readonly int $questionTimeMs,
        public readonly int $answerGraceMs,
        public readonly int $skipToleranceMs,
        public readonly int $adminTokenTtlMinutes,
        public readonly int $adminMaxFailedLogins,
        public readonly int $adminLockMinutes,
        public readonly string $catalogDir,
        public readonly string $logFile,
        public readonly int $maxBodyBytes,
    ) {
    }

    public static function backendRoot(): string
    {
        return dirname(__DIR__, 2);
    }

    public static function fromEnv(): self
    {
        Env::load(self::backendRoot() . DIRECTORY_SEPARATOR . '.env');

        $appEnv = Env::get('APP_ENV', 'local') ?? 'local';
        if (!in_array($appEnv, ['local', 'production'], true)) {
            throw new RuntimeException('APP_ENV должен быть local или production.');
        }
        $isProd = $appEnv === 'production';

        $debug = self::bool('APP_DEBUG', false);
        if ($isProd && $debug) {
            throw new RuntimeException('APP_DEBUG=true запрещён при APP_ENV=production.');
        }

        $basePath = rtrim(Env::get('API_BASE_PATH', '/api/v1') ?? '/api/v1', '/');
        if ($basePath !== '' && $basePath[0] !== '/') {
            throw new RuntimeException('API_BASE_PATH должен начинаться с "/".');
        }

        $origins = [];
        foreach (explode(',', Env::get('CORS_ALLOWED_ORIGINS', '') ?? '') as $o) {
            $o = rtrim(trim($o), '/');
            if ($o === '') {
                continue;
            }
            if ($o === '*' || !preg_match('#^https?://[^/\s]+$#i', $o)) {
                throw new RuntimeException('CORS_ALLOWED_ORIGINS: недопустимое значение "' . $o . '" (нужен origin вида http://host:port).');
            }
            $origins[] = $o;
        }

        $dbName = self::required('DB_NAME');
        if (!preg_match('/^[A-Za-z0-9_]{1,64}$/', $dbName)) {
            throw new RuntimeException('DB_NAME может содержать только латинские буквы, цифры и "_".');
        }
        $dbPassword = Env::get('DB_PASSWORD', '') ?? '';
        if ($isProd && $dbPassword === '') {
            throw new RuntimeException('DB_PASSWORD не может быть пустым при APP_ENV=production.');
        }

        $root = self::backendRoot();
        $catalogDir = Env::get('CATALOG_DIR');
        if ($catalogDir === null || $catalogDir === '') {
            $catalogDir = dirname($root) . DIRECTORY_SEPARATOR . 'docs' . DIRECTORY_SEPARATOR . 'data';
        }
        $logFile = Env::get('LOG_FILE');
        if ($logFile === null || $logFile === '') {
            $logFile = $root . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'logs' . DIRECTORY_SEPARATOR . 'app.log';
        }

        return new self(
            $appEnv,
            $debug,
            $basePath,
            $origins,
            Env::get('DB_HOST', '127.0.0.1') ?? '127.0.0.1',
            self::int('DB_PORT', 3306, 1, 65535),
            $dbName,
            self::required('DB_USER'),
            $dbPassword,
            Env::get('TEST_VERSION', 'golomshtok-174-v1') ?? 'golomshtok-174-v1',
            self::int('QUESTION_TIME_MS', 15000, 1000, 600000),
            self::int('ANSWER_GRACE_MS', 1000, 0, 30000),
            self::int('SKIP_TOLERANCE_MS', 1000, 0, 30000),
            self::int('ADMIN_TOKEN_TTL_MINUTES', 480, 5, 10080),
            self::int('ADMIN_MAX_FAILED_LOGINS', 5, 1, 100),
            self::int('ADMIN_LOCK_MINUTES', 15, 1, 1440),
            $catalogDir,
            $logFile,
            65536,
        );
    }

    private static function required(string $key): string
    {
        $v = Env::get($key);
        if ($v === null || trim($v) === '') {
            throw new RuntimeException("Не задана переменная окружения {$key} (см. backend/.env.example).");
        }
        return trim($v);
    }

    private static function int(string $key, int $default, int $min, int $max): int
    {
        $raw = Env::get($key);
        if ($raw === null || trim($raw) === '') {
            return $default;
        }
        if (!preg_match('/^-?\d+$/', trim($raw))) {
            throw new RuntimeException("{$key} должно быть целым числом.");
        }
        $v = (int) trim($raw);
        if ($v < $min || $v > $max) {
            throw new RuntimeException("{$key} должно быть в диапазоне {$min}…{$max}.");
        }
        return $v;
    }

    private static function bool(string $key, bool $default): bool
    {
        $raw = Env::get($key);
        if ($raw === null || trim($raw) === '') {
            return $default;
        }
        return in_array(strtolower(trim($raw)), ['1', 'true', 'yes', 'on'], true);
    }
}
