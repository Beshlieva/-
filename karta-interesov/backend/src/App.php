<?php

declare(strict_types=1);

namespace Karta;

use Karta\Controllers\AdminController;
use Karta\Controllers\AttemptController;
use Karta\Controllers\AuthController;
use Karta\Controllers\CatalogController;
use Karta\Controllers\UserController;
use Karta\Core\Clock;
use Karta\Core\Config;
use Karta\Core\Database;
use Karta\Core\HttpException;
use Karta\Core\Logger;
use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Core\Router;
use Karta\Services\AdminAuthService;
use Karta\Services\AnalyticsService;
use Karta\Services\AttemptService;
use Karta\Services\AuditLog;
use Karta\Services\AuthService;
use Karta\Services\Catalog;
use Karta\Services\UserService;
use PDO;

final class App
{
    private ?PDO $pdo = null;
    private Clock $clock;
    private Logger $logger;
    /** @var array<string,object> */
    private array $services = [];

    private function __construct(private readonly Config $config)
    {
        $this->clock = new Clock();
        $this->logger = new Logger($config->logFile);
    }

    public static function run(): void
    {
        date_default_timezone_set('UTC');
        ini_set('display_errors', '0');
        mb_internal_encoding('UTF-8');
        set_error_handler(static function (int $no, string $str, string $file, int $line): bool {
            if ((error_reporting() & $no) === 0) {
                return false;
            }
            throw new \ErrorException($str, 0, $no, $file, $line);
        });

        try {
            $config = Config::fromEnv();
        } catch (\Throwable $e) {
            error_log('[karta] Ошибка конфигурации: ' . $e->getMessage());
            Response::error(500, 'SERVER_MISCONFIGURED', 'Сервер настроен неверно.')->send();
            return;
        }

        $app = new self($config);
        $response = $app->handle();
        $response->send();
    }

    private function handle(): Response
    {
        $cors = [];
        try {
            $request = Request::fromGlobals($this->config);
            $cors = $this->corsHeaders($request);

            if ($request->method === 'OPTIONS') {
                return new Response(204, null, $cors);
            }

            $response = $this->dispatch($request);
        } catch (HttpException $e) {
            $response = Response::error($e->status, $e->errorCode, $e->getMessage(), $e->details);
            if ($e->status === 401) {
                $response->headers['WWW-Authenticate'] = 'Bearer';
            }
        } catch (\Throwable $e) {
            $this->logger->error('Необработанная ошибка', $e);
            $details = $this->config->debug ? ['exception' => $e::class . ': ' . $e->getMessage()] : [];
            $response = Response::error(500, 'INTERNAL_ERROR', 'Внутренняя ошибка сервера.', $details);
        }

        foreach ($cors as $name => $value) {
            $response->headers[$name] = $value;
        }
        return $response;
    }

    /** @return array<string,string> */
    private function corsHeaders(Request $request): array
    {
        $origin = $request->header('origin');
        if ($origin === null || !in_array(rtrim($origin, '/'), $this->config->corsOrigins, true)) {
            return ['Vary' => 'Origin'];
        }
        return [
            'Access-Control-Allow-Origin' => rtrim($origin, '/'),
            'Vary' => 'Origin',
            'Access-Control-Allow-Methods' => 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers' => 'Content-Type, Authorization, Accept',
            'Access-Control-Max-Age' => '600',
        ];
    }

    private function dispatch(Request $request): Response
    {
        $base = $this->config->apiBasePath;
        $path = $request->path;
        if ($base !== '') {
            if ($path !== $base && strncmp($path, $base . '/', strlen($base) + 1) !== 0) {
                throw new HttpException(404, 'NOT_FOUND', 'Адрес не найден.');
            }
            $path = substr($path, strlen($base));
        }
        $path = $path === '' ? '/' : rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }

        $route = $this->router()->match($request->method, $path);

        $ctx = [];
        if ($route['auth'] === 'user') {
            $token = $request->bearerToken();
            $user = $token === null ? null : $this->userService()->findByToken($token);
            if ($user === null) {
                throw new HttpException(401, 'UNAUTHORIZED', 'Требуется действительный токен доступа.');
            }
            $ctx['user'] = $user;
        } elseif ($route['auth'] === 'admin') {
            $admin = $this->adminAuth()->authenticate($request->bearerToken());
            if ($admin === null) {
                throw new HttpException(401, 'UNAUTHORIZED', 'Требуется авторизация администратора.');
            }
            $ctx['admin'] = $admin;
        }

