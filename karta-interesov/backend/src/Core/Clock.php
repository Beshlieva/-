<?php

declare(strict_types=1);

namespace Karta\Core;

use DateTimeImmutable;
use DateTimeZone;

/** Серверное время (UTC) — единственный источник времени для таймера. Время браузера не используется. */
final class Clock
{
    public function now(): DateTimeImmutable
    {
        return new DateTimeImmutable('now', new DateTimeZone('UTC'));
    }

    /** Формат DATETIME(3) для MySQL. */
    public static function db(DateTimeImmutable $d): string
    {
        return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s.v');
    }

    public static function fromDb(string $s): DateTimeImmutable
    {
        return new DateTimeImmutable($s, new DateTimeZone('UTC'));
    }

    public static function iso(DateTimeImmutable $d): string
    {
        return $d->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.v\Z');
    }

    public static function fromMs(int $ms): DateTimeImmutable
    {
        $d = DateTimeImmutable::createFromFormat('U.v', sprintf('%d.%03d', intdiv($ms, 1000), $ms % 1000), new DateTimeZone('UTC'));
        if ($d === false) {
            throw new \RuntimeException('Не удалось построить дату из миллисекунд.');
        }
        return $d;
    }

    /** Миллисекунды с начала эпохи. */
    public static function ms(DateTimeImmutable $d): int
    {
        return $d->getTimestamp() * 1000 + intdiv((int) $d->format('u'), 1000);
    }
}
