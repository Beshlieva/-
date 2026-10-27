/**
 * Проверка клиентского потока «сервер ведёт попытку» (режим api) без браузера, PHP и MySQL.
 *
 * Используется ИМИТАЦИЯ сервера (FakeServer): она повторяет правила backend/src/Services/AttemptService.php
 * (серверное время открытия вопроса, окно 15 с + допуск, пропуски, повторные круги, идемпотентные повторы,
 * однократное сохранение результата). Это проверка КЛИЕНТА (src/lib/serverAttempt.ts, services/api/attemptService.ts)
 * и согласованности контракта. Реальный PHP и MySQL здесь НЕ запускаются — их нужно проверить отдельно
 * (см. backend/README.md, раздел «Проверка потока»).
 *
 * Запуск: npm run verify:server
 */
import { QUESTIONS, CATEGORIES, calculateResults, toDisplay } from '../src/data/questions';
import { ApiError, TEST_VERSION } from '../src/types';
import type { ServerAttemptState, TestResult } from '../src/types';
import { AttemptController } from '../src/lib/serverAttempt';
import type { AttemptService, StepOutcome } from '../src/services/api/attemptService';
import { parseAttemptState } from '../src/services/api/validators';
import { QUESTION_TIME_MS } from '../src/lib/testSession';

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, extra = '') {
  if (cond) passed++;
  else failures.push(`${name}${extra ? ' — ' + extra : ''}`);
}

const GRACE = 1000;
const TOLERANCE = 1000;
const TOTAL = QUESTIONS.length;

// ───────────── Общие часы теста (один источник времени для «сервера» и «браузера») ─────────────
let NOW = 1_800_000_000_000;
const clock = () => NOW;

function httpError(status: number, code: string, details?: unknown): ApiError {
  return new ApiError(status === 404 ? 'NOT_FOUND' : 'HTTP', code, status, { error: { code, message: code, details } });
}

interface Row { status: 'answered' | 'skipped'; value: number | null; lastRound: number }
interface Attempt {
  id: string; clientId: string; status: 'in_progress' | 'completed'; round: number;
  currentQ: number | null; openedAt: number | null; rows: Map<number, Row>;
  resultRows: number; // сколько раз «записан» результат (должен быть 0 или 1 раз по 29 строк)
  result: TestResult | null;
}

class FakeServer implements AttemptService {
  readonly enabled = true;
  attempts = new Map<string, Attempt>();
  log: string[] = [];
  nextId = 1;
  latency = 0;
  failNext: string | null = null; // имитация обрыва связи

  private async net() {
    if (this.latency) NOW += this.latency; // запрос идёт «туда»
    if (this.failNext) {
      const f = this.failNext; this.failNext = null;
      throw new ApiError('NETWORK', f);
    }
  }
  private back() { if (this.latency) NOW += this.latency; }

