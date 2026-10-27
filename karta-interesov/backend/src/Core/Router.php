<?php

declare(strict_types=1);

namespace Karta\Core;

final class Router
{
    /** @var array<int,array{method:string,regex:string,handler:callable,auth:?string}> */
    private array $routes = [];

    /** $auth: null — публичный адрес, 'user' — токен пользователя, 'admin' — токен администратора. */
    public function add(string $method, string $pattern, callable $handler, ?string $auth = null): void
    {
        $regex = (string) preg_replace('#\{([a-zA-Z]+)\}#', '(?P<$1>[0-9]{1,18})', $pattern);
        $this->routes[] = [
            'method' => $method,
            'regex' => '#^' . $regex . '$#',
            'handler' => $handler,
            'auth' => $auth,
        ];
    }

    /** @return array{handler:callable,params:array<string,string>,auth:?string} */
    public function match(string $method, string $path): array
    {
        $pathMatched = false;
        foreach ($this->routes as $route) {
            if (preg_match($route['regex'], $path, $m) !== 1) {
                continue;
            }
            $pathMatched = true;
            if ($route['method'] !== $method) {
                continue;
            }
            $params = [];
            foreach ($m as $k => $v) {
                if (is_string($k)) {
                    $params[$k] = $v;
                }
            }
            return ['handler' => $route['handler'], 'params' => $params, 'auth' => $route['auth']];
        }
        if ($pathMatched) {
            throw new HttpException(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается для этого адреса.');
        }
        throw new HttpException(404, 'NOT_FOUND', 'Адрес не найден.');
    }
}