        return ($route['handler'])($request, $route['params'], $ctx);
    }

    private function router(): Router
    {
        $r = new Router();
        // Контроллеры (и подключение к БД) создаются только при вызове обработчика
        $h = fn(string $controller, string $method): \Closure =>
            fn(Request $q, array $p, array $c): Response => $this->controller($controller)->$method($q, $p, $c);

        $r->add('GET', '/health', fn(Request $q, array $p, array $c): Response => $this->health());

        // Публичные справочники
        $r->add('GET', '/regions', $h(CatalogController::class, 'regions'));
        $r->add('GET', '/categories', $h(CatalogController::class, 'categories'));
        $r->add('GET', '/questions', $h(CatalogController::class, 'questions'));

        // Пользователи
        $r->add('POST', '/users', $h(UserController::class, 'create'));
        $r->add('GET', '/users/me', $h(UserController::class, 'me'), 'user');

        // Регистрация и вход студентов (email + пароль)
        $r->add('POST', '/auth/register', $h(AuthController::class, 'register'));
        $r->add('POST', '/auth/login', $h(AuthController::class, 'login'));
        $r->add('POST', '/auth/logout', $h(AuthController::class, 'logout'), 'user');

        // Попытки (только владелец, по токену пользователя)
        $r->add('POST', '/attempts', $h(AttemptController::class, 'create'), 'user');
        $r->add('GET', '/attempts/active', $h(AttemptController::class, 'active'), 'user');
        $r->add('GET', '/attempts/{id}', $h(AttemptController::class, 'show'), 'user');
        $r->add('POST', '/attempts/{id}/answers', $h(AttemptController::class, 'answer'), 'user');
        $r->add('POST', '/attempts/{id}/skips', $h(AttemptController::class, 'skip'), 'user');
        $r->add('POST', '/attempts/{id}/retry-round', $h(AttemptController::class, 'retryRound'), 'user');
        $r->add('POST', '/attempts/{id}/finish', $h(AttemptController::class, 'finish'), 'user');
        $r->add('GET', '/attempts/{id}/result', $h(AttemptController::class, 'result'), 'user');

        // Администратор
        $r->add('POST', '/admin/login', $h(AdminController::class, 'login'));
        $r->add('POST', '/admin/logout', $h(AdminController::class, 'logout'), 'admin');
        $r->add('GET', '/admin/analytics/overview', $h(AdminController::class, 'overview'), 'admin');
        $r->add('GET', '/admin/users', $h(AdminController::class, 'users'), 'admin');
        $r->add('GET', '/admin/results', $h(AdminController::class, 'results'), 'admin');
        $r->add('GET', '/admin/results/{id}', $h(AdminController::class, 'resultDetail'), 'admin');
        $r->add('GET', '/admin/export/results.csv', $h(AdminController::class, 'exportResults'), 'admin');
        $r->add('GET', '/admin/analytics/summary', $h(AdminController::class, 'summary'), 'admin');
        $r->add('GET', '/admin/analytics/regions', $h(AdminController::class, 'regions'), 'admin');
        $r->add('GET', '/admin/attempts', $h(AdminController::class, 'attempts'), 'admin');
        $r->add('GET', '/admin/audit-logs', $h(AdminController::class, 'auditLogs'), 'admin');

        return $r;
    }

    private function controller(string $class): object
    {
        return $this->services[$class] ??= match ($class) {
            CatalogController::class => new CatalogController($this->catalog(), $this->config),
            UserController::class => new UserController($this->userService()),
            AuthController::class => new AuthController($this->authService()),
            AttemptController::class => new AttemptController($this->attemptService()),
            AdminController::class => new AdminController($this->adminAuth(), $this->analytics(), $this->audit()),
            default => throw new \LogicException('Неизвестный контроллер ' . $class),
        };
    }

    private function health(): Response
    {
        try {
            $this->pdo()->query('SELECT 1')->fetchColumn();
        } catch (\Throwable $e) {
            $this->logger->error('Проверка /health: БД недоступна', $e);
            return Response::error(503, 'DB_UNAVAILABLE', 'База данных недоступна.');
        }
        return Response::json(200, ['status' => 'ok']);
    }

    private function pdo(): PDO
    {
        return $this->pdo ??= Database::connect($this->config);
    }

    private function catalog(): Catalog
    {
        return $this->services[Catalog::class] ??= new Catalog($this->pdo());
    }

    private function userService(): UserService
    {
        return $this->services[UserService::class] ??= new UserService($this->pdo(), $this->clock, $this->catalog());
    }

    private function authService(): AuthService
    {
        return $this->services[AuthService::class] ??= new AuthService($this->pdo(), $this->clock, $this->catalog());
    }

    private function attemptService(): AttemptService
    {
        return $this->services[AttemptService::class] ??= new AttemptService($this->pdo(), $this->config, $this->clock, $this->catalog());
    }

    private function audit(): AuditLog
    {
        return $this->services[AuditLog::class] ??= new AuditLog($this->pdo(), $this->clock, $this->logger);
    }

    private function adminAuth(): AdminAuthService
    {
        return $this->services[AdminAuthService::class] ??= new AdminAuthService($this->pdo(), $this->config, $this->clock, $this->audit());
    }

    private function analytics(): AnalyticsService
    {
        return $this->services[AnalyticsService::class] ??= new AnalyticsService($this->pdo(), $this->catalog());
    }
}
