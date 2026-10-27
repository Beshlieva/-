<?php

declare(strict_types=1);

namespace Karta\Controllers;

use Karta\Core\Config;
use Karta\Core\Request;
use Karta\Core\Response;
use Karta\Services\Catalog;

final class CatalogController
{
    public function __construct(private readonly Catalog $catalog, private readonly Config $config)
    {
    }

    /** @param array<string,string> $params */
    public function regions(Request $r, array $params): Response
    {
        return $this->cached(['regions' => $this->catalog->regions()]);
    }

    /** @param array<string,string> $params */
    public function categories(Request $r, array $params): Response
    {
        return $this->cached(['testVersion' => $this->config->testVersion, 'categories' => $this->catalog->categories()]);
    }

    /** @param array<string,string> $params */
    public function questions(Request $r, array $params): Response
    {
        $questions = $this->catalog->questions();
        return $this->cached(['testVersion' => $this->config->testVersion, 'total' => count($questions), 'questions' => $questions]);
    }

    /** @param array<string,mixed> $data */
    private function cached(array $data): Response
    {
        // Справочники меняются только при смене версии теста — можно кэшировать на несколько минут
        return Response::json(200, $data)->withHeader('Cache-Control', 'public, max-age=300');
    }
}
