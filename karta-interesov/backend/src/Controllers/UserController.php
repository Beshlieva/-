<?php

declare(strict_types=1);

namespace Karta\Controllers;

use Karta\Core\Clock;
use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Core\Validator;
use Karta\Services\UserService;

final class UserController
{
    public function __construct(private readonly UserService $users)
    {
    }

    /** POST /users — создать пользователя. Токен доступа показывается один раз. */
    public function create(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['email', 'displayName', 'regionCode']);
        $email = $v->email('email', false);
        $name = $v->string('displayName', false, 1, 100);
        $region = $v->string('regionCode', false, 1, 40, '/^[a-z0-9-]+$/');
        $v->assertValid();

        return Response::json(201, $this->users->create($email, $name, $region));
    }

    /** GET /users/me — профиль по токену. */
    public function me(Request $r, array $params, array $ctx): Response
    {
        $u = $ctx['user'];
        return Response::json(200, [
            'userId' => (string) $u['id'],
            'email' => $u['email'],
            'displayName' => $u['display_name'],
            'age' => $u['age'],
            'regionCode' => $u['region_code'],
            'createdAt' => Clock::iso(Clock::fromDb((string) $u['created_at'])),
        ]);
    }
}
