<?php

declare(strict_types=1);

namespace Karta\Core;

use PDO;

final class Database
{
    /** Подключение к БД. $withDatabase=false — без выбора базы (нужно для создания БД). */
    public static function connect(Config $c, bool $withDatabase = true): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%d;%scharset=utf8mb4',
            $c->dbHost,
            $c->dbPort,
            $withDatabase ? 'dbname=' . $c->dbName . ';' : '',
        );
        return new PDO($dsn, $c->dbUser, $c->dbPassword, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            // Нативные подготовленные запросы: значения никогда не подставляются в SQL-текст
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::MYSQL_ATTR_INIT_COMMAND => "SET time_zone = '+00:00'",
        ]);
    }
}
