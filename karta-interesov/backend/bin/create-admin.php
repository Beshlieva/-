<?php

declare(strict_types=1);

// Создать администратора или сменить пароль:
//   php bin/create-admin.php --username=<логин> [--reset-password]
// Пароль вводится в консоли (или берётся из переменной окружения KARTA_ADMIN_PASSWORD).
// В БД сохраняется только хэш (password_hash). Пароль нигде не записывается.
require __DIR__ . '/_bootstrap.php';

use Karta\Core\Clock;
use Karta\Core\Database;
use Karta\Core\Logger;
use Karta\Core\Request;
use Karta\Services\AuditLog;

$config = karta_config();

$username = null;
foreach ($argv as $arg) {
    if (str_starts_with($arg, '--username=')) {
        $username = substr($arg, strlen('--username='));
    }
}
$reset = in_array('--reset-password', $argv, true);
$allowWeakLocalPassword = in_array('--allow-weak-local-password', $argv, true);

if ($allowWeakLocalPassword && $config->appEnv !== 'local') {
    fwrite(STDERR, "Ослабление пароля разрешено только при APP_ENV=local.\n");
    exit(1);
}

if ($username === null || preg_match('/^[A-Za-z0-9._-]{3,64}$/', $username) !== 1) {
    fwrite(STDERR, "Укажите логин: --username=<3-64 символа: латиница, цифры, . _ ->\n");
    exit(1);
}

function karta_read_line(string $prompt, bool $hidden): string
{
    fwrite(STDOUT, $prompt);
    $canHide = $hidden && PHP_OS_FAMILY !== 'Windows' && function_exists('shell_exec');
    if ($canHide) {
        shell_exec('stty -echo');
    } elseif ($hidden) {
        fwrite(STDOUT, "[ввод будет виден в консоли] ");
    }
    $line = fgets(STDIN);
    if ($canHide) {
        shell_exec('stty echo');
        fwrite(STDOUT, "\n");
    }
    return $line === false ? '' : rtrim($line, "\r\n");
}

$password = getenv('KARTA_ADMIN_PASSWORD');
if ($password === false || $password === '') {
    $password = karta_read_line(
        'Пароль (не короче ' . ($allowWeakLocalPassword ? '8' : '12') . ' символов): ',
        true,
    );
    $again = karta_read_line('Повторите пароль: ', true);
    if ($password !== $again) {
        fwrite(STDERR, "Пароли не совпадают.\n");
        exit(1);
    }
}
if (mb_strlen($password, 'UTF-8') < ($allowWeakLocalPassword ? 8 : 12) || strlen($password) > 1024) {
    $minimumLength = $allowWeakLocalPassword ? 8 : 12;
    fwrite(STDERR, "Пароль должен быть от {$minimumLength} символов (и не длиннее 1024 байт).\n");
    exit(1);
}
if (strcasecmp($password, $username) === 0) {
    fwrite(STDERR, "Пароль не должен совпадать с логином.\n");
    exit(1);
}

try {
    $pdo = Database::connect($config);
    $clock = new Clock();
    $audit = new AuditLog($pdo, $clock, new Logger($config->logFile));
    $ctx = new Request('CLI', '/', [], [], '', 'cli', 'bin/create-admin.php');
    $hash = password_hash($password, PASSWORD_DEFAULT);

    $st = $pdo->prepare('SELECT id FROM admin_users WHERE username = ?');
    $st->execute([$username]);
    $existing = $st->fetchColumn();

    if ($existing === false) {
        $ins = $pdo->prepare('INSERT INTO admin_users (username, password_hash, is_active, created_at) VALUES (?, ?, 1, ?)');
        $ins->execute([$username, $hash, Clock::db($clock->now())]);
        $id = (int) $pdo->lastInsertId();
        $audit->write($ctx, 'admin.created', $id, 'admin_user', (string) $id);
        karta_say("Администратор {$username} создан.");
    } elseif ($reset) {
        $upd = $pdo->prepare(
            'UPDATE admin_users SET password_hash = ?, token_hash = NULL, token_expires_at = NULL, failed_logins = 0, locked_until = NULL, is_active = 1 WHERE id = ?'
        );
        $upd->execute([$hash, (int) $existing]);
        $audit->write($ctx, 'admin.password_reset', (int) $existing, 'admin_user', (string) $existing);
        karta_say("Пароль администратора {$username} изменён, активные сессии сброшены.");
    } else {
        fwrite(STDERR, "Администратор {$username} уже существует. Для смены пароля добавьте --reset-password.\n");
        exit(1);
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Ошибка: ' . $e->getMessage() . "\n");
    exit(1);
}
