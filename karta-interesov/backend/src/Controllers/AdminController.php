<?php

declare(strict_types=1);

namespace Karta\Controllers;

use Karta\Core\HttpException;
use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Core\Validator;
use Karta\Services\AdminAuthService;
use Karta\Services\AnalyticsService;
use Karta\Services\AuditLog;

final class AdminController
{
    public function __construct(
        private readonly AdminAuthService $auth,
        private readonly AnalyticsService $analytics,
        private readonly AuditLog $audit,
    ) {
    }

    /** POST /admin/login */
    public function login(Request $r, array $params, array $ctx): Response
    {
        $body = $r->json();
        $v = new Validator($body);
        $v->onlyKeys(['username', 'password']);
        $username = $v->string('username', true, 1, 64);
        $v->assertValid();

        // Пароль не обрезается и не нормализуется: пробелы по краям могут быть частью пароля
        $password = $body['password'] ?? null;
        if (!is_string($password) || $password === '' || strlen($password) > 1024) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', [
                'fields' => ['password' => 'Ожидается непустая строка до 1024 байт.'],
            ]);
        }

        $res = $this->auth->login($r, (string) $username, $password);
        return Response::json(200, ['token' => $res['token'], 'tokenType' => 'Bearer', 'expiresAt' => $res['expiresAt']]);
    }

    /** POST /admin/logout */
    public function logout(Request $r, array $params, array $ctx): Response
    {
        $this->auth->logout($r, $ctx['admin']['id']);
        return new Response(204);
    }

    /** GET /admin/analytics/summary */
    public function summary(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        $data = $this->analytics->summary($region, $from, $to);
        $this->audit->write($r, 'analytics.summary.view', $ctx['admin']['id'], null, null, $this->filterDetails($r));
        return Response::json(200, $data);
    }

    /** GET /admin/analytics/regions */
    public function regions(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        $data = $this->analytics->regions($region, $from, $to);
        $this->audit->write($r, 'analytics.regions.view', $ctx['admin']['id'], null, null, $this->filterDetails($r));
        return Response::json(200, $data);
    }

    /** GET /admin/attempts */
    public function attempts(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        [$page, $size] = $this->paging($r);
        $data = $this->analytics->attempts($region, $from, $to, $page, $size);
        $this->audit->write($r, 'attempts.list.view', $ctx['admin']['id'], null, null, $this->filterDetails($r) + ['page' => $page, 'pageSize' => $size]);
        return Response::json(200, $data);
    }

    /** GET /admin/analytics/overview */
    public function overview(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        $data = $this->analytics->overview($region, $from, $to);
        $this->audit->write($r, 'analytics.overview.view', $ctx['admin']['id'], null, null, $this->filterDetails($r));
        return Response::json(200, $data);
    }

    /** GET /admin/users */
    public function users(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        [$page, $size] = $this->paging($r);
        $q = $this->search($r);
        $data = $this->analytics->users($region, $from, $to, $q, $page, $size);
        $this->audit->write($r, 'users.list.view', $ctx['admin']['id'], null, null, $this->filterDetails($r) + ['page' => $page, 'pageSize' => $size]);
        return Response::json(200, $data);
    }

    /** GET /admin/results */
    public function results(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        [$page, $size] = $this->paging($r);
        $q = $this->search($r);
        $data = $this->analytics->results($region, $from, $to, $q, $page, $size);
        $this->audit->write($r, 'results.list.view', $ctx['admin']['id'], null, null, $this->filterDetails($r) + ['page' => $page, 'pageSize' => $size]);
        return Response::json(200, $data);
    }

    /** GET /admin/results/{id} */
    public function resultDetail(Request $r, array $params, array $ctx): Response
    {
        $id = (int) $params['id'];
        $data = $this->analytics->resultDetail($id);
        $this->audit->write($r, 'results.detail.view', $ctx['admin']['id'], 'attempt', (string) $id);
        return Response::json(200, $data);
    }

    /** GET /admin/export/results.csv — UTF-8 с BOM, разделитель «;» (так CSV открывается в Excel с русской локалью). */
    public function exportResults(Request $r, array $params, array $ctx): Response
    {
        [$region, $from, $to] = $this->filters($r);
        $q = $this->search($r);
        $data = $this->analytics->exportRows($region, $from, $to, $q);

        $names = [];
        $header = ['ID попытки', 'Дата завершения (UTC)', 'Имя', 'Email', 'Возраст', 'Регион', 'Отвечено вопросов'];
        foreach ($data['categories'] as $c) {
            $names[$c['id']] = $c['name'];
            $header[] = $c['name'] . ' (баллы 0–100)';
        }
        for ($i = 1; $i <= 5; $i++) {
            $header[] = 'Направление №' . $i;
        }

        $lines = [$this->csvLine($header)];
        foreach ($data['rows'] as $row) {
            $line = [
                $row['attemptId'], $row['completedAt'], $row['name'], $row['email'],
                $row['age'] ?? '', $row['region'], $row['answeredCount'],
            ];
            foreach ($data['categories'] as $c) {
                $line[] = $row['display'][$c['id']] ?? '';
            }
            for ($i = 1; $i <= 5; $i++) {
                $line[] = isset($row['ranks'][$i]) ? ($names[$row['ranks'][$i]] ?? '') : '';
            }
            $lines[] = $this->csvLine($line);
        }

        $this->audit->write($r, 'results.export', $ctx['admin']['id'], null, null, $this->filterDetails($r) + ['rows' => count($data['rows'])]);
        return Response::csv(implode("\r\n", $lines) . "\r\n", 'karta-interesov-results.csv');
    }

    /** @param array<int,mixed> $cells */
    private function csvLine(array $cells): string
    {
        return implode(';', array_map(function (mixed $v): string {
            $s = (string) $v;
            // Защита от формул Excel: ячейка, начинающаяся с = + - @ или табуляции, станет обычным текстом
            if ($s !== '' && strpbrk($s[0], "=+-@\t\r") !== false) {
                $s = "'" . $s;
            }
            return '"' . str_replace('"', '""', $s) . '"';
        }, $cells));
    }

    /** Строка поиска по имени и email: до 100 символов, без управляющих символов. */
    private function search(Request $r): ?string
    {
        $q = $r->queryString('q');
        if ($q === null) {
            return null;
        }
        $q = trim((string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $q));
        if ($q === '') {
            return null;
        }
        if (mb_strlen($q, 'UTF-8') > 100) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['q' => 'Не длиннее 100 символов.']]);
        }
        return $q;
    }

    /** GET /admin/audit-logs */
    public function auditLogs(Request $r, array $params, array $ctx): Response
    {
        [$page, $size] = $this->paging($r);
        $data = $this->analytics->auditLogs($page, $size);
        $this->audit->write($r, 'audit_logs.view', $ctx['admin']['id'], null, null, ['page' => $page, 'pageSize' => $size]);
        return Response::json(200, $data);
    }

    /** @return array{0:?string,1:?\DateTimeImmutable,2:?\DateTimeImmutable} */
    private function filters(Request $r): array
    {
        $region = $r->queryString('regionCode');
        if ($region === '') {
            $region = null;
        }
        if ($region !== null && preg_match('/^[a-z0-9-]{1,40}$/', $region) !== 1) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', [
                'fields' => ['regionCode' => 'Недопустимый формат.'],
            ]);
        }
        $from = Validator::queryDate($r->queryString('dateFrom'), 'dateFrom');
        $to = Validator::queryDate($r->queryString('dateTo'), 'dateTo');
        return [$region, $from, $to];
    }

    /** @return array{0:int,1:int} */
    private function paging(Request $r): array
    {
        $page = $r->queryString('page');
        $size = $r->queryString('pageSize');
        $fields = [];
        if ($page !== null && preg_match('/^[0-9]{1,6}$/', $page) !== 1) {
            $fields['page'] = 'Ожидается положительное целое.';
        }
        if ($size !== null && preg_match('/^[0-9]{1,3}$/', $size) !== 1) {
            $fields['pageSize'] = 'Ожидается целое от 1 до 100.';
        }
        $p = $page === null ? 1 : (int) $page;
        $s = $size === null ? 20 : (int) $size;
        if ($p < 1) {
            $fields['page'] = 'Ожидается положительное целое.';
        }
        if ($s < 1 || $s > 100) {
            $fields['pageSize'] = 'Ожидается целое от 1 до 100.';
        }
        if ($fields !== []) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => $fields]);
        }
        return [$p, $s];
    }

    /** @return array<string,string> */
    private function filterDetails(Request $r): array
    {
        $d = [];
        foreach (['regionCode', 'dateFrom', 'dateTo'] as $k) {
            $v = $r->queryString($k);
            if ($v !== null && $v !== '') {
                $d[$k] = mb_substr($v, 0, 40, 'UTF-8');
            }
        }
        if ($r->queryString('q') !== null && trim((string) $r->queryString('q')) !== '') {
            $d['search'] = 'yes'; // текст поиска (имя, email) в журнал не пишется
        }
        return $d;
    }
}
