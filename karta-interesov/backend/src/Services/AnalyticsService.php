<?php

declare(strict_types=1);

namespace Karta\Services;

use DateTimeImmutable;
use Karta\Core\Clock;
use Karta\Core\HttpException;
use PDO;

/**
 * Административная аналитика. Даты фильтров — UTC.
 * summary(), regions(), attempts() считают только завершённые попытки и персональных данных не содержат.
 * overview(), users(), results(), resultDetail(), exportRows() работают с персональными данными участников
 * и доступны только через маршруты администратора.
 */
final class AnalyticsService
{
    public function __construct(private readonly PDO $pdo, private readonly Catalog $catalog)
    {
    }

    /**
     * @return array{where:string,params:array<int,mixed>}
     */
    private function filters(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to): array
    {
        $where = ['t.status = \'completed\''];
        $params = [];
        if ($regionCode !== null && $regionCode !== '') {
            $regionId = $this->catalog->regionIdByCode($regionCode);
            if ($regionId === null) {
                throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['regionCode' => 'Неизвестный регион.']]);
            }
            $where[] = 't.region_id = ?';
            $params[] = $regionId;
        }
        if ($from !== null) {
            $where[] = 't.completed_at >= ?';
            $params[] = Clock::db($from);
        }
        if ($to !== null) {
            $where[] = 't.completed_at < ?';
            $params[] = Clock::db($to->modify('+1 day')); // dateTo включительно
        }
        return ['where' => implode(' AND ', $where), 'params' => $params];
    }

    /**
     * @param array<int,array{categoryId:int,avgRaw:float,avgDisplay:float,top5:int}> $byCategory
     * @return array<int,array<string,mixed>>
     */
    private function fillCategories(array $byCategory): array
    {
        $out = [];
        foreach ($this->catalog->categoryIds() as $id) {
            $r = $byCategory[$id] ?? null;
            $out[] = [
                'categoryId' => $id,
                'averageRawScore' => $r === null ? 0 : round($r['avgRaw'], 2),
                'averageDisplayScore' => $r === null ? 0 : (int) round($r['avgDisplay']),
                'timesInTop5' => $r === null ? 0 : $r['top5'],
            ];
        }
        return $out;
    }

    /** @return array<string,mixed> */
    public function summary(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to): array
    {
        $f = $this->filters($regionCode, $from, $to);

        $st = $this->pdo->prepare('SELECT COUNT(*) AS total, AVG(t.answered_count) AS avg_answered FROM test_attempts t WHERE ' . $f['where']);
        $st->execute($f['params']);
        $head = $st->fetch();

        $st = $this->pdo->prepare(
            'SELECT r.category_id AS category_id, AVG(r.raw_score) AS avg_raw, AVG(r.display_score) AS avg_display,
                    SUM(CASE WHEN r.rank_position <= 5 THEN 1 ELSE 0 END) AS top5
               FROM attempt_results r JOIN test_attempts t ON t.id = r.attempt_id
              WHERE ' . $f['where'] . '
           GROUP BY r.category_id'
        );
        $st->execute($f['params']);
        $by = [];
        foreach ($st->fetchAll() as $r) {
            $by[(int) $r['category_id']] = [
                'categoryId' => (int) $r['category_id'],
                'avgRaw' => (float) $r['avg_raw'],
                'avgDisplay' => (float) $r['avg_display'],
                'top5' => (int) $r['top5'],
            ];
        }

        return [
            'totalAttempts' => (int) $head['total'],
            'averageAnsweredCount' => $head['avg_answered'] === null ? 0 : round((float) $head['avg_answered'], 1),
            'categories' => $this->fillCategories($by),
        ];
    }

    /** @return array<string,mixed> */
    public function regions(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to): array
    {
        $f = $this->filters($regionCode, $from, $to);

        // Попытки без региона в региональную статистику не входят
        $st = $this->pdo->prepare(
            'SELECT g.code AS code, COUNT(*) AS attempts
               FROM test_attempts t JOIN regions g ON g.id = t.region_id
              WHERE ' . $f['where'] . '
           GROUP BY g.id, g.code, g.sort_order
           ORDER BY g.sort_order'
        );
        $st->execute($f['params']);
        $attempts = [];
        foreach ($st->fetchAll() as $r) {
            $attempts[(string) $r['code']] = (int) $r['attempts'];
        }

        $st = $this->pdo->prepare(
            'SELECT g.code AS code, r.category_id AS category_id, AVG(r.raw_score) AS avg_raw, AVG(r.display_score) AS avg_display,
                    SUM(CASE WHEN r.rank_position <= 5 THEN 1 ELSE 0 END) AS top5
               FROM attempt_results r
               JOIN test_attempts t ON t.id = r.attempt_id
               JOIN regions g ON g.id = t.region_id
              WHERE ' . $f['where'] . '
           GROUP BY g.code, r.category_id'
        );
        $st->execute($f['params']);
        $byRegion = [];
        foreach ($st->fetchAll() as $r) {
            $byRegion[(string) $r['code']][(int) $r['category_id']] = [
                'categoryId' => (int) $r['category_id'],
                'avgRaw' => (float) $r['avg_raw'],
                'avgDisplay' => (float) $r['avg_display'],
                'top5' => (int) $r['top5'],
            ];
        }

        $regions = [];
        foreach ($attempts as $code => $count) {
            $regions[] = [
                'regionCode' => $code,
                'attempts' => $count,
                'categories' => $this->fillCategories($byRegion[$code] ?? []),
            ];
        }
        return ['regions' => $regions];
    }

    /** @return array<string,mixed> */
    public function attempts(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, int $page, int $pageSize): array
    {
        $f = $this->filters($regionCode, $from, $to);

        $st = $this->pdo->prepare('SELECT COUNT(*) FROM test_attempts t WHERE ' . $f['where']);
        $st->execute($f['params']);
        $total = (int) $st->fetchColumn();

        $st = $this->pdo->prepare(
            'SELECT t.id, t.completed_at, t.answered_count, g.code AS region_code
               FROM test_attempts t LEFT JOIN regions g ON g.id = t.region_id
              WHERE ' . $f['where'] . '
           ORDER BY t.completed_at DESC, t.id DESC
              LIMIT ? OFFSET ?'
        );
        $i = 1;
        foreach ($f['params'] as $p) {
            $st->bindValue($i++, $p, is_int($p) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $st->bindValue($i++, $pageSize, PDO::PARAM_INT);
        $st->bindValue($i, ($page - 1) * $pageSize, PDO::PARAM_INT);
        $st->execute();
        $rows = $st->fetchAll();

        $topByAttempt = $this->topCategories(array_map(static fn(array $r): int => (int) $r['id'], $rows));

        $items = [];
        foreach ($rows as $r) {
            $item = [
                'attemptId' => (string) $r['id'],
                'completedAt' => Clock::iso(Clock::fromDb((string) $r['completed_at'])),
                'answeredCount' => (int) $r['answered_count'],
                'topCategoryIds' => $topByAttempt[(int) $r['id']] ?? [],
            ];
            if ($r['region_code'] !== null) {
                $item['regionCode'] = (string) $r['region_code'];
            }
            $items[] = $item;
        }

        return ['page' => $page, 'pageSize' => $pageSize, 'total' => $total, 'items' => $items];
    }

    /**
     * Топ-5 направлений для набора попыток.
     *
     * @param int[] $ids
     * @return array<int,int[]> attemptId => categoryId[] по возрастанию места
     */
    private function topCategories(array $ids): array
    {
        $out = [];
        if ($ids === []) {
            return $out;
        }
        $in = implode(',', array_fill(0, count($ids), '?'));
        $q = $this->pdo->prepare(
            "SELECT attempt_id, category_id FROM attempt_results WHERE rank_position <= 5 AND attempt_id IN ($in) ORDER BY attempt_id, rank_position"
        );
        $q->execute($ids);
        foreach ($q->fetchAll() as $r) {
            $out[(int) $r['attempt_id']][] = (int) $r['category_id'];
        }
        return $out;
    }

    /** @param array<int,mixed> $params */
    private function bindAll(\PDOStatement $st, array $params, int $limit, int $offset): void
    {
        $i = 1;
        foreach ($params as $p) {
            $st->bindValue($i++, $p, is_int($p) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $st->bindValue($i++, $limit, PDO::PARAM_INT);
        $st->bindValue($i, $offset, PDO::PARAM_INT);
    }

    /** Условие поиска по имени и email (алиас таблицы пользователей — u). Спецсимволы LIKE экранируются. */
    private function searchClause(?string $q): ?array
    {
        if ($q === null || $q === '') {
            return null;
        }
        $like = '%' . strtr($q, ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
        return ["(u.display_name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')", [$like, $like]];
    }

    /**
     * Фильтры для списка зарегистрированных участников (алиас u). Период — по дате регистрации.
     *
     * @return array{where:string,params:array<int,mixed>}
     */
    private function userFilters(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, ?string $q = null): array
    {
        $where = ['u.email IS NOT NULL'];
        $params = [];
        if ($regionCode !== null && $regionCode !== '') {
            $where[] = 'u.region_id = ?';
            $params[] = $this->regionIdOrFail($regionCode);
        }
        if ($from !== null) {
            $where[] = 'u.created_at >= ?';
            $params[] = Clock::db($from);
        }
        if ($to !== null) {
            $where[] = 'u.created_at < ?';
            $params[] = Clock::db($to->modify('+1 day'));
        }
        $s = $this->searchClause($q);
        if ($s !== null) {
            $where[] = $s[0];
            array_push($params, ...$s[1]);
        }
        return ['where' => implode(' AND ', $where), 'params' => $params];
    }

    /**
     * Фильтры завершённых попыток вместе с участниками (алиасы t и u): уже готовый filters() + поиск.
     *
     * @return array{where:string,params:array<int,mixed>}
     */
    private function resultFilters(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, ?string $q): array
    {
        $f = $this->filters($regionCode, $from, $to);
        $s = $this->searchClause($q);
        if ($s !== null) {
            $f['where'] .= ' AND ' . $s[0];
            array_push($f['params'], ...$s[1]);
        }
        return $f;
    }

    private function regionIdOrFail(string $code): int
    {
        $id = $this->catalog->regionIdByCode($code);
        if ($id === null) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['regionCode' => 'Неизвестный регион.']]);
        }
        return $id;
    }

    /**
     * Карточки: зарегистрированные, начатые и завершённые попытки, участники по регионам.
     * Регион и период действуют так: пользователи — по региону и дате регистрации; начатые — по дате старта;
     * завершённые — по дате завершения.
     *
     * @return array<string,mixed>
     */
    public function overview(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to): array
    {
        $uf = $this->userFilters($regionCode, $from, $to);
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM users u WHERE ' . $uf['where']);
        $st->execute($uf['params']);
        $totalUsers = (int) $st->fetchColumn();

        $where = ['1 = 1'];
        $params = [];
        if ($regionCode !== null && $regionCode !== '') {
            $where[] = 't.region_id = ?';
            $params[] = $this->regionIdOrFail($regionCode);
        }
        if ($from !== null) {
            $where[] = 't.started_at >= ?';
            $params[] = Clock::db($from);
        }
        if ($to !== null) {
            $where[] = 't.started_at < ?';
            $params[] = Clock::db($to->modify('+1 day'));
        }
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM test_attempts t WHERE ' . implode(' AND ', $where));
        $st->execute($params);
        $started = (int) $st->fetchColumn();

        $cf = $this->filters($regionCode, $from, $to);
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM test_attempts t WHERE ' . $cf['where']);
        $st->execute($cf['params']);
        $completed = (int) $st->fetchColumn();

        $st = $this->pdo->prepare(
            'SELECT g.code AS code, COUNT(*) AS users
               FROM users u JOIN regions g ON g.id = u.region_id
              WHERE ' . $uf['where'] . '
           GROUP BY g.id, g.code, g.sort_order
           ORDER BY g.sort_order'
        );
        $st->execute($uf['params']);
        $byRegion = [];
        foreach ($st->fetchAll() as $r) {
            $byRegion[] = ['regionCode' => (string) $r['code'], 'users' => (int) $r['users']];
        }

        return [
            'totalUsers' => $totalUsers,
            'startedAttempts' => $started,
            'completedAttempts' => $completed,
            'usersByRegion' => $byRegion,
        ];
    }

    /** @return array<string,mixed> */
    public function users(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, ?string $q, int $page, int $pageSize): array
    {
        $f = $this->userFilters($regionCode, $from, $to, $q);

        $st = $this->pdo->prepare('SELECT COUNT(*) FROM users u WHERE ' . $f['where']);
        $st->execute($f['params']);
        $total = (int) $st->fetchColumn();

        $st = $this->pdo->prepare(
            'SELECT u.id, u.display_name, u.email, u.age, u.created_at, g.code AS region_code,
                    (SELECT COUNT(*) FROM test_attempts a WHERE a.user_id = u.id) AS started_count,
                    (SELECT COUNT(*) FROM test_attempts a WHERE a.user_id = u.id AND a.status = \'completed\') AS completed_count,
                    (SELECT a.id FROM test_attempts a WHERE a.user_id = u.id AND a.status = \'completed\'
                      ORDER BY a.completed_at DESC, a.id DESC LIMIT 1) AS last_attempt_id
               FROM users u LEFT JOIN regions g ON g.id = u.region_id
              WHERE ' . $f['where'] . '
           ORDER BY u.created_at DESC, u.id DESC
              LIMIT ? OFFSET ?'
        );
        $this->bindAll($st, $f['params'], $pageSize, ($page - 1) * $pageSize);
        $st->execute();

        $items = [];
        foreach ($st->fetchAll() as $r) {
            $items[] = [
                'userId' => (string) $r['id'],
                'name' => $r['display_name'],
                'email' => $r['email'],
                'age' => $r['age'] === null ? null : (int) $r['age'],
                'regionCode' => $r['region_code'],
                'registeredAt' => Clock::iso(Clock::fromDb((string) $r['created_at'])),
                'startedAttempts' => (int) $r['started_count'],
                'completedAttempts' => (int) $r['completed_count'],
                'lastCompletedAttemptId' => $r['last_attempt_id'] === null ? null : (string) $r['last_attempt_id'],
            ];
        }
        return ['page' => $page, 'pageSize' => $pageSize, 'total' => $total, 'items' => $items];
    }

    /** Завершённые тесты с данными участника. @return array<string,mixed> */
    public function results(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, ?string $q, int $page, int $pageSize): array
    {
        $f = $this->resultFilters($regionCode, $from, $to, $q);
        $from_ = ' FROM test_attempts t JOIN users u ON u.id = t.user_id LEFT JOIN regions g ON g.id = t.region_id WHERE ';

        $st = $this->pdo->prepare('SELECT COUNT(*)' . $from_ . $f['where']);
        $st->execute($f['params']);
        $total = (int) $st->fetchColumn();

        $st = $this->pdo->prepare(
            'SELECT t.id, t.completed_at, t.answered_count, u.display_name, u.email, u.age, g.code AS region_code'
            . $from_ . $f['where'] . ' ORDER BY t.completed_at DESC, t.id DESC LIMIT ? OFFSET ?'
        );
        $this->bindAll($st, $f['params'], $pageSize, ($page - 1) * $pageSize);
        $st->execute();
        $rows = $st->fetchAll();

        $top = $this->topCategories(array_map(static fn(array $r): int => (int) $r['id'], $rows));
        $items = [];
        foreach ($rows as $r) {
            $items[] = [
                'attemptId' => (string) $r['id'],
                'completedAt' => Clock::iso(Clock::fromDb((string) $r['completed_at'])),
                'answeredCount' => (int) $r['answered_count'],
                'name' => $r['display_name'],
                'email' => $r['email'],
                'age' => $r['age'] === null ? null : (int) $r['age'],
                'regionCode' => $r['region_code'],
                'topCategoryIds' => $top[(int) $r['id']] ?? [],
            ];
        }
        return ['page' => $page, 'pageSize' => $pageSize, 'total' => $total, 'items' => $items];
    }

    /** Результат конкретного завершённого теста с данными участника. @return array<string,mixed> */
    public function resultDetail(int $attemptId): array
    {
        $st = $this->pdo->prepare(
            'SELECT t.id, t.completed_at, t.started_at, t.answered_count, t.test_version, u.display_name, u.email, u.age, g.code AS region_code
               FROM test_attempts t JOIN users u ON u.id = t.user_id LEFT JOIN regions g ON g.id = t.region_id
              WHERE t.id = ? AND t.status = \'completed\''
        );
        $st->execute([$attemptId]);
        $a = $st->fetch();
        if ($a === false) {
            throw new HttpException(404, 'NOT_FOUND', 'Результат не найден.');
        }
        $st = $this->pdo->prepare(
            'SELECT category_id, raw_score, display_score, rank_position FROM attempt_results WHERE attempt_id = ? ORDER BY rank_position'
        );
        $st->execute([$attemptId]);
        $scores = [];
        foreach ($st->fetchAll() as $r) {
            $scores[] = [
                'categoryId' => (int) $r['category_id'],
                'rawScore' => (int) $r['raw_score'],
                'displayScore' => (int) $r['display_score'],
                'rank' => (int) $r['rank_position'],
            ];
        }
        return [
            'attemptId' => (string) $a['id'],
            'testVersion' => $a['test_version'],
            'startedAt' => Clock::iso(Clock::fromDb((string) $a['started_at'])),
            'completedAt' => Clock::iso(Clock::fromDb((string) $a['completed_at'])),
            'answeredCount' => (int) $a['answered_count'],
            'name' => $a['display_name'],
            'email' => $a['email'],
            'age' => $a['age'] === null ? null : (int) $a['age'],
            'regionCode' => $a['region_code'],
            'scores' => $scores, // по возрастанию места: первый элемент — самое высокое направление
        ];
    }

    public const EXPORT_LIMIT = 20000;

    /**
     * Данные для CSV: все завершённые тесты по фильтрам, без постраничной выдачи.
     * Секретных полей (пароли, токены) в выборке нет вообще.
     *
     * @return array{rows:array<int,array<string,mixed>>,categories:array<int,array{id:int,name:string}>}
     */
    public function exportRows(?string $regionCode, ?DateTimeImmutable $from, ?DateTimeImmutable $to, ?string $q): array
    {
        $f = $this->resultFilters($regionCode, $from, $to, $q);
        $from_ = ' FROM test_attempts t JOIN users u ON u.id = t.user_id LEFT JOIN regions g ON g.id = t.region_id WHERE ';

        $st = $this->pdo->prepare('SELECT COUNT(*)' . $from_ . $f['where']);
        $st->execute($f['params']);
        if ((int) $st->fetchColumn() > self::EXPORT_LIMIT) {
            throw new HttpException(422, 'EXPORT_TOO_LARGE', 'Слишком много строк для экспорта (максимум ' . self::EXPORT_LIMIT . '). Сузьте фильтры.');
        }

        $st = $this->pdo->prepare(
            'SELECT t.id, t.completed_at, t.answered_count, u.display_name, u.email, u.age, g.name AS region_name'
            . $from_ . $f['where'] . ' ORDER BY t.completed_at DESC, t.id DESC'
        );
        $st->execute($f['params']);
        $rows = [];
        foreach ($st->fetchAll() as $r) {
            $rows[(int) $r['id']] = [
                'attemptId' => (int) $r['id'],
                'completedAt' => Clock::iso(Clock::fromDb((string) $r['completed_at'])),
                'name' => (string) $r['display_name'],
                'email' => (string) $r['email'],
                'age' => $r['age'],
                'region' => (string) $r['region_name'],
                'answeredCount' => (int) $r['answered_count'],
                'display' => [],
                'ranks' => [],
            ];
        }

        if ($rows !== []) {
            $st = $this->pdo->prepare(
                'SELECT r.attempt_id, r.category_id, r.display_score, r.rank_position
                   FROM attempt_results r JOIN test_attempts t ON t.id = r.attempt_id JOIN users u ON u.id = t.user_id
                  WHERE ' . $f['where']
            );
            $st->execute($f['params']);
            foreach ($st->fetchAll() as $r) {
                $id = (int) $r['attempt_id'];
                if (!isset($rows[$id])) {
                    continue;
                }
                $rows[$id]['display'][(int) $r['category_id']] = (int) $r['display_score'];
                $rows[$id]['ranks'][(int) $r['rank_position']] = (int) $r['category_id'];
            }
        }

        $cats = [];
        foreach ($this->catalog->categories() as $c) {
            $cats[] = ['id' => (int) $c['id'], 'name' => (string) $c['name']];
        }
        return ['rows' => array_values($rows), 'categories' => $cats];
    }

    /** @return array<string,mixed> */
    public function auditLogs(int $page, int $pageSize): array
    {
        $total = (int) $this->pdo->query('SELECT COUNT(*) FROM admin_audit_logs')->fetchColumn();
        $st = $this->pdo->prepare(
            'SELECT l.id, l.action, l.entity_type, l.entity_id, l.details, l.ip_address, l.created_at, a.username AS admin_username, l.username_attempted
               FROM admin_audit_logs l LEFT JOIN admin_users a ON a.id = l.admin_user_id
           ORDER BY l.id DESC LIMIT ? OFFSET ?'
        );
        $st->bindValue(1, $pageSize, PDO::PARAM_INT);
        $st->bindValue(2, ($page - 1) * $pageSize, PDO::PARAM_INT);
        $st->execute();
        $items = [];
        foreach ($st->fetchAll() as $r) {
            $items[] = [
                'id' => (string) $r['id'],
                'action' => $r['action'],
                'admin' => $r['admin_username'],
                'usernameAttempted' => $r['username_attempted'],
                'entityType' => $r['entity_type'],
                'entityId' => $r['entity_id'],
                'details' => $r['details'] === null ? null : json_decode((string) $r['details'], true),
                'ip' => $r['ip_address'],
                'createdAt' => Clock::iso(Clock::fromDb((string) $r['created_at'])),
            ];
        }
        return ['page' => $page, 'pageSize' => $pageSize, 'total' => $total, 'items' => $items];
    }
}