  private openNext(a: Attempt) {
    let next: number | null = null;
    if (a.round === 1) {
      for (const q of QUESTIONS) if (!a.rows.has(q.id)) { next = q.id; break; }
    } else {
      const pending = [...a.rows.entries()].filter(([, r]) => r.status === 'skipped' && r.lastRound < a.round).map(([id]) => id).sort((x, y) => x - y);
      next = pending.length ? pending[0] : null;
    }
    a.currentQ = next; a.openedAt = next === null ? null : NOW;
  }
  private skipRow(a: Attempt) {
    a.rows.set(a.currentQ!, { status: 'skipped', value: null, lastRound: a.round });
    this.openNext(a);
  }
  /** Как AttemptService::reconcile: давно истёкший вопрос пропускается, следующий открывается «сейчас». */
  private reconcile(a: Attempt) {
    if (a.status === 'in_progress' && a.currentQ !== null && NOW - a.openedAt! >= QUESTION_TIME_MS + GRACE) this.skipRow(a);
  }
  private state(a: Attempt): ServerAttemptState {
    const answers = [...a.rows.entries()].filter(([, r]) => r.status === 'answered').sort((x, y) => x[0] - y[0]).map(([questionId, r]) => ({ questionId, value: r.value as -2 }));
    const skipped = [...a.rows.entries()].filter(([, r]) => r.status === 'skipped').map(([id]) => id).sort((x, y) => x - y);
    const cur = a.currentQ === null ? null : {
      questionId: a.currentQ, openedAt: new Date(a.openedAt!).toISOString(),
      deadlineAt: new Date(a.openedAt! + QUESTION_TIME_MS).toISOString(), timeLimitMs: QUESTION_TIME_MS,
      remainingMs: Math.max(0, Math.min(QUESTION_TIME_MS, a.openedAt! + QUESTION_TIME_MS - NOW)),
    };
    const done = [...a.rows.values()].filter(r => r.lastRound === a.round).length;
    const pending = [...a.rows.values()].filter(r => r.status === 'skipped' && r.lastRound < a.round).length;
    const size = a.round === 1 ? TOTAL : done + pending;
    // Через JSON, как по сети — заодно проверяется parseAttemptState
    return parseAttemptState(JSON.parse(JSON.stringify({
      attemptId: a.id, clientAttemptId: a.clientId, testVersion: TEST_VERSION, status: a.status, round: a.round,
      totalQuestions: TOTAL, answeredCount: answers.length, skippedCount: skipped.length,
      roundFinished: a.status === 'in_progress' && cur === null, canFinish: a.status === 'in_progress' && answers.length === TOTAL,
      currentQuestion: cur, answers, skippedQuestionIds: skipped,
      roundProgress: a.status === 'in_progress' ? { position: Math.min(size, cur ? done + 1 : size), size } : null,
      startedAt: new Date(0).toISOString(), completedAt: null,
    })));
  }
  private own(id: string): Attempt {
    const a = this.attempts.get(id);
    if (!a) throw httpError(404, 'ATTEMPT_NOT_FOUND');
    return a;
  }

