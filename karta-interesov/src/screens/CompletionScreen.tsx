import { useState } from 'react';
import AppHeader from '../components/AppHeader';
import { IconAlert, IconCheck } from '../components/icons';

interface CompletionScreenProps {
  /** Номер завершённого круга: 1 — основной, 2+ — повторное прохождение пропусков. */
  round: number;
  answeredCount: number;
  missingCount: number;
  total: number;
  onViewResults: () => void;
  onRetryMissing: () => void;
  /** Идёт запрос к серверу (начало повторного круга): кнопки заблокированы. */
  busy?: boolean;
  /** Ошибка запроса к серверу. */
  error?: string | null;
}

/**
 * Конец круга. Кнопка «Показать результат» проверяет все вопросы:
 * если пропуски есть — показывает их количество и предлагает пройти только их.
 * Результат без ответов на все вопросы получить нельзя.
 */
export default function CompletionScreen({ round, answeredCount, missingCount, total, onViewResults, onRetryMissing, busy, error }: CompletionScreenProps) {
  const [checked, setChecked] = useState(round > 1);
  const complete = missingCount === 0;
  const blocked = checked && !complete;

  function handleShow() {
    if (complete) onViewResults();
    else setChecked(true);
  }

  return (
    <div className="shell">
      <AppHeader />
      <main className="center-stage">
        <div className="card stage-card">
          <div className={`stage-icon${blocked ? ' stage-icon--amber' : ''}`}>
            {blocked ? <IconAlert size={30} /> : <IconCheck size={30} />}
          </div>

          <h1 className="h2">
            {complete
              ? 'Все вопросы пройдены'
              : round > 1
                ? 'Повторный круг завершён'
                : 'Вы дошли до конца теста'}
          </h1>
          <p className="muted" style={{ marginTop: 10 }}>
            {complete
              ? 'Ответы на все вопросы получены. Можно открывать карту интересов.'
              : blocked || round > 1
                ? 'Часть вопросов всё ещё без ответа.'
                : 'Проверим, на все ли вопросы есть ответы.'}
          </p>

          <div className="tiles">
            <div className="tile">
              <div className="tile__num">{answeredCount}</div>
              <div className="tile__label">отвечено из {total}</div>
            </div>
            <div className={`tile${missingCount > 0 ? ' tile--amber' : ''}`}>
              <div className="tile__num">{missingCount}</div>
              <div className="tile__label">пропущено</div>
            </div>
          </div>

          {blocked && (
            <div className="panel" role="alert">
              Осталось пропущенных вопросов: <strong>{missingCount}</strong>. Результат доступен только после ответа на все вопросы.
              Пройдите только их — на каждый снова даётся 15 секунд. Если время выйдет, вопрос останется пропущенным, и повторить круг можно ещё раз.
            </div>
          )}

          {error && (
            <div className="notice notice--amber" role="alert" style={{ marginTop: 16 }}>
              <IconAlert size={18} />
              {error}
            </div>
          )}

          <div className="stack">
            {blocked ? (
              <button type="button" className="btn btn--accent btn--block" onClick={onRetryMissing} disabled={busy}>
                Пройти пропущенные вопросы ({missingCount})
              </button>
            ) : (
              <button type="button" className="btn btn--primary btn--block" onClick={handleShow} disabled={busy}>
                Показать результат
              </button>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
