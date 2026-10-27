<?php

declare(strict_types=1);

namespace Karta\Services;

use DateTimeImmutable;
use Karta\Core\Clock;
use Karta\Core\Config;
use Karta\Core\HttpException;
use PDO;
use PDOException;

/**
 * Прохождение теста с серверным таймером.
 *
 * Модель повторяет клиентский движок (src/lib/testSession.ts):
 *  - круг 1 — вопросы 1..N по порядку, следующие круги — только пропущенные;
 *  - у каждого открытого вопроса есть серверное время открытия (test_attempts.question_opened_at);
 *  - ответ принимается, только если пришёл не позже QUESTION_TIME_MS + ANSWER_GRACE_MS после открытия;
 *  - пропуск — это строка answers со status='skipped' и value=NULL (не 0);
 *  - ответ на вопрос фиксируется один раз: тот же ответ повторно = идемпотентный успех, другое значение = 409.
 *
 * Любое изменение попытки выполняется в транзакции под блокировкой строки попытки (SELECT ... FOR UPDATE),
 * поэтому параллельные запросы одной попытки выстраиваются в очередь и не создают дублей.
 */
final class AttemptService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly Config $config,
        private readonly Clock $clock,
        private readonly Catalog $catalog,
    ) {
    }

    // ───────────────────────── Создание ─────────────────────────

    /**
     * @param array{id:int,region_id:?int} $user
     * @return array{created:bool,state:array<string,mixed>}
     */
    public function create(array $user, string $clientAttemptId, ?string $testVersion, ?string $regionCode): array
    {
        if ($testVersion !== null && $testVersion !== $this->config->testVersion) {
            throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', [
                'fields' => ['testVersion' => 'Неподдерживаемая версия теста. Ожидается ' . $this->config->testVersion . '.'],
            ]);
        }
        $regionId = $user['region_id'];
        if ($regionCode !== null) {
            $regionId = $this->catalog->regionIdByCode($regionCode);
            if ($regionId === null) {
                throw new HttpException(422, 'VALIDATION_ERROR', 'Данные запроса не прошли проверку.', ['fields' => ['regionCode' => 'Неизвестный регион.']]);
            }
        }

        $existingId = $this->findAttemptId($user['id'], $clientAttemptId);
        if ($existingId !== null) {
            return ['created' => false, 'state' => $this->state($user['id'], $existingId)];
        }

        $now = $this->clock->now();
        try {
            $this->pdo->beginTransaction();
            $st = $this->pdo->prepare(
                'INSERT INTO test_attempts (user_id, client_attempt_id, test_version, region_id, status, current_round, started_at)
                 VALUES (?, ?, ?, ?, \'in_progress\', 1, ?)'
            );
            $st->execute([$user['id'], $clientAttemptId, $this->config->testVersion, $regionId, Clock::db($now)]);
            $attemptId = (int) $this->pdo->lastInsertId();
            // Первый вопрос открывается сразу: с этого момента идут его 15 секунд (серверное время)
            $this->openNext($attemptId, 1, $now);
            $this->pdo->commit();
        } catch (PDOException $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            if (($e->errorInfo[1] ?? null) === 1062) {
                // Параллельный повтор того же clientAttemptId — возвращаем уже созданную попытку
                $existingId = $this->findAttemptId($user['id'], $clientAttemptId);
                if ($existingId !== null) {
                    return ['created' => false, 'state' => $this->state($user['id'], $existingId)];
                }
            }
            throw $e;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return ['created' => true, 'state' => $this->state($user['id'], $attemptId)];
    }

    // ───────────────────────── Состояние ─────────────────────────

    /**
     * Состояние попытки. Если время текущего вопроса давно вышло (клиент закрыл страницу), вопрос
     * помечается пропущенным, и следующий открывается с текущего серверного времени — ровно один
     * вопрос за обращение, как reconcileOnLoad во frontend. Повторные обновления страницы время не продлевают.
     *
     * @return array<string,mixed>
     */
    public function state(int $userId, int $attemptId): array
    {
        return $this->locked($userId, $attemptId, function (array $a): array {
            $now = $this->clock->now();
            $a = $this->reconcile($a, $now);
            return $this->buildState($a, $now);
        });
    }

    /**
     * Последняя незавершённая попытка пользователя.
     *
     * @return array<string,mixed>
     */
    public function activeState(int $userId): array
    {
        $st = $this->pdo->prepare(
            'SELECT id FROM test_attempts WHERE user_id = ? AND status = \'in_progress\' ORDER BY id DESC LIMIT 1'
        );
        $st->execute([$userId]);
        $id = $st->fetchColumn();
        if ($id === false) {
            throw new HttpException(404, 'NO_ACTIVE_ATTEMPT', 'Незавершённой попытки нет.');
        }
        return $this->state($userId, (int) $id);
    }

    // ───────────────────────── Ответ ─────────────────────────

    /**
     * @return array{outcome:string,state:array<string,mixed>} outcome: accepted | duplicate | expired
     */
    public function answer(int $userId, int $attemptId, int $questionId, int $value): array
    {
        return $this->locked($userId, $attemptId, function (array $a) use ($questionId, $value): array {
            $now = $this->clock->now();
            $this->assertInProgress($a);

            $existing = $this->findAnswer((int) $a['id'], $questionId);
            if ($existing !== null && $existing['status'] === 'answered') {
                if ((int) $existing['value'] === $value) {
                    return ['outcome' => 'duplicate', 'state' => $this->buildState($a, $now)];
                }
                throw new HttpException(409, 'ANSWER_ALREADY_FIXED', 'Ответ на этот вопрос уже зафиксирован и не может быть изменён.');
            }

            $this->assertCurrentQuestion($a, $questionId, $now);

            $opened = Clock::fromDb((string) $a['question_opened_at']);
            $elapsed = Clock::ms($now) - Clock::ms($opened);
            if ($elapsed > $this->config->questionTimeMs + $this->config->answerGraceMs) {
                // Время вышло: ответ «задним числом» не принимается, вопрос становится пропущенным
                $a = $this->resolveSkipped($a, $now);
                return ['outcome' => 'expired', 'state' => $this->buildState($a, $now)];
            }

            $this->saveAnswered($a, $questionId, $value, $opened, $now);
            $a = $this->advance($a, $now);
            return ['outcome' => 'accepted', 'state' => $this->buildState($a, $now)];
        });
    }

    // ───────────────────────── Пропуск ─────────────────────────

    /**
     * Пропуск разрешён только когда время вопроса вышло (с небольшим допуском на расхождение часов
     * и сетевую задержку). Повтор того же пропуска — идемпотентный успех.
     *
     * @return array{outcome:string,state:array<string,mixed>} outcome: skipped | duplicate
     */
    public function skip(int $userId, int $attemptId, int $questionId): array
    {
        return $this->locked($userId, $attemptId, function (array $a) use ($questionId): array {
            $now = $this->clock->now();
            $this->assertInProgress($a);

            $existing = $this->findAnswer((int) $a['id'], $questionId);
            if ($existing !== null && $existing['status'] === 'answered') {
                throw new HttpException(409, 'ANSWER_ALREADY_FIXED', 'На этот вопрос уже есть ответ — пропустить его нельзя.');
            }
            if ($existing !== null && (int) $existing['last_round'] === (int) $a['current_round']
                && (int) $a['current_question_id'] !== $questionId) {
                return ['outcome' => 'duplicate', 'state' => $this->buildState($a, $now)];
            }

            $this->assertCurrentQuestion($a, $questionId, $now);

            $opened = Clock::fromDb((string) $a['question_opened_at']);
            $elapsed = Clock::ms($now) - Clock::ms($opened);
            $minElapsed = $this->config->questionTimeMs - $this->config->skipToleranceMs;
            if ($elapsed < $minElapsed) {
                throw new HttpException(409, 'TOO_EARLY', 'Время на вопрос ещё не истекло.', [
                    'remainingMs' => max(0, $this->config->questionTimeMs - $elapsed),
                ]);
            }

            $a = $this->resolveSkipped($a, $now);
            return ['outcome' => 'skipped', 'state' => $this->buildState($a, $now)];
        });
    }

    // ───────────────────────── Повторный круг ─────────────────────────

    /**
     * Начать новый круг по пропущенным вопросам. $fromRound (необязательно) делает вызов идемпотентным:
     * если попытка уже перешла в круг fromRound+1, возвращается текущее состояние.
     *
     * @return array<string,mixed>
     */
    public function startRetryRound(int $userId, int $attemptId, ?int $fromRound): array
    {
        return $this->locked($userId, $attemptId, function (array $a) use ($fromRound): array {
            $now = $this->clock->now();
            $this->assertInProgress($a);
            $round = (int) $a['current_round'];

            if ($fromRound !== null && $round === $fromRound + 1) {
                return $this->buildState($a, $now);
            }
            if ($fromRound !== null && $fromRound !== $round) {
                throw new HttpException(409, 'ROUND_MISMATCH', 'Номер круга не совпадает с состоянием попытки.');
            }
            if ($a['current_question_id'] !== null) {
                throw new HttpException(409, 'ROUND_NOT_FINISHED', 'Текущий круг ещё не закончен.');
            }
            $skipped = $this->countByStatus((int) $a['id'], 'skipped');
            if ($skipped === 0) {
                throw new HttpException(409, 'NO_SKIPPED_QUESTIONS', 'Пропущенных вопросов нет.');
            }

            $st = $this->pdo->prepare('UPDATE test_attempts SET current_round = current_round + 1 WHERE id = ?');
            $st->execute([(int) $a['id']]);
            $this->openNext((int) $a['id'], $round + 1, $now);
            return $this->buildState($this->loadAttempt((int) $a['id']), $now);
        });
    }

    // ───────────────────────── Завершение ─────────────────────────

    /**
     * Завершить тест и сохранить результат. Требуются ответы на ВСЕ вопросы (как условие показа результата
     * во frontend). Баллы считает сервер по сохранённым ответам. Повторный вызов возвращает тот же результат.
     *
     * @return array<string,mixed>
     */
    public function finish(int $userId, int $attemptId): array
    {
        return $this->locked($userId, $attemptId, function (array $a): array {
            if ($a['status'] === 'completed') {
                return $this->resultPayload($a);
            }
            $now = $this->clock->now();
            $a = $this->reconcile($a, $now);

            $total = $this->catalog->questionCount();
            $answered = $this->countByStatus((int) $a['id'], 'answered');
            if ($answered < $total) {
                throw new HttpException(409, 'ATTEMPT_INCOMPLETE', 'Результат доступен только после ответов на все вопросы.', [
                    'answeredCount' => $answered,
                    'totalQuestions' => $total,
                    'missingQuestionIds' => $this->missingQuestionIds((int) $a['id']),
                ]);
            }

            $rawByCategory = [];
            $st = $this->pdo->prepare(
                'SELECT q.category_id AS category_id, SUM(a.value) AS raw_sum
                   FROM answers a JOIN questions q ON q.id = a.question_id
                  WHERE a.attempt_id = ? AND a.status = \'answered\'
               GROUP BY q.category_id'
            );
            $st->execute([(int) $a['id']]);
            foreach ($st->fetchAll() as $row) {
                $rawByCategory[(int) $row['category_id']] = (int) $row['raw_sum'];
            }
            $scores = Scoring::build($this->catalog->categoryIds(), $rawByCategory);

            $ins = $this->pdo->prepare(
                'INSERT INTO attempt_results (attempt_id, category_id, raw_score, display_score, rank_position) VALUES (?, ?, ?, ?, ?)'
            );
            foreach ($scores as $s) {
                $ins->execute([(int) $a['id'], $s['categoryId'], $s['rawScore'], $s['displayScore'], $s['rank']]);
            }
            $upd = $this->pdo->prepare(
                'UPDATE test_attempts
                    SET status = \'completed\', completed_at = ?, calculated_at = ?, answered_count = ?,
                        current_question_id = NULL, question_opened_at = NULL
                  WHERE id = ?'
            );
            $upd->execute([Clock::db($now), Clock::db($now), $answered, (int) $a['id']]);

            return $this->resultPayload($this->loadAttempt((int) $a['id']));
        });
    }

    /** @return array<string,mixed> */
    public function result(int $userId, int $attemptId): array
    {
        return $this->locked($userId, $attemptId, function (array $a): array {
            if ($a['status'] !== 'completed') {
                throw new HttpException(409, 'ATTEMPT_NOT_COMPLETED', 'Тест ещё не завершён — результата нет.');
            }
            return $this->resultPayload($a);
        });
    }

    // ───────────────────────── Внутренняя кухня ─────────────────────────

    /**
     * Выполнить $fn в транзакции под блокировкой попытки. Чужая или несуществующая попытка — одинаково 404
     * (чтобы по ответу нельзя было узнать, существует ли чужая попытка).
     *
     * @template T
     * @param callable(array<string,mixed>):T $fn
     * @return T
     */
    private function locked(int $userId, int $attemptId, callable $fn): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $a = $this->loadAttempt($attemptId, true);
            if ($a === null || (int) $a['user_id'] !== $userId) {
                throw new HttpException(404, 'ATTEMPT_NOT_FOUND', 'Попытка не найдена.');
            }
            $result = $fn($a);
            $this->pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    /** @return array<string,mixed>|null */
    private function loadAttempt(int $attemptId, bool $forUpdate = false): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM test_attempts WHERE id = ?' . ($forUpdate ? ' FOR UPDATE' : ''));
        $st->execute([$attemptId]);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    private function findAttemptId(int $userId, string $clientAttemptId): ?int
    {
        $st = $this->pdo->prepare('SELECT id FROM test_attempts WHERE user_id = ? AND client_attempt_id = ?');
        $st->execute([$userId, $clientAttemptId]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** @return array<string,mixed>|null */
    private function findAnswer(int $attemptId, int $questionId): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM answers WHERE attempt_id = ? AND question_id = ?');
        $st->execute([$attemptId, $questionId]);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string,mixed> $a */
    private function assertInProgress(array $a): void
    {
        if ($a['status'] !== 'in_progress') {
            throw new HttpException(409, 'ATTEMPT_COMPLETED', 'Тест уже завершён.');
        }
    }

    /** @param array<string,mixed> $a */
    private function assertCurrentQuestion(array $a, int $questionId, DateTimeImmutable $now): void
    {
        if ($a['current_question_id'] === null || (int) $a['current_question_id'] !== $questionId) {
            throw new HttpException(409, 'NOT_CURRENT_QUESTION', 'Этот вопрос сейчас не открыт.', [
                'currentQuestionId' => $a['current_question_id'] === null ? null : (int) $a['current_question_id'],
            ]);
        }
    }

    /**
     * Если время текущего вопроса вышло (с запасом на сеть) — пропустить его и открыть следующий.
     *
     * @param array<string,mixed> $a
     * @return array<string,mixed>
     */
    private function reconcile(array $a, DateTimeImmutable $now): array
    {
        if ($a['status'] !== 'in_progress' || $a['current_question_id'] === null) {
            return $a;
        }
        $opened = Clock::fromDb((string) $a['question_opened_at']);
        $elapsed = Clock::ms($now) - Clock::ms($opened);
        if ($elapsed >= $this->config->questionTimeMs + $this->config->answerGraceMs) {
            return $this->resolveSkipped($a, $now);
        }
        return $a;
    }

    /**
     * Пометить текущий вопрос пропущенным и перейти к следующему.
     *
     * @param array<string,mixed> $a
     * @return array<string,mixed>
     */
    private function resolveSkipped(array $a, DateTimeImmutable $now): array
    {
        $attemptId = (int) $a['id'];
        $questionId = (int) $a['current_question_id'];
        $round = (int) $a['current_round'];
        $opened = Clock::db(Clock::fromDb((string) $a['question_opened_at']));

        $existing = $this->findAnswer($attemptId, $questionId);
        if ($existing === null) {
            $st = $this->pdo->prepare(
                'INSERT INTO answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
                 VALUES (?, ?, \'skipped\', NULL, ?, 1, ?, ?)'
            );
            $st->execute([$attemptId, $questionId, $round, $opened, Clock::db($now)]);
        } elseif ($existing['status'] === 'skipped') {
            $st = $this->pdo->prepare(
                'UPDATE answers SET last_round = ?, skip_count = skip_count + 1, shown_at = ?, resolved_at = ?
                  WHERE attempt_id = ? AND question_id = ? AND status = \'skipped\''
            );
            $st->execute([$round, $opened, Clock::db($now), $attemptId, $questionId]);
        }
        // status = answered здесь невозможен: отвеченный вопрос не бывает текущим. Ответ не трогаем.

        return $this->advance($a, $now);
    }

    /**
     * Записать ответ. Пропущенный ранее вопрос в повторном круге переходит skipped -> answered;
     * уже отвеченный вопрос никогда не перезаписывается (условие status = 'skipped' в UPDATE).
     *
     * @param array<string,mixed> $a
     */
    private function saveAnswered(array $a, int $questionId, int $value, DateTimeImmutable $opened, DateTimeImmutable $now): void
    {
        $attemptId = (int) $a['id'];
        $round = (int) $a['current_round'];
        $existing = $this->findAnswer($attemptId, $questionId);
        if ($existing === null) {
            $st = $this->pdo->prepare(
                'INSERT INTO answers (attempt_id, question_id, status, value, last_round, skip_count, shown_at, resolved_at)
                 VALUES (?, ?, \'answered\', ?, ?, 0, ?, ?)'
            );
            $st->execute([$attemptId, $questionId, $value, $round, Clock::db($opened), Clock::db($now)]);
            return;
        }
        $st = $this->pdo->prepare(
            'UPDATE answers SET status = \'answered\', value = ?, last_round = ?, shown_at = ?, resolved_at = ?
              WHERE attempt_id = ? AND question_id = ? AND status = \'skipped\''
        );
        $st->execute([$value, $round, Clock::db($opened), Clock::db($now), $attemptId, $questionId]);
    }

    /**
     * Открыть следующий вопрос текущего круга и вернуть обновлённую попытку.
     *
     * @param array<string,mixed> $a
     * @return array<string,mixed>
     */
    private function advance(array $a, DateTimeImmutable $now): array
    {
        $this->openNext((int) $a['id'], (int) $a['current_round'], $now);
        return $this->loadAttempt((int) $a['id']) ?? $a;
    }

    /**
     * Следующий вопрос круга:
     *  - круг 1: первый вопрос, для которого ещё нет строки в answers (то есть по порядку id);
     *  - круг N>1: первый из пропущенных вопросов, который в этом круге ещё не получал решения.
     * Нет такого вопроса — круг закончен (current_question_id = NULL).
     */
    private function openNext(int $attemptId, int $round, DateTimeImmutable $now): void
    {
        if ($round === 1) {
            $st = $this->pdo->prepare(
                'SELECT q.id FROM questions q
                  WHERE NOT EXISTS (SELECT 1 FROM answers a WHERE a.attempt_id = ? AND a.question_id = q.id)
               ORDER BY q.id LIMIT 1'
            );
            $st->execute([$attemptId]);
        } else {
            $st = $this->pdo->prepare(
                'SELECT question_id FROM answers
                  WHERE attempt_id = ? AND status = \'skipped\' AND last_round < ?
               ORDER BY question_id LIMIT 1'
            );
            $st->execute([$attemptId, $round]);
        }
        $next = $st->fetchColumn();

        $upd = $this->pdo->prepare('UPDATE test_attempts SET current_question_id = ?, question_opened_at = ? WHERE id = ?');
        if ($next === false) {
            $upd->execute([null, null, $attemptId]);
        } else {
            $upd->execute([(int) $next, Clock::db($now), $attemptId]);
        }
    }

    /**
     * Позиция в текущем круге (для подписи «N из M» в повторном круге).
     * Круг 1 — все вопросы теста. Круг N>1 — вопросы, пропущенные к его началу: уже получившие решение в этом круге
     * (last_round = N) плюс ещё ожидающие (skipped и last_round < N).
     *
     * @return array{position:int,size:int}
     */
    private function roundProgress(int $attemptId, int $round, int $total, bool $hasCurrent): array
    {
        $st = $this->pdo->prepare(
            'SELECT COALESCE(SUM(last_round = ?), 0) AS done,
                    COALESCE(SUM(status = \'skipped\' AND last_round < ?), 0) AS pending
               FROM answers WHERE attempt_id = ?'
        );
        $st->execute([$round, $round, $attemptId]);
        $row = $st->fetch();
        $done = (int) ($row['done'] ?? 0);
        $pending = (int) ($row['pending'] ?? 0);
        $size = $round === 1 ? $total : $done + $pending;
        $position = $hasCurrent ? $done + 1 : $size;
        return ['position' => max(1, min($position, max(1, $size))), 'size' => max(1, $size)];
    }

    private function countByStatus(int $attemptId, string $status): int
    {
        $st = $this->pdo->prepare('SELECT COUNT(*) FROM answers WHERE attempt_id = ? AND status = ?');
        $st->execute([$attemptId, $status]);
        return (int) $st->fetchColumn();
    }

    /** @return int[] */
    private function missingQuestionIds(int $attemptId): array
    {
        $st = $this->pdo->prepare(
            'SELECT q.id FROM questions q
              WHERE NOT EXISTS (SELECT 1 FROM answers a WHERE a.attempt_id = ? AND a.question_id = q.id AND a.status = \'answered\')
           ORDER BY q.id'
        );
        $st->execute([$attemptId]);
        return array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));
    }

    /**
     * @param array<string,mixed> $a
     * @return array<string,mixed>
     */
    private function buildState(array $a, DateTimeImmutable $now): array
    {
        $attemptId = (int) $a['id'];
        $limit = $this->config->questionTimeMs;

        $st = $this->pdo->prepare('SELECT question_id, value FROM answers WHERE attempt_id = ? AND status = \'answered\' ORDER BY question_id');
        $st->execute([$attemptId]);
        $answers = array_map(static fn(array $r): array => ['questionId' => (int) $r['question_id'], 'value' => (int) $r['value']], $st->fetchAll());

        $st = $this->pdo->prepare('SELECT question_id FROM answers WHERE attempt_id = ? AND status = \'skipped\' ORDER BY question_id');
        $st->execute([$attemptId]);
        $skipped = array_map('intval', $st->fetchAll(PDO::FETCH_COLUMN));

        $current = null;
        if ($a['current_question_id'] !== null && $a['question_opened_at'] !== null) {
            $opened = Clock::fromDb((string) $a['question_opened_at']);
            $deadline = Clock::fromMs(Clock::ms($opened) + $limit);
            $remaining = Clock::ms($deadline) - Clock::ms($now);
            $current = [
                'questionId' => (int) $a['current_question_id'],
                'openedAt' => Clock::iso($opened),
                'deadlineAt' => Clock::iso($deadline),
                'timeLimitMs' => $limit,
                'remainingMs' => max(0, min($limit, $remaining)),
            ];
        }

        $total = $this->catalog->questionCount();
        $inProgress = $a['status'] === 'in_progress';

        return [
            'attemptId' => (string) $attemptId,
            'clientAttemptId' => $a['client_attempt_id'],
            'testVersion' => $a['test_version'],
            'status' => $a['status'],
            'round' => (int) $a['current_round'],
            'totalQuestions' => $total,
            'answeredCount' => count($answers),
            'skippedCount' => count($skipped),
            'roundFinished' => $inProgress && $current === null,
            'canFinish' => $inProgress && count($answers) === $total,
            'currentQuestion' => $current,
            'answers' => $answers,
            'skippedQuestionIds' => $skipped,
            'roundProgress' => $inProgress ? $this->roundProgress($attemptId, (int) $a['current_round'], $total, $current !== null) : null,
            'startedAt' => Clock::iso(Clock::fromDb((string) $a['started_at'])),
            'completedAt' => $a['completed_at'] === null ? null : Clock::iso(Clock::fromDb((string) $a['completed_at'])),
            // Время сервера — только для отображения. Решения о допустимости ответа принимает сервер.
            'serverTime' => Clock::iso($now),
        ];
    }

    /**
     * @param array<string,mixed> $a
     * @return array<string,mixed>
     */
    private function resultPayload(array $a): array
    {
        $st = $this->pdo->prepare(
            'SELECT category_id, raw_score, display_score, rank_position
               FROM attempt_results WHERE attempt_id = ? ORDER BY category_id'
        );
        $st->execute([(int) $a['id']]);
        $scores = [];
        $top = [];
        foreach ($st->fetchAll() as $r) {
            $scores[] = [
                'categoryId' => (int) $r['category_id'],
                'rawScore' => (int) $r['raw_score'],
                'displayScore' => (int) $r['display_score'],
                'rank' => (int) $r['rank_position'],
            ];
            if ((int) $r['rank_position'] <= 5) {
                $top[(int) $r['rank_position']] = (int) $r['category_id'];
            }
        }
        ksort($top);

        return [
            'attemptId' => (string) $a['id'],
            'testVersion' => $a['test_version'],
            'answeredCount' => (int) $a['answered_count'],
            'persisted' => true,
            'calculatedAt' => Clock::iso(Clock::fromDb((string) $a['calculated_at'])),
            'topCategoryIds' => array_values($top),
            'scores' => $scores,
        ];
    }
}
