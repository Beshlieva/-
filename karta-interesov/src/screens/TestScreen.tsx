import { useEffect, useRef, useState } from 'react';
import { QUESTIONS, ANSWER_OPTIONS, CATEGORIES } from '../data/questions';
import AppHeader from '../components/AppHeader';
import AnswerCard from '../components/AnswerCard';
import ProgressBar from '../components/ProgressBar';
import TimerRing from '../components/TimerRing';
import { IconAlert } from '../components/icons';
import { remainingUntil } from '../lib/testSession';
import type { TestView } from '../lib/testView';

interface TestScreenProps {
  view: TestView;
  onAnswer: (questionId: number, value: number) => void;
  onExpire: (questionId: number) => void;
}

/** Клавиши 1–5 → значение ответа (1 = «Очень нравится» … 5 = «Очень не нравится»). Учитываются и цифры на верхнем ряду, и на numpad. */
const HOTKEYS: Record<string, number> = {
  Digit1: 2, Numpad1: 2,
  Digit2: 1, Numpad2: 1,
  Digit3: 0, Numpad3: 0,
  Digit4: -1, Numpad4: -1,
  Digit5: -2, Numpad5: -2,
};

const TICK_MS = 100;

export default function TestScreen({ view, onAnswer, onExpire }: TestScreenProps) {
  const questionId = view.questionId;
  const deadline = view.deadline;
  const [now, setNow] = useState(() => Date.now());

  // Актуальные значения для обработчика клавиш — без повторной подписки на каждый рендер
  const live = useRef({ questionId, onAnswer });
  live.current = { questionId, onAnswer };

  // Таймер. Источник истины — deadline (timestamp окончания), а не число тиков:
  // интервал только обновляет картинку, а решение «время вышло» принимается по Date.now().
  // Эффект зависит от [вопрос, deadline], поэтому для одного вопроса всегда ровно один таймер:
  // при смене вопроса прежний очищается.
  useEffect(() => {
    if (questionId === null || deadline === null) return;
    let handle: number | undefined;
    let done = false;

    const tick = () => {
      if (done) return;
      const t = Date.now();
      setNow(t);
      if (t >= deadline) {
        done = true;
        onExpire(questionId);
        return;
      }
      handle = window.setTimeout(tick, Math.min(TICK_MS, deadline - t));
    };
    tick();

    // Фоновая вкладка замедляет таймеры — при возврате пересчитываем сразу
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !done) {
        window.clearTimeout(handle);
        tick();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      done = true;
      window.clearTimeout(handle);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // onExpire не включаем намеренно: он стабилен по смыслу, а пересоздание таймера из-за него недопустимо
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId, deadline]);

  // Горячие клавиши 1–5
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const value = HOTKEYS[e.code];
      if (value === undefined) return;
      const { questionId: id, onAnswer: answer } = live.current;
      if (id === null) return;
      e.preventDefault();
      answer(id, value);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Плашка «время вышло» скрывается сама через 4 секунды
  const [showExpired, setShowExpired] = useState(view.lastExpiredId !== null);
  useEffect(() => {
    if (view.lastExpiredId === null) {
      setShowExpired(false);
      return;
    }
    setShowExpired(true);
    const h = window.setTimeout(() => setShowExpired(false), 4000);
    return () => window.clearTimeout(h);
  }, [view.lastExpiredId, view.noticeKey]);

  if (questionId === null) return null; // круг закончен — App переключит экран

  const question = QUESTIONS.find(q => q.id === questionId)!;
  const category = CATEGORIES.find(c => c.id === question.categoryId)!;
  const total = view.total;
  const left = remainingUntil(deadline, now);
  const isRetry = view.round > 1;

  return (
    <div className="shell">
      <AppHeader
        sticky
        right={
          <span className="chip">
            {isRetry
              ? `Повтор пропусков · ${view.position} из ${view.queueSize}`
              : `Вопрос ${questionId} из ${total}`}
          </span>
        }
      />

      <div className="topbar" style={{ borderTop: 0 }}>
        <div className="topbar__inner" style={{ display: 'block' }}>
          <ProgressBar answered={view.answered} skipped={view.skipped} total={total} />
        </div>
      </div>

      <main className="test">
        <div className="container container--narrow">
          {view.error && (
            <div className="notice notice--amber" role="alert">
              <IconAlert size={18} />
              {view.error} Ответ мог не сохраниться — связь проверяется автоматически, можно нажать вариант ещё раз, пока идёт время.
            </div>
          )}
          {showExpired && view.lastExpiredId !== null && (
            <div className="notice notice--amber" role="status">
              <IconAlert size={18} />
              Время вышло — вопрос {view.lastExpiredId} пропущен. К пропущенным можно вернуться в конце теста.
            </div>
          )}

          <section className="card qcard" key={`${view.round}-${questionId}`} aria-labelledby="qtext">
            <div className="qcard__head">
              <div>
                <span className="qcard__cat">
                  <span className="ic" style={{ background: category.color + '1a' }} aria-hidden="true">{category.icon}</span>
                  {category.name}
                </span>
                {isRetry && (
                  <p className="small muted" style={{ marginTop: 8 }}>
                    Вопрос {questionId} из {total} · повторный круг
                  </p>
                )}
              </div>
              <TimerRing remainingMs={left} />
            </div>

            <h1 className="qtext" id="qtext">{question.text}</h1>

            <div className="answers">
              {ANSWER_OPTIONS.map((opt, i) => (
                <AnswerCard
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  hotkey={i + 1}
                  onClick={() => onAnswer(questionId, opt.value)}
                />
              ))}
            </div>
          </section>

          <p className="hotkeys">
            Клавиши <span className="kbd">1</span>–<span className="kbd">5</span> выбирают вариант ответа. Время идёт, даже если вкладка не активна.
          </p>
        </div>
      </main>
    </div>
  );
}
