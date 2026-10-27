<?php

declare(strict_types=1);

namespace Karta\Core;

final class Request
{
    /**
     * @param array<string,string> $headers имена в нижнем регистре
     * @param array<string,mixed> $query
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly array $headers,
        public readonly string $rawBody,
        public readonly string $ip,
        public readonly string $userAgent,
    ) {
    }

    public static function fromGlobals(Config $config): self
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = rawurldecode((string) parse_url($uri, PHP_URL_PATH));

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($value) && strncmp($key, 'HTTP_', 5) === 0) {
                $headers[strtolower(str_replace('_', '-', substr($key, 5)))] = $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE']) && is_string($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = $_SERVER['CONTENT_TYPE'];
        }
        if (!isset($headers['authorization']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) && is_string($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $headers['authorization'] = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }

        $raw = '';
        if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
            $read = file_get_contents('php://input', false, null, 0, $config->maxBodyBytes + 1);
            $raw = $read === false ? '' : $read;
            if (strlen($raw) > $config->maxBodyBytes) {
                throw new HttpException(413, 'PAYLOAD_TOO_LARGE', 'Слишком большое тело запроса.');
            }
        }

        return new self(
            $method,
            $path,
            $_GET,
            $headers,
            $raw,
            (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
            substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255),
        );
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    public function bearerToken(): ?string
    {
        $h = $this->header('authorization');
        if ($h !== null && preg_match('/^Bearer\s+([A-Za-z0-9._~+\/-]{1,512})$/', trim($h), $m) === 1) {
            return $m[1];
        }
        return null;
    }

    public function queryString(string $key): ?string
    {
        $v = $this->query[$key] ?? null;
        return is_string($v) ? $v : null;
    }

    /**
     * Тело запроса как JSON-объект. Пустое тело = пустой объект.
     *
     * @return array<string,mixed>
     */
    public function json(): array
    {
        if (trim($this->rawBody) === '') {
            return [];
        }
        $type = strtolower((string) $this->header('content-type'));
        if (strncmp($type, 'application/json', 16) !== 0) {
            throw new HttpException(415, 'UNSUPPORTED_MEDIA_TYPE', 'Ожидается Content-Type: application/json.');
        }
        try {
            $data = json_decode($this->rawBody, true, 16, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpException(400, 'INVALID_JSON', 'Тело запроса не является корректным JSON.');
        }
        if (!is_array($data) || ($data !== [] && array_is_list($data))) {
            throw new HttpException(400, 'INVALID_JSON', 'Ожидался JSON-объект.');
        }
        return $data;
    }
}