  async start(_t: string, clientAttemptId: string) {
    await this.net();
    this.log.push('POST /attempts');
    let a = [...this.attempts.values()].find(x => x.clientId === clientAttemptId);
    if (!a) {
      a = { id: String(this.nextId++), clientId: clientAttemptId, status: 'in_progress', round: 1, currentQ: null, openedAt: null, rows: new Map(), resultRows: 0, result: null };
      this.attempts.set(a.id, a);
      this.openNext(a);
    }
    const s = this.state(a); this.back(); return s;
  }
  async active() {
    await this.net();
    const a = [...this.attempts.values()].filter(x => x.status === 'in_progress').pop();
    if (!a) { this.back(); return null; }
    this.reconcile(a); const s = this.state(a); this.back(); return s;
  }
  async get(_t: string, id: string) {
    await this.net();
    const a = this.attempts.get(id);
    if (!a) { this.back(); return null; }
    this.log.push(`GET /attempts/${id}`);
    this.reconcile(a); const s = this.state(a); this.back(); return s;
  }
  async answer(_t: string, id: string, questionId: number, value: number): Promise<StepOutcome> {
    await this.net();
    const a = this.own(id);
    this.log.push(`POST answers q${questionId}=${value}`);
    if (a.status !== 'in_progress') throw httpError(409, 'ATTEMPT_COMPLETED');
    const ex = a.rows.get(questionId);
    if (ex && ex.status === 'answered') {
      if (ex.value === value) { const s = this.state(a); this.back(); return { kind: 'ok', state: s, duplicate: true }; }
      throw httpError(409, 'ANSWER_ALREADY_FIXED');
    }
    if (a.currentQ !== questionId) throw httpError(409, 'NOT_CURRENT_QUESTION');
    if (NOW - a.openedAt! > QUESTION_TIME_MS + GRACE) {
      this.skipRow(a); const s = this.state(a); this.back();
      return { kind: 'expired', state: s };
    }
    a.rows.set(questionId, { status: 'answered', value, lastRound: a.round });
    this.openNext(a);
    const s = this.state(a); this.back(); return { kind: 'ok', state: s, duplicate: false };
  }
  async skip(_t: string, id: string, questionId: number): Promise<StepOutcome> {
    await this.net();
    const a = this.own(id);
    this.log.push(`POST skips q${questionId}`);
    if (a.status !== 'in_progress') throw httpError(409, 'ATTEMPT_COMPLETED');
    const ex = a.rows.get(questionId);
    if (ex?.status === 'answered') throw httpError(409, 'ANSWER_ALREADY_FIXED');
    if (ex && ex.lastRound === a.round && a.currentQ !== questionId) { const s = this.state(a); this.back(); return { kind: 'ok', state: s, duplicate: true }; }
    if (a.currentQ !== questionId) throw httpError(409, 'NOT_CURRENT_QUESTION');
    const elapsed = NOW - a.openedAt!;
    if (elapsed < QUESTION_TIME_MS - TOLERANCE) throw httpError(409, 'TOO_EARLY', { remainingMs: QUESTION_TIME_MS - elapsed });
    this.skipRow(a); const s = this.state(a); this.back(); return { kind: 'ok', state: s, duplicate: false };
  }
  async retryRound(_t: string, id: string, fromRound: number) {
    await this.net();
    const a = this.own(id);
    this.log.push(`POST retry-round from ${fromRound}`);
    if (a.round === fromRound + 1) { const s = this.state(a); this.back(); return s; }
    if (a.round !== fromRound) throw httpError(409, 'ROUND_MISMATCH');
    if (a.currentQ !== null) throw httpError(409, 'ROUND_NOT_FINISHED');
    if (![...a.rows.values()].some(r => r.status === 'skipped')) throw httpError(409, 'NO_SKIPPED_QUESTIONS');
    a.round += 1; this.openNext(a);
    const s = this.state(a); this.back(); return s;
  }
  async finish(_t: string, id: string): Promise<TestResult> {
    await this.net();
    const a = this.own(id);
    this.log.push('POST finish');
    if (a.result) { this.back(); return a.result; }
    this.reconcile(a);
    const answered = [...a.rows.values()].filter(r => r.status === 'answered').length;
    if (answered < TOTAL) throw httpError(409, 'ATTEMPT_INCOMPLETE');
    const map: Record<number, number> = {};
    for (const [qid, r] of a.rows) map[qid] = r.value as number;
    const raw = calculateResults(map);
    a.result = {
      attemptId: a.id, testVersion: TEST_VERSION, answeredCount: answered, calculatedAt: new Date(NOW).toISOString(),
      source: 'server', persisted: true,
      scores: CATEGORIES.map(c => ({ categoryId: c.id, rawScore: raw[c.id], displayScore: toDisplay(raw[c.id]) })),
    };
    a.resultRows += CATEGORIES.length; a.status = 'completed'; a.currentQ = null; a.openedAt = null;
    this.back(); return a.result;
  }
  async result(_t: string, id: string): Promise<TestResult> {
    const a = this.own(id);
    if (!a.result) throw httpError(409, 'ATTEMPT_NOT_COMPLETED');
    return a.result;
  }
}

function makeController(server: FakeServer) {
  let n = 0;
  return new AttemptController({
    service: server, token: 'x'.repeat(64), clock, newId: () => `client-attempt-${++n}-abcdefgh`,
    describe: e => (e instanceof ApiError ? e.message : 'ошибка'), retryDelayMs: 2000,
  });
}
/** «Человеческая» задержка перед ответом: больше защиты от двойного клика (250 мс). */
const HUMAN = 400;

