<?php

declare(strict_types=1);

namespace Karta\Setup;

use PDO;
use RuntimeException;

/**
 * Загрузка справочников из docs/data/{categories,questions,regions}.json в MySQL.
 * Источник истины — src/data/*.ts проекта (JSON выгружается npm run catalog:export).
 *
 * Повторный запуск дубликатов не создаёт: строки сопоставляются по первичному ключу (id / code).
 * Если в БД строка отличается от файла, по умолчанию это конфликт (ничего не меняется, код возврата 1):
 * вопросы теста нельзя молча менять после начала сбора данных. Осознанно обновить — флаг $update.
 */
final class CatalogSeeder
{
    public const EXPECTED_CATEGORIES = 29;
    public const EXPECTED_QUESTIONS = 174;

    public function __construct(private readonly PDO $pdo, private readonly string $dir)
    {
    }

    /**
     * @return array{inserted:int,updated:int,unchanged:int,conflicts:string[]}
     */
    public function seed(bool $update, callable $log): array
    {
        $data = $this->load();
        $totals = ['inserted' => 0, 'updated' => 0, 'unchanged' => 0, 'conflicts' => []];

        $this->pdo->beginTransaction();
        try {
            foreach ($this->tables($data) as $table => $spec) {
                $plan = $this->plan($table, $spec['key'], $spec['cols'], $spec['rows']);
                $totals['unchanged'] += $plan['same'];

                foreach ($plan['conflicts'] as $c) {
                    $totals['conflicts'][] = "{$table} {$c}";
                }
                if ($plan['conflicts'] !== [] && !$update) {
                    $log("{$table}: расхождения с файлом — " . count($plan['conflicts']) . ' (не применены)');
                }

                foreach ($plan['insert'] as $row) {
                    $this->insert($table, $spec['insertCols'], $row);
                    $totals['inserted']++;
                }
                if ($update) {
                    foreach ($plan['update'] as $row) {
                        $this->updateRow($table, $spec['key'], $spec['cols'], $row);
                        $totals['updated']++;
                    }
                }
                $log(sprintf(
                    '%s: добавлено %d, без изменений %d%s',
                    $table,
                    count($plan['insert']),
                    $plan['same'],
                    $update ? ', обновлено ' . count($plan['update']) : '',
                ));
            }

            if ($totals['conflicts'] !== [] && !$update) {
                $this->pdo->rollBack();
                return $totals;
            }
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
        if ($update) {
            $totals['conflicts'] = [];
        }
        return $totals;
    }

    /**
     * Сверка БД с файлами без изменений. Возвращает список расхождений (пустой = всё совпадает).
     *
     * @return string[]
     */
    public function verify(): array
    {
        $data = $this->load();
        $problems = [];
        foreach ($this->tables($data) as $table => $spec) {
            $plan = $this->plan($table, $spec['key'], $spec['cols'], $spec['rows']);
            foreach ($plan['insert'] as $row) {
                $problems[] = "{$table}: нет строки {$spec['key']}=" . $row[$spec['key']];
            }
            foreach ($plan['conflicts'] as $c) {
                $problems[] = "{$table} {$c}";
            }
            $extra = $this->extraKeys($table, $spec['key'], $spec['rows']);
            foreach ($extra as $k) {
                $problems[] = "{$table}: лишняя строка {$spec['key']}={$k}";
            }
        }
        return $problems;
    }

    // ───────────────────────── Чтение и проверка файлов ─────────────────────────

    /** @return array{categories:array<int,array<string,mixed>>,questions:array<int,array<string,mixed>>,regions:array<int,array<string,mixed>>} */
    private function load(): array
    {
        $categories = $this->readJson('categories.json');
        $questions = $this->readJson('questions.json');
        $regions = $this->readJson('regions.json');

        if (count($categories) !== self::EXPECTED_CATEGORIES) {
            throw new RuntimeException('Ожидалось ' . self::EXPECTED_CATEGORIES . ' категорий, в файле ' . count($categories) . '.');
        }
        if (count($questions) !== self::EXPECTED_QUESTIONS) {
            throw new RuntimeException('Ожидалось ' . self::EXPECTED_QUESTIONS . ' вопросов, в файле ' . count($questions) . '.');
        }

        $catIds = [];
        $catRows = [];
        foreach ($categories as $i => $c) {
            $id = $c['id'] ?? null;
            if (!is_int($id) || $id !== $i + 1) {
                throw new RuntimeException("categories.json[{$i}]: id должен быть {$this->n($i + 1)} (подряд, без пропусков).");
            }
            foreach (['name', 'description', 'color', 'icon'] as $f) {
                if (!isset($c[$f]) || !is_string($c[$f]) || $c[$f] === '') {
                    throw new RuntimeException("categories.json[{$i}]: поле {$f} должно быть непустой строкой.");
                }
            }
            if (preg_match('/^#[0-9A-Fa-f]{6}$/', $c['color']) !== 1) {
                throw new RuntimeException("categories.json[{$i}]: некорректный цвет.");
            }
            $catIds[$id] = true;
            $catRows[] = ['id' => $id, 'name' => $c['name'], 'description' => $c['description'], 'color' => $c['color'], 'icon' => $c['icon']];
        }

        $perCategory = [];
        $qRows = [];
        foreach ($questions as $i => $q) {
            $id = $q['id'] ?? null;
            if (!is_int($id) || $id !== $i + 1) {
                throw new RuntimeException("questions.json[{$i}]: id должен быть {$this->n($i + 1)} (подряд, без пропусков).");
            }
            $cat = $q['categoryId'] ?? null;
            if (!is_int($cat) || !isset($catIds[$cat])) {
                throw new RuntimeException("questions.json[{$i}]: неизвестная категория.");
            }
            if (!isset($q['text']) || !is_string($q['text']) || trim($q['text']) === '' || mb_strlen($q['text'], 'UTF-8') > 500) {
                throw new RuntimeException("questions.json[{$i}]: текст должен быть непустой строкой до 500 символов.");
            }
            $perCategory[$cat] = ($perCategory[$cat] ?? 0) + 1;
            // Текст сохраняется БЕЗ изменений (без trim и нормализации)
            $qRows[] = ['id' => $id, 'category_id' => $cat, 'text' => $q['text']];
        }
        foreach (array_keys($catIds) as $id) {
            if (($perCategory[$id] ?? 0) === 0) {
                throw new RuntimeException("В категории {$id} нет вопросов.");
            }
        }

        $codes = [];
        $names = [];
        $regRows = [];
        foreach ($regions as $i => $r) {
            $code = $r['code'] ?? null;
            $name = $r['name'] ?? null;
            $kind = $r['kind'] ?? null;
            if (!is_string($code) || preg_match('/^[a-z0-9-]{1,40}$/', $code) !== 1) {
                throw new RuntimeException("regions.json[{$i}]: некорректный code.");
            }
            if (!is_string($name) || $name === '' || mb_strlen($name, 'UTF-8') > 100) {
                throw new RuntimeException("regions.json[{$i}]: некорректное name.");
            }
            if (!in_array($kind, ['region', 'city'], true)) {
                throw new RuntimeException("regions.json[{$i}]: kind должен быть region или city.");
            }
            if (isset($codes[$code]) || isset($names[$name])) {
                throw new RuntimeException("regions.json[{$i}]: повтор кода или названия.");
            }
            $codes[$code] = true;
            $names[$name] = true;
            $regRows[] = ['code' => $code, 'name' => $name, 'kind' => $kind, 'sort_order' => $i + 1];
        }
        if ($regRows === []) {
            throw new RuntimeException('regions.json пуст.');
        }

        return ['categories' => $catRows, 'questions' => $qRows, 'regions' => $regRows];
    }

    private function n(int $v): string
    {
        return (string) $v;
    }

    /** @return array<int,array<string,mixed>> */
    private function readJson(string $file): array
    {
        $path = $this->dir . DIRECTORY_SEPARATOR . $file;
        if (!is_file($path)) {
            throw new RuntimeException("Не найден файл {$path}. Задайте CATALOG_DIR или выполните npm run catalog:export.");
        }
        try {
            $data = json_decode((string) file_get_contents($path), true, 8, JSON_THROW_ON_ERROR);
        } catch (\JsonException $e) {
            throw new RuntimeException("{$file}: некорректный JSON ({$e->getMessage()}).");
        }
        if (!is_array($data) || !array_is_list($data)) {
            throw new RuntimeException("{$file}: ожидался массив.");
        }
        return $data;
    }

    // ───────────────────────── Сопоставление с БД ─────────────────────────

    /**
     * Порядок важен: категории раньше вопросов (внешний ключ).
     *
     * @param array<string,array<int,array<string,mixed>>> $data
     * @return array<string,array{key:string,cols:string[],insertCols:string[],rows:array<int,array<string,mixed>>}>
     */
    private function tables(array $data): array
    {
        return [
            'categories' => ['key' => 'id', 'cols' => ['name', 'description', 'color', 'icon'], 'insertCols' => ['id', 'name', 'description', 'color', 'icon'], 'rows' => $data['categories']],
            'questions' => ['key' => 'id', 'cols' => ['category_id', 'text'], 'insertCols' => ['id', 'category_id', 'text'], 'rows' => $data['questions']],
            // kato_code намеренно не трогаем: его заполняют вручную после сверки с официальным классификатором
            'regions' => ['key' => 'code', 'cols' => ['name', 'kind', 'sort_order'], 'insertCols' => ['code', 'name', 'kind', 'sort_order'], 'rows' => $data['regions']],
        ];
    }

    /**
     * @param string[] $cols
     * @param array<int,array<string,mixed>> $rows
     * @return array{insert:array<int,array<string,mixed>>,update:array<int,array<string,mixed>>,conflicts:string[],same:int}
     */
    private function plan(string $table, string $key, array $cols, array $rows): array
    {
        $select = $this->pdo->query('SELECT ' . implode(', ', array_merge([$key], $cols)) . " FROM {$table}");
        $existing = [];
        foreach ($select->fetchAll() as $r) {
            $existing[(string) $r[$key]] = $r;
        }

        $plan = ['insert' => [], 'update' => [], 'conflicts' => [], 'same' => 0];
        foreach ($rows as $row) {
            $k = (string) $row[$key];
            if (!isset($existing[$k])) {
                $plan['insert'][] = $row;
                continue;
            }
            $diff = [];
            foreach ($cols as $c) {
                if ((string) $existing[$k][$c] !== (string) $row[$c]) {
                    $diff[] = $c;
                }
            }
            if ($diff === []) {
                $plan['same']++;
            } else {
                $plan['update'][] = $row;
                $plan['conflicts'][] = "{$key}={$k}: отличаются поля " . implode(', ', $diff);
            }
        }
        return $plan;
    }

    /**
     * @param array<int,array<string,mixed>> $rows
     * @return string[]
     */
    private function extraKeys(string $table, string $key, array $rows): array
    {
        $want = [];
        foreach ($rows as $r) {
            $want[(string) $r[$key]] = true;
        }
        $extra = [];
        foreach ($this->pdo->query("SELECT {$key} FROM {$table}")->fetchAll(PDO::FETCH_COLUMN) as $k) {
            if (!isset($want[(string) $k])) {
                $extra[] = (string) $k;
            }
        }
        return $extra;
    }

    /**
     * @param string[] $cols
     * @param array<string,mixed> $row
     */
    private function insert(string $table, array $cols, array $row): void
    {
        $sql = sprintf('INSERT INTO %s (%s) VALUES (%s)', $table, implode(', ', $cols), implode(', ', array_fill(0, count($cols), '?')));
        $st = $this->pdo->prepare($sql);
        $st->execute(array_map(static fn(string $c): mixed => $row[$c], $cols));
    }

    /**
     * @param string[] $cols
     * @param array<string,mixed> $row
     */
    private function updateRow(string $table, string $key, array $cols, array $row): void
    {
        $set = implode(', ', array_map(static fn(string $c): string => "{$c} = ?", $cols));
        $st = $this->pdo->prepare("UPDATE {$table} SET {$set} WHERE {$key} = ?");
        $st->execute(array_merge(array_map(static fn(string $c): mixed => $row[$c], $cols), [$row[$key]]));
    }
}
