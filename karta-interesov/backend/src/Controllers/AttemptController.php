<?php

declare(strict_types=1);

namespace Karta\Controllers;

use Karta\Core\HttpException;
use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Core\Validator;
use Karta\Services\AttemptService;

final class AttemptController
{
    public function __construct(private readonly AttemptService $attempts)
    {
    }

    /** POST /attempts — создать попытку (идемпотентно по clientAttemptId). Первый вопрос открывается сразу. */
    public function create(Request $r, array $params, array $ctx): Response
    {
        $body = $r->json();
        if (array_key_exists('answers', $body)) {
            throw new HttpException(
                422,
                'BATCH_SUBMIT_NOT_SUPPORTED',
                'Пакетная отправка ответов не поддерживается: ответы отправляются по одному (POST /attempts/{id}/answers), чтобы сервер контролировал таймер.',
            );
        }
        $v = new Validator($body);
        $v->onlyKeys(['clientAttemptId', 'testVersion', 'regionCode']);
        $cid = $v->string('clientAttemptId', true, 8, 64, '/^[A-Za-z0-9_-]+$/');
        $version = $v->string('testVersion', false, 1, 64);
        $region = $v->string('regionCode', false, 1, 40, '/^[a-z0-9-]+$/');
        $v->assertValid();

        $res = $this->attempts->create($ctx['user'], (string) $cid, $version, $region);
        return Response::json($res['created'] ? 201 : 200, $res['state']);
    }

    /** GET /attempts/active — последняя незавершённая попытка пользователя. */
    public function active(Request $r, array $params, array $ctx): Response
    {
        return Response::json(200, $this->attempts->activeState($ctx['user']['id']));
    }

    /** GET /attempts/{id} — состояние попытки. */
    public function show(Request $r, array $params, array $ctx): Response
    {
        return Response::json(200, $this->attempts->state($ctx['user']['id'], (int) $params['id']));
    }

    /** POST /attempts/{id}/answers — сохранить ответ на текущий вопрос. */
    public function answer(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['questionId', 'value']);
        $qid = $v->int('questionId', true, 1, 65535);
        $value = $v->int('value', true, -2, 2);
        $v->assertValid();

        $res = $this->attempts->answer($ctx['user']['id'], (int) $params['id'], (int) $qid, (int) $value);
        if ($res['outcome'] === 'expired') {
            throw new HttpException(409, 'TIME_EXPIRED', 'Время на вопрос вышло: ответ не принят, вопрос отмечен как пропущенный.', [
                'state' => $res['state'],
            ]);
        }
        $res['state']['duplicate'] = $res['outcome'] === 'duplicate';
        return Response::json(200, $res['state']);
    }

    /** POST /attempts/{id}/skips — отметить вопрос пропущенным (время вышло). */
    public function skip(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['questionId']);
        $qid = $v->int('questionId', true, 1, 65535);
        $v->assertValid();

        $res = $this->attempts->skip($ctx['user']['id'], (int) $params['id'], (int) $qid);
        $res['state']['duplicate'] = $res['outcome'] === 'duplicate';
        return Response::json(200, $res['state']);
    }

    /** POST /attempts/{id}/retry-round — повторный круг по пропущенным вопросам. */
    public function retryRound(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['fromRound']);
        $from = $v->int('fromRound', false, 1, 1000);
        $v->assertValid();

        return Response::json(200, $this->attempts->startRetryRound($ctx['user']['id'], (int) $params['id'], $from));
    }

    /** POST /attempts/{id}/finish — завершить тест и сохранить результат. */
    public function finish(Request $r, array $params, array $ctx): Response
    {
        $r->json(); // тело не используется, но проверяем, что оно корректно
        return Response::json(200, $this->attempts->finish($ctx['user']['id'], (int) $params['id']));
    }

    /** GET /attempts/{id}/result — сохранённый результат. */
    public function result(Request $r, array $params, array $ctx): Response
    {
        return Response::json(200, $this->attempts->result($ctx['user']['id'], (int) $params['id']));
    }
}