async function main() {
  // ───────── 1. Начало попытки ─────────
  const srv = new FakeServer();
  let c = makeController(srv);
  const st0 = await c.begin();
  check('начало: создана серверная попытка', st0 !== null && srv.attempts.size === 1 && srv.log[0] === 'POST /attempts', srv.log.join('|'));
  check('начало: открыт вопрос 1 и deadline = +15 с', c.snapshot.state?.currentQuestion?.questionId === 1 && c.snapshot.deadline === NOW + QUESTION_TIME_MS);
  check('начало: клиент не отправляет пакет answers (в логе только POST /attempts без ответов)', !srv.log.some(l => l.includes('answers q')));

  // ───────── 2. Ответ и следующий вопрос ─────────
  NOW += HUMAN;
  const sent = await c.answer(1, 2);
  check('ответ: отправлен и сохранён на сервере', sent && srv.attempts.get('1')!.rows.get(1)?.value === 2);
  check('ответ: открыт вопрос 2 с новым дедлайном', c.snapshot.state?.currentQuestion?.questionId === 2 && c.snapshot.deadline === NOW + QUESTION_TIME_MS);
  check('ответ: в состоянии 1 ответ', c.snapshot.state?.answeredCount === 1);

  // защита от двойного клика: ответ сразу после появления вопроса не уходит
  NOW += 50;
  const dbl = await c.answer(2, 1);
  check('двойной клик: ответ в первые 250 мс игнорируется', dbl === false && srv.attempts.get('1')!.rows.get(2) === undefined);
  // ответ на «чужой» вопрос
  NOW += HUMAN;
  check('ответ на не текущий вопрос не отправляется', (await c.answer(5, 1)) === false);

  // ───────── 3. Повтор запроса (идемпотентность) ─────────
  const dup = await srv.answer('x', '1', 1, 2);
  check('сервер: тот же ответ повторно = duplicate, без изменений', dup.kind === 'ok' && dup.duplicate && srv.attempts.get('1')!.rows.size === 1);
  let fixed = '';
  try { await srv.answer('x', '1', 1, -2); } catch (e) { fixed = (e as ApiError).message; }
  check('сервер: другое значение для отвеченного вопроса отклоняется', fixed === 'ANSWER_ALREADY_FIXED');

  // ───────── 4. Истечение 15 секунд → автопропуск ─────────
  const q2 = c.snapshot.state!.currentQuestion!.questionId;
  NOW = c.snapshot.deadline! - 1;
  check('до 15 с пропуск не отправляется', (await c.expire(q2)) === false);
  NOW = c.snapshot.deadline!;
  check('в момент 15 с пропуск отправлен', await c.expire(q2));
  check('пропуск: вопрос 2 помечен skipped (не 0) и открыт вопрос 3', srv.attempts.get('1')!.rows.get(2)?.status === 'skipped' && srv.attempts.get('1')!.rows.get(2)?.value === null && c.snapshot.state?.currentQuestion?.questionId === 3);
  check('пропуск: показана плашка «время вышло» для вопроса 2', c.snapshot.lastExpiredId === 2);
  check('пропуск: в ответах нет вопроса 2', !c.snapshot.state!.answers.some(a => a.questionId === 2) && c.snapshot.state!.skippedQuestionIds.includes(2));

  // ───────── 5. Просроченный ответ отклоняется сервером ─────────
  // клиент-«обманщик» шлёт ответ напрямую после окончания окна (15 с + допуск)
  const a1 = srv.attempts.get('1')!;
  NOW = a1.openedAt! + QUESTION_TIME_MS + GRACE + 50;
  let late: StepOutcome | null = null;
  late = await srv.answer('x', '1', 3, 2);
  check('просрочка: сервер вернул expired и не принял ответ', late.kind === 'expired' && a1.rows.get(3)?.status === 'skipped' && a1.rows.get(3)?.value === null);
  check('просрочка: сервер уже открыл вопрос 4 (не продлил вопрос 3)', late.state.currentQuestion?.questionId === 4);
  // повторная отправка того же просроченного ответа не даёт дополнительного времени
  let again = '';
  try { await srv.answer('x', '1', 3, 2); } catch (e) { again = (e as ApiError).message; }
  check('просрочка: повтор запроса не принимается (вопрос уже не текущий)', again === 'NOT_CURRENT_QUESTION');
  // клиентский контроллер не отправляет просроченный ответ вообще
  c = makeController(srv);
  await c.restore('1');
  NOW = c.snapshot.deadline! + 10;
  const before = srv.log.length;
  const lateSent = await c.answer(c.snapshot.state!.currentQuestion!.questionId, 1);
  check('клиент: просроченный ответ не отправляется и запроса answers нет', lateSent === false && !srv.log.slice(before).some(l => l.includes('answers')));

  // ───────── 6. Обновление страницы ─────────
  const s6 = new FakeServer(); let p = makeController(s6);
  await p.begin(); NOW += HUMAN; await p.answer(1, 1); NOW += HUMAN; await p.answer(2, -1);
  NOW += 6000; // на вопросе 3 прошло 6 с
  const openedAtBefore = s6.attempts.get('1')!.openedAt!;
  const left = p.snapshot.state!.currentQuestion!.questionId;
  const reload = makeController(s6); // «новая страница»: новый клиент, состояние только с сервера
  const restored = await reload.restore('1');
  check('обновление: восстановлена та же попытка и вопрос', restored?.attemptId === '1' && restored.currentQuestion?.questionId === left);
  check('обновление: оставшееся время не сброшено (≈9 с, а не 15)', Math.abs((reload.snapshot.deadline! - NOW) - 9000) < 5, String(reload.snapshot.deadline! - NOW));
  check('обновление: сервер не переоткрыл вопрос', s6.attempts.get('1')!.openedAt === openedAtBefore);
  check('обновление: ответы не потеряны и не продублированы', restored!.answers.length === 2 && s6.attempts.get('1')!.rows.size === 2);
  for (let i = 0; i < 3; i++) await makeController(s6).restore('1');
  check('многократное обновление не продлевает время вопроса', s6.attempts.get('1')!.openedAt === openedAtBefore);
  // восстановление без ссылки: по последней незавершённой попытке
  const viaActive = await makeController(s6).restore(null);
  check('обновление без ссылки: найдена незавершённая попытка (active)', viaActive?.attemptId === '1');
  // страница закрыта дольше 15 секунд
  NOW += 20_000;
  const late6 = makeController(s6); const rs = await late6.restore('1');
  check('закрыли страницу > 15 с: вопрос пропущен сервером, открыт следующий со свежими 15 с', rs?.currentQuestion?.questionId === left + 1 && s6.attempts.get('1')!.rows.get(left)?.status === 'skipped' && Math.abs((late6.snapshot.deadline! - NOW) - QUESTION_TIME_MS) < 5);

  // ───────── 7. Задержка сети: часы сервера и клиента не расходятся ─────────
  const s7 = new FakeServer(); s7.latency = 300; const k = makeController(s7);
  await k.begin();
  const rem = k.snapshot.deadline! - NOW;
  check('задержка сети: локальный остаток не больше серверного (≤ 15 с)', rem <= QUESTION_TIME_MS && rem >= QUESTION_TIME_MS - 700, String(rem));

  // ───────── 8. Сетевая ошибка при ответе ─────────
  const s8 = new FakeServer(); const n8 = makeController(s8);
  await n8.begin(); NOW += HUMAN; s8.failNext = 'Нет связи';
  await n8.answer(1, 2);
  check('сеть: ошибка показана, ответ не потерян из виду, вопрос остался текущим', n8.snapshot.error !== null && n8.snapshot.state?.currentQuestion?.questionId === 1 && !n8.snapshot.busy);
  NOW += 100; await n8.answer(1, 2);
  check('сеть: повторное нажатие сохраняет ответ', s8.attempts.get('1')!.rows.get(1)?.value === 2 && n8.snapshot.error === null);

  // ───────── 9. Полный проход: пропуски, повторный круг, завершение ─────────
  const s9 = new FakeServer(); const f = makeController(s9);
  await f.begin();
  const SKIP = new Set([10, 20, 30]);
  let guard = 0;
  while (!f.snapshot.state!.roundFinished && guard++ < 400) {
    const q = f.snapshot.state!.currentQuestion!.questionId;
    if (SKIP.has(q)) { NOW = f.snapshot.deadline!; await f.expire(q); }
    else { NOW += HUMAN; await f.answer(q, (q % 5) - 2); }
  }
  const s = f.snapshot.state!;
  check('круг 1 завершён: 171 ответ и 3 пропуска', s.roundFinished && s.answeredCount === 171 && s.skippedCount === 3 && !s.canFinish);
  let tooSoon = '';
  try { await s9.finish('x', '1'); } catch (e) { tooSoon = (e as ApiError).message; }
  check('завершение с пропусками отклоняется (результата нет)', tooSoon === 'ATTEMPT_INCOMPLETE' && s9.attempts.get('1')!.resultRows === 0);
  check('повторный круг начат', await f.retryRound() && f.snapshot.state!.round === 2 && f.snapshot.state!.currentQuestion?.questionId === 10);
  check('повтор: подпись «1 из 3»', f.snapshot.state!.roundProgress?.position === 1 && f.snapshot.state!.roundProgress?.size === 3);
  NOW += HUMAN; await f.answer(10, 2);
  check('повтор: пропущенный вопрос стал отвеченным, подпись «2 из 3»', s9.attempts.get('1')!.rows.get(10)?.status === 'answered' && f.snapshot.state!.roundProgress?.position === 2 && f.snapshot.state!.roundProgress?.size === 3, JSON.stringify(f.snapshot.state!.roundProgress));
  NOW = f.snapshot.deadline!; await f.expire(20);
  check('повтор: вопрос 20 снова пропущен, открыт 30', s9.attempts.get('1')!.rows.get(20)?.status === 'skipped' && f.snapshot.state!.currentQuestion?.questionId === 30);
  NOW += HUMAN; await f.answer(30, -2);
  check('повтор: круг 2 закончен, остался 1 пропуск', f.snapshot.state!.roundFinished && f.snapshot.state!.skippedCount === 1);
  check('повтор: круг 3 только по вопросу 20', await f.retryRound() && f.snapshot.state!.round === 3 && f.snapshot.state!.currentQuestion?.questionId === 20);
  const rr = await s9.retryRound('x', '1', 2);
  check('retry-round идемпотентен: повтор запроса не открывает ещё один круг', rr.round === 3);
  NOW += HUMAN; await f.answer(20, 1);
  check('все 174 ответа на сервере, можно завершать', f.snapshot.state!.answeredCount === TOTAL && f.snapshot.state!.canFinish && f.snapshot.state!.roundFinished);

  // ───────── 10. Завершение и результат ─────────
  const r1 = await s9.finish('x', '1');
  const r2 = await s9.finish('x', '1');
  const r3 = await s9.finish('x', '1');
  check('результат сохранён на сервере один раз (29 строк), повторы — тот же результат', s9.attempts.get('1')!.resultRows === 29 && r1 === r2 && r2 === r3);
  const mapAll: Record<number, number> = {};
  for (const [qid, r] of s9.attempts.get('1')!.rows) mapAll[qid] = r.value as number;
  const expected = calculateResults(mapAll);
  check('баллы по всем 29 направлениям совпадают с calculateResults', r1.scores.length === 29 && r1.scores.every(sc => sc.rawScore === expected[sc.categoryId] && sc.displayScore === toDisplay(expected[sc.categoryId])));
  check('результат помечен как сохранённый на сервере', r1.source === 'server' && r1.persisted === true && r1.answeredCount === TOTAL);
  // после завершения: обновление страницы возвращает завершённую попытку, ответы не принимаются
  const after = makeController(s9); const ra = await after.restore('1');
  check('после завершения: восстановление показывает status=completed', ra?.status === 'completed');
  let closed = '';
  try { await s9.answer('x', '1', 1, 2); } catch (e) { closed = (e as ApiError).message; }
  check('после завершения ответы не принимаются', closed === 'ANSWER_ALREADY_FIXED' || closed === 'ATTEMPT_COMPLETED', closed);
  check('пакетный запрос не использовался за весь поток', !s9.log.some(l => l.includes('batch') || l.includes('BATCH')));

  // ───────── 11. Разбор состояния сервера ─────────
  let badShape = false;
  try { parseAttemptState({ status: 'weird' }); } catch { badShape = true; }
  check('parseAttemptState отклоняет некорректное состояние', badShape);

  if (failures.length) {
    console.error(`\n✗ Провалено проверок: ${failures.length}`);
    failures.forEach(x => console.error('  - ' + x));
    process.exit(1);
  }
  console.log(`✓ Поток серверной попытки (на имитации сервера): пройдено ${passed} проверок`);
}

void main();
