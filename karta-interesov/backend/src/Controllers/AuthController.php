<?php

declare(strict_types=1);

namespace Karta\Controllers;

use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Core\Validator;
use Karta\Services\AuthService;

final class AuthController
{
    /** Буквы любого алфавита, далее буквы, пробел, апостроф, точка, дефис. */
    private const NAME_PATTERN = "/^\\p{L}[\\p{L} '.-]*$/u";

    public function __construct(private readonly AuthService $auth)
    {
    }

    /** POST /auth/register - регистрация студента. Токен показывается один раз. */
    public function register(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['firstName', 'lastName', 'email', 'age', 'regionCode', 'password']);
        $first = $v->string('firstName', true, 1, 50, self::NAME_PATTERN);
        $last = $v->string('lastName', true, 1, 50, self::NAME_PATTERN);
        $email = $v->email('email', true);
        $age = $v->int('age', true, 10, 100);
        $region = $v->string('regionCode', true, 1, 40, '/^[a-z0-9-]+$/');
        $password = $v->password('password');
        $v->assertValid();

        return Response::json(201, $this->auth->register((string) $first, (string) $last, (string) $email, (int) $age, (string) $region, (string) $password));
    }

    /** POST /auth/login - вход по email и паролю. Выдаёт новый токен. */
    public function login(Request $r, array $params, array $ctx): Response
    {
        $v = new Validator($r->json());
        $v->onlyKeys(['email', 'password']);
        $email = $v->email('email', true);
        // Для входа длина пароля не проверяется по политике: неверный пароль - это 401, а не 422
        $password = $v->password('password', 1, 1024);
        $v->assertValid();

        return Response::json(200, $this->auth->login((string) $email, (string) $password));
    }

    /** POST /auth/logout - аннулировать текущий токен. */
    public function logout(Request $r, array $params, array $ctx): Response
    {
        $this->auth->logout((int) $ctx['user']['id']);
        return new Response(204);
    }
}
