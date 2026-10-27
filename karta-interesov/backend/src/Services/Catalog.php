<?php

declare(strict_types=1);

namespace Karta\Services;

use PDO;

/** Справочники теста из БД (категории, вопросы, регионы). */
final class Catalog
{
    /** @var int[]|null */
    private ?array $categoryIds = null;
    private ?int $questionCount = null;

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** @return int[] */
    public function categoryIds(): array
    {
        if ($this->categoryIds === null) {
            $this->categoryIds = array_map('intval', $this->pdo->query('SELECT id FROM categories ORDER BY id')->fetchAll(PDO::FETCH_COLUMN));
        }
        return $this->categoryIds;
    }

    public function questionCount(): int
    {
        if ($this->questionCount === null) {
            $this->questionCount = (int) $this->pdo->query('SELECT COUNT(*) FROM questions')->fetchColumn();
        }
        return $this->questionCount;
    }

    public function regionIdByCode(string $code): ?int
    {
        $st = $this->pdo->prepare('SELECT id FROM regions WHERE code = ?');
        $st->execute([$code]);
        $id = $st->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** @return array<int,array{code:string,name:string,kind:string}> */
    public function regions(): array
    {
        return $this->pdo->query('SELECT code, name, kind FROM regions ORDER BY sort_order')->fetchAll();
    }

    /** @return array<int,array<string,mixed>> */
    public function categories(): array
    {
        $rows = $this->pdo->query('SELECT id, name, description, color, icon FROM categories ORDER BY id')->fetchAll();
        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'name' => $r['name'],
            'description' => $r['description'],
            'color' => $r['color'],
            'icon' => $r['icon'],
        ], $rows);
    }

    /** @return array<int,array<string,mixed>> */
    public function questions(): array
    {
        $rows = $this->pdo->query('SELECT id, text, category_id FROM questions ORDER BY id')->fetchAll();
        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'text' => $r['text'],
            'categoryId' => (int) $r['category_id'],
        ], $rows);
    }
}
