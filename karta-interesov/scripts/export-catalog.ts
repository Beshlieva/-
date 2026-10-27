/**
 * Выгрузка справочников из исходников frontend в docs/data/*.json (их читает backend-загрузчик).
 * Источник истины — src/data/questions.ts и src/data/regions.ts.
 *
 *   npm run catalog:export   — перезаписать JSON
 *   npm run catalog:check    — проверить, что JSON совпадает с исходниками (код возврата 1 при расхождении)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, QUESTIONS } from '../src/data/questions';
import { REGIONS } from '../src/data/regions';

const dataDir = fileURLToPath(new URL('../docs/data/', import.meta.url));
const files: Record<string, unknown> = {
  'categories.json': CATEGORIES,
  'questions.json': QUESTIONS,
  'regions.json': REGIONS,
};

const check = process.argv.includes('--check');
let mismatches = 0;

for (const [name, data] of Object.entries(files)) {
  const expected = JSON.stringify(data, null, 2) + '\n';
  const path = dataDir + name;
  if (check) {
    let actual = '';
    try {
      actual = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      /* файла нет — считаем расхождением */
    }
    // сравниваем как данные, а не как текст: форматирование JSON может отличаться
    const same = actual !== '' && JSON.stringify(JSON.parse(actual)) === JSON.stringify(data);
    if (!same) {
      mismatches++;
      console.error(`✗ ${name} не совпадает с исходниками`);
    } else {
      console.log(`✓ ${name}`);
    }
  } else {
    writeFileSync(path, expected, 'utf8');
    console.log(`записан ${name}`);
  }
}

if (check && mismatches > 0) {
  console.error('Выполните: npm run catalog:export');
  process.exit(1);
}
