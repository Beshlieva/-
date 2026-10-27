<?php

declare(strict_types=1);

namespace Karta\Core;

final class Response
{
    /**
     * @param array<string,mixed>|null $body
     * @param array<string,string> $headers
     */
    public function __construct(
        public int $status,
        public ?array $body = null,
        public array $headers = [],
        /** Готовое тело не в формате JSON (например, CSV). Если задано — $body игнорируется. */
        public ?string $raw = null,
    ) {
    }

    public function withHeader(string $name, string $value): self
    {
        $this->headers[$name] = $value;
        return $this;
    }

    public function send(): void
    {
        http_response_code($this->status);
        $headers = [
            'X-Content-Type-Options' => 'nosniff',
            'X-Frame-Options' => 'DENY',
            'Referrer-Policy' => 'no-referrer',
            'Cache-Control' => 'no-store',
        ];
        foreach (array_merge($headers, $this->headers) as $name => $value) {
            header($name . ': ' . $value);
        }
        if ($this->raw !== null) {
            echo $this->raw;
            return;
        }
        if ($this->body === null || $this->status === 204) {
            return;
        }
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode($this->body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    /** CSV в UTF-8 с BOM (Excel сам определяет кодировку) как скачиваемый файл. */
    public static function csv(string $content, string $filename): self
    {
        return new self(200, null, [
            'Content-Type' => 'text/csv; charset=utf-8',
            'Content-Disposition' => 'attachment; filename="' . $filename . '"',
        ], "\xEF\xBB\xBF" . $content);
    }

    /** @param array<string,mixed> $data */
    public static function json(int $status, array $data): self
    {
        return new self($status, $data);
    }

    /** @param array<string,mixed> $details */
    public static function error(int $status, string $code, string $message, array $details = []): self
    {
        $error = ['code' => $code, 'message' => $message];
        if ($details !== []) {
            $error['details'] = $details;
        }
        return new self($status, ['error' => $error]);
    }
}
