/**
 * Проверка исходных данных и логики теста без браузера и без тест-раннера.
 * Запуск: npm run verify  (нужен пакет tsx из devDependencies)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, QUESTIONS, ANSWER_OPTIONS, calculateResults, toDisplay } from '../src/data/questions';
import {
  QUESTION_TIME_MS, MIN_ANSWER_DELAY_MS,
  createSession, answerQuestion, expireQuestion, startRetryRound, reconcileOnLoad, parseSession,
  currentQuestionId, isRoundFinished, isComplete, unansweredIds, skippedCount, remainingMs,
} from '../src/lib/testSession';
import type { TestSession } from '../src/lib/testSession';
import { parseAge, validatePassword, validateRegistration } from '../src/lib/registrationValidation';
import type { RegistrationValues } from '../src/lib/registrationValidation';
import { REGIONS } from '../src/data/regions';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = '') {
  if (cond) passed++;
  else failures.push(`${name}${extra ? ' — ' + extra : ''}`);
}
const T0 = 1_700_000_000_000;
const LATE = MIN_ANSWER_DELAY_MS + 10; // «человеческая» задержка перед ответом

// ───────────── Исходные данные ─────────────
check('174 вопроса', QUESTIONS.length === 174, String(QUESTIONS.length));
check('29 категорий', CATEGORIES.length === 29, String(CATEGORIES.length));
check('id вопросов 1..174 подряд', QUESTIONS.every((q, i) => q.id === i + 1));
check('id категорий 1..29 подряд', CATEGORIES.every((c, i) => c.id === i + 1));
check('у каждой категории 6 вопросов', CATEGORIES.every(c => QUESTIONS.filter(q => q.categoryId === c.id).length === 6));
check('тексты вопросов непустые', QUESTIONS.every(q => q.text.trim().length > 0));
check('варианты ответа +2…−2', JSON.stringify(ANSWER_OPTIONS.map(o => o.value)) === '[2,1,0,-1,-2]');
check('toDisplay: −12→0, 0→50, +12→100', toDisplay(-12) === 0 && toDisplay(0) === 50 && toDisplay(12) === 100);
{
  const all2: Record<number, number> = {};
  QUESTIONS.forEach(q => { all2[q.id] = 2; });
  const r = calculateResults(all2);
  check('формула: все «+2» → +12 по каждой из 29 категорий', Object.keys(r).length === 29 && Object.values(r).every(v => v === 12));
  const r0 = calculateResults({ 1: 2, 2: -1 });
  check('формула: пропуск не считается нулём и не влияет на сумму', r0[1] === 1 && r0[2] === 0);
}
{
  const dir = fileURLToPath(new URL('../docs/data/', import.meta.url));
  const q = JSON.parse(readFileSync(dir + 'questions.json', 'utf8')) as typeof QUESTIONS;
  const c = JSON.parse(readFileSync(dir + 'categories.json', 'utf8')) as typeof CATEGORIES;
  check('docs/data/questions.json совпадает с questions.ts', JSON.stringify(q) === JSON.stringify(QUESTIONS));
  check('docs/data/categories.json совпадает с questions.ts', JSON.stringify(c) === JSON.stringify(CATEGORIES));
}

// ───────────── Таймер и переходы ─────────────
let s: TestSession = createSession(T0);
check('старт: вопрос 1, deadline = старт + 15 с', currentQuestionId(s) === 1 && s.deadline === T0 + QUESTION_TIME_MS);
check('remainingMs в начале = 15000', remainingMs(s, T0) === QUESTION_TIME_MS);
check('remainingMs не растёт при переводе часов назад', remainingMs(s, T0 - 60_000) === QUESTION_TIME_MS);

// ответ
const a1 = answerQuestion(s, 1, 2, T0 + 1000);
check('ответ записан, открыт вопрос 2', a1.answers[1] === 2 && currentQuestionId(a1) === 2);
check('у вопроса 2 новый deadline', a1.deadline === T0 + 1000 + QUESTION_TIME_MS);
// двойной ответ / устаревший клик
check('повторный ответ на тот же вопрос игнорируется', answerQuestion(a1, 1, -2, T0 + 1500) === a1);
check('ответ на «чужой» вопрос игнорируется', answerQuestion(a1, 5, 1, T0 + 2000) === a1);
check('ответ сразу после открытия (двойной клик) игнорируется', answerQuestion(a1, 2, 1, T0 + 1000 + 50) === a1);
check('недопустимое значение игнорируется', answerQuestion(a1, 2, 3, T0 + 3000) === a1);
// таймаут
check('expire раньше времени не срабатывает', expireQuestion(s, 1, T0 + QUESTION_TIME_MS - 1) === s);
const e1 = expireQuestion(s, 1, T0 + QUESTION_TIME_MS);
check('expire в нуль: вопрос пропущен, ответа нет, открыт вопрос 2', e1.answers[1] === undefined && currentQuestionId(e1) === 2 && e1.lastExpiredId === 1);
check('повторный expire того же вопроса — без эффекта (нет перескока)', expireQuestion(e1, 1, T0 + QUESTION_TIME_MS + 5) === e1);
check('после истечения времени ответ «задним числом» не принимается', answerQuestion(s, 1, 1, T0 + QUESTION_TIME_MS + 1) === s);
check('пропуск не превращается в 0', !('1' in e1.answers));
check('счётчик пропусков в круге 1', skippedCount(e1) === 1);

// восстановление после обновления страницы
const restoredLive = reconcileOnLoad(a1, T0 + 5000);
check('перезагрузка до окончания: время не сбрасывается', restoredLive.deadline === a1.deadline && remainingMs(restoredLive, T0 + 5000) === a1.deadline! - (T0 + 5000));
const restoredLate = reconcileOnLoad(a1, a1.deadline! + 1);
check('перезагрузка после окончания: вопрос пропущен, не более одного за загрузку', restoredLate.answers[2] === undefined && currentQuestionId(restoredLate) === 3 && restoredLate.position === 2);
const clockBack = reconcileOnLoad(a1, T0 - 3_600_000);
check('сдвиг часов назад не продлевает вопрос выше 15 с', remainingMs(clockBack, T0 - 3_600_000) <= QUESTION_TIME_MS);
// сериализация
const roundTrip = parseSession(JSON.parse(JSON.stringify(a1)));
check('сессия переживает JSON-сериализацию', roundTrip !== null && JSON.stringify(roundTrip) === JSON.stringify(a1));
check('битая сессия отклоняется (ответ на непоказанный вопрос)',
  parseSession({ ...JSON.parse(JSON.stringify(a1)), answers: { 1: 2, 50: 1 } }) === null);
check('битая сессия отклоняется (deadline не число)', parseSession({ ...JSON.parse(JSON.stringify(a1)), deadline: 'x' }) === null);
check('мусор отклоняется', parseSession(null) === null && parseSession('x') === null && parseSession({}) === null);

// полный прогон: отвечаем на всё кроме вопросов 10, 20, 30
let t = T0;
s = createSession(t);
const SKIP_FIRST = new Set([10, 20, 30]);
while (!isRoundFinished(s)) {
  const id = currentQuestionId(s)!;
  if (SKIP_FIRST.has(id)) {
    t = s.deadline!;
    s = expireQuestion(s, id, t);
  } else {
    t += LATE;
    s = answerQuestion(s, id, ((id % 5) - 2), t);
  }
}
check('круг 1 завершён', isRoundFinished(s) && s.deadline === null);
check('после круга 1 без ответа ровно 3 вопроса', JSON.stringify(unansweredIds(s.answers)) === '[10,20,30]');
check('результат недоступен при пропусках', !isComplete(s.answers));
check('пропущенные = 3', skippedCount(s) === 3);
check('answerQuestion после конца круга игнорируется', answerQuestion(s, 174, 1, t + 1000) === s);

// повторный круг
const r2 = startRetryRound(s, t);
check('повтор: круг 2, очередь только пропуски [10,20,30]', r2.round === 2 && JSON.stringify(r2.queue) === '[10,20,30]' && currentQuestionId(r2) === 10);
check('повтор нельзя запустить посреди круга', startRetryRound(r2, t) === r2);
let q2 = answerQuestion(r2, 10, 1, t + LATE);                        // ответ
t += LATE;
q2 = expireQuestion(q2, 20, q2.deadline!);                           // повторное истечение
t = r2.deadline!;
check('повтор: 20 остаётся пропущенным, открыт 30', q2.answers[20] === undefined && currentQuestionId(q2) === 30);
q2 = answerQuestion(q2, 30, -2, q2.deadline! - 5000);
check('круг 2 закончен, остался 1 пропуск (20)', isRoundFinished(q2) && JSON.stringify(unansweredIds(q2.answers)) === '[20]');
check('результат всё ещё недоступен', !isComplete(q2.answers));
const r3 = startRetryRound(q2, t + 100_000);
check('круг 3 только по вопросу 20', r3.round === 3 && JSON.stringify(r3.queue) === '[20]');
const done = answerQuestion(r3, 20, 2, r3.deadline! - 10_000);
check('после ответа на последний пропуск результат доступен', isComplete(done.answers) && isRoundFinished(done));
check('startRetryRound без пропусков не меняет сессию', startRetryRound(done, t) === done);
const sum = Object.keys(done.answers).length;
check('ответов ровно 174', sum === 174, String(sum));

// ───────────── Регистрация: проверка формы ─────────────
{
  const ok: RegistrationValues = {
    firstName: 'Айдана', lastName: 'Нұрланова', email: 'aidana@example.com', age: '17',
    regionCode: REGIONS[0].code, password: 'pass-1234', passwordRepeat: 'pass-1234',
  };
  const bad = (patch: Partial<RegistrationValues>) => validateRegistration({ ...ok, ...patch });
  check('регистрация: корректные данные без ошибок', Object.keys(validateRegistration(ok)).length === 0);
  check('регистрация: пустые обязательные поля', Object.keys(validateRegistration({ ...ok, firstName: '', lastName: ' ', email: '', age: '', regionCode: '', password: '', passwordRepeat: '' })).length === 6);
  check('регистрация: некорректный email', bad({ email: 'aidana@' }).email === 'Введите корректный email, например name@example.com.');
  check('регистрация: имя с цифрами', bad({ firstName: 'Ай2дана' }).firstName !== undefined);
  check('регистрация: двойная фамилия и апостроф допустимы', bad({ lastName: "Ахметова-О'Нил" }).lastName === undefined);
  check('возраст: границы 10 и 100', 'age' in parseAge('10') && 'age' in parseAge('100'));
  check('возраст: 9, 101, 0, -5, 17.5, abc отклоняются', ['9', '101', '0', '-5', '17.5', 'abc'].every(v => 'error' in parseAge(v)));
  check('регистрация: неизвестный регион', bad({ regionCode: 'atlantis' }).regionCode !== undefined);
  check('пароль: короче 8 символов', validatePassword('short') !== undefined);
  check('пароль: длиннее 72 байт', validatePassword('я'.repeat(40)) !== undefined);
  check('регистрация: пароли не совпадают', bad({ passwordRepeat: 'other-pass' }).passwordRepeat === 'Пароли не совпадают.');
  check('справочник регионов: 20 записей без дублей кодов', REGIONS.length === 20 && new Set(REGIONS.map(r => r.code)).size === 20);
}

// ───────────── Итог ─────────────
if (failures.length) {
  console.error(`\n✗ Провалено проверок: ${failures.length}`);
  failures.forEach(f => console.error('  - ' + f));
  process.exit(1);
}
console.log(`✓ Все проверки пройдены: ${passed}`);
