<?php

declare(strict_types=1);

namespace Karta\Core;

/** Строгая проверка JSON-объекта запроса. Ошибки собираются и выбрасываются одним исключением 422. */
final class Validator
{
    /** @var array<string,string> */
    private array $errors = [];

    /** @param array<string,mixed> $data */
    public function __construct(private readonly array $data)
    {
    }

    /** @param string[] $allowed */
    public function onlyKeys(array $allowed): self
    {
        foreach (array_keys($this->data) as $key) {
            if (!in_array((string) $key, $allowed, true)) {
                $this->errors[(string) $key] = 'Неизвестное поле.';
            }
        }
        return $this;
    }

    /** Только настоящее JSON-целое: "5", 5.0 и true не принимаются. */
    public function int(string $field, bool $required = true, ?int $min = null, ?int $max = null): ?int
    {
        if (!array_key_exists($field, $this->data) || $this->data[$field] === null) {
            if ($required) {
                $this->errors[$field] = 'Обязательное поле.';
            }
            return null;
        }
        $v = $this->data[$field];
        if (!is_int($v)) {
            $this->errors[$field] = 'Ожидается целое число.';
            return null;
        }
        if (($min !== null && $v < $min) || ($max !== null && $v > $max)) {
            $this->errors[$field] = "Значение должно быть в диапазоне {$min}…{$max}.";
            return null;
        }
        return $v;
    }

    public function string(string $field, bool $required = true, int $min = 0, int $max = 255, ?string $pattern = null): ?string
    {
        if (!array_key_exists($field, $this->data) || $this->data[$field] === null) {
            if ($required) {
                $this->errors[$field] = 'Обязательное поле.';
            }
            return null;
        }
        $v = $this->data[$field];
        if (!is_string($v)) {
            $this->errors[$field] = 'Ожидается строка.';
            return null;
        }
        $v = trim($v);
        $len = mb_strlen($v, 'UTF-8');
        if ($len < $min || $len > $max) {
            $this->errors[$field] = "Длина должна быть от {$min} до {$max} символов.";
            return null;
        }
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $v) === 1) {
            $this->errors[$field] = 'Недопустимые управляющие символы.';
            return null;
        }
        if ($pattern !== null && preg_match($pattern, $v) !== 1) {
            $this->errors[$field] = 'Недопустимый формат.';
            return null;
        }
        return $v;
    }

    public function email(string $field, bool $required = false): ?string
    {
        $v = $this->string($field, $required, 3, 254);
        if ($v === null) {
            return null;
        }
        if (filter_var($v, FILTER_VALIDATE_EMAIL) === false) {
            $this->errors[$field] = 'Некорректный email.';
            return null;
        }
        return mb_strtolower($v, 'UTF-8');
    }

    /**
     * Пароль: строка БЕЗ обрезки пробелов. Длина считается в байтах: bcrypt учитывает только первые 72 байта.
     */
    public function password(string $field, int $minChars = 8, int $maxBytes = 72): ?string
    {
        if (!array_key_exists($field, $this->data) || $this->data[$field] === null) {
            $this->errors[$field] = 'Обязательное поле.';
            return null;
        }
        $v = $this->data[$field];
        if (!is_string($v)) {
            $this->errors[$field] = 'Ожидается строка.';
            return null;
        }
        if ($v === '') {
            $this->errors[$field] = 'Обязательное поле.';
            return null;
        }
        if (mb_strlen($v, 'UTF-8') < $minChars) {
            $this->errors[$field] = "Пароль должен содержать не менее {$minChars} символов.";
            return null;
        }
        if (strlen($v) > $maxBytes) {
            $this->errors[$field] = 'Пароль слишком длинный (не более 72 байт).';
            return null;
        }
        return $v;
    }

    public function assertValid(): void
    {
        if ($this->errors !== []) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => $this->errors]);
        }
    }

    /** Дата из query-параметра YYYY-MM-DD (UTC) или null, если параметр не задан. */
    public static function queryDate(?string $value, string $field): ?\DateTimeImmutable
    {
        if ($value === null || $value === '') {
            return null;
        }
        $d = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, new \DateTimeZone('UTC'));
        $errs = \DateTimeImmutable::getLastErrors();
        $bad = $d === false || ($errs !== false && ($errs['warning_count'] > 0 || $errs['error_count'] > 0));
        if ($bad) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => [$field => 'Ожидается дата YYYY-MM-DD.']]);
        }
        return $d;
    }
}
