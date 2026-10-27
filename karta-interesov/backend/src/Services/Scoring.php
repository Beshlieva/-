<?php

declare(strict_types=1);

namespace Karta\Services;

/**
 * Подсчёт баллов — точная копия алгоритма из src/data/questions.ts:
 *  - raw категории = сумма значений ответов на её вопросы (пропуски в сумму не входят и не равны 0);
 *  - displayScore = round((raw + 12) / 24 * 100).
 * Топ-5 во frontend — сортировка по баллу по убыванию с сохранением порядка по id при равенстве.
 */
final class Scoring
{
    public const DISPLAY_OFFSET = 12;
    public const DISPLAY_SPAN = 24;

    public static function display(int $raw): int
    {
        // raw >= -12, значит аргумент неотрицателен: PHP round() и JS Math.round() дают одинаковый результат
        return (int) round((($raw + self::DISPLAY_OFFSET) / self::DISPLAY_SPAN) * 100);
    }

    /**
     * @param int[] $categoryIds все категории (по возрастанию id)
     * @param array<int,int> $rawByCategory categoryId => сумма ответов (отсутствует = 0)
     * @return array<int,array{categoryId:int,rawScore:int,displayScore:int,rank:int}>
     */
    public static function build(array $categoryIds, array $rawByCategory): array
    {
        $rows = [];
        foreach ($categoryIds as $id) {
            $raw = $rawByCategory[$id] ?? 0;
            $rows[] = ['categoryId' => $id, 'rawScore' => $raw, 'displayScore' => self::display($raw), 'rank' => 0];
        }
        $ranked = $rows;
        usort($ranked, static function (array $a, array $b): int {
            return [$b['rawScore'], $a['categoryId']] <=> [$a['rawScore'], $b['categoryId']];
        });
        $rankById = [];
        foreach ($ranked as $i => $r) {
            $rankById[$r['categoryId']] = $i + 1;
        }
        foreach ($rows as &$r) {
            $r['rank'] = $rankById[$r['categoryId']];
        }
        unset($r);
        return $rows;
    }
}
