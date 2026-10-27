import { useEffect, useRef, useState } from 'react';
import ResultsScreen from './ResultsScreen';
import AppHeader from '../components/AppHeader';
import { IconAlert } from '../components/icons';
import { describeError, scoresToRecord } from '../services/api';
import type { TestResult } from '../types';

interface ResultsGateProps {
  /**
   * Получить результат. В режиме api это POST /attempts/{id}/finish: сервер считает баллы, сохраняет их в MySQL
   * и при повторном вызове возвращает тот же результат (дубликатов нет). В демо-режиме — расчёт в браузере.
   */
  load: (signal: AbortSignal) => Promise<TestResult>;
  /**
   * Только для демо-режима: показать результат, посчитанный в браузере, если «сервера» нет.
   * В режиме api не передаётся — результат без сохранения на сервере не показывается.
   */
  localFallback?: () => TestResult;
  onRetake: () => void;
}

type GateState =
  | { status: 'loading' }
  | { status: 'ready'; result: TestResult }
  | { status: 'error'; message: string };

/**
 * Получает результат через API-слой и показывает ResultsScreen.
 * Состояния: загрузка → результат | ошибка (с повтором и показом результата без сохранения).
 * Вызывается только когда на все вопросы есть ответы (проверяет App).
 */
export default function ResultsGate({ load, localFallback, onRetake }: ResultsGateProps) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    loadRef.current(controller.signal)
      .then(result => {
        if (!controller.signal.aborted) setState({ status: 'ready', result });
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: describeError(err) });
      });

    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'ready') {
    const { result } = state;
    return (
      <ResultsScreen
        scores={scoresToRecord(result)}
        answeredCount={result.answeredCount}
        source={result.source}
        persisted={result.persisted}
        onRetake={onRetake}
      />
    );
  }

  return (
    <div className="shell">
      <AppHeader />
      <main className="center-stage">
        <div className="card stage-card">
          {state.status === 'loading' ? (
            <>
              <div className="spinner" role="status" aria-label="Загрузка" />
              <p className="muted">Готовим вашу карту интересов…</p>
            </>
          ) : (
            <>
              <div className="stage-icon stage-icon--danger"><IconAlert size={30} /></div>
              <h1 className="h2">Не удалось получить результат</h1>
              <p className="muted" style={{ margin: '10px 0 24px' }}>{state.message}</p>
              <div className="stack">
                <button type="button" className="btn btn--primary btn--block" onClick={() => setAttempt(n => n + 1)}>
                  Повторить
                </button>
                {localFallback && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--block"
                    onClick={() => setState({ status: 'ready', result: localFallback() })}
                  >
                    Показать результат без сохранения
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
