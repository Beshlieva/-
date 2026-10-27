import AppHeader from '../components/AppHeader';
import { IconAlert } from '../components/icons';

interface AttemptStatusScreenProps {
  /** loading — ждём ответ сервера; error — запрос не удался. */
  status: 'loading' | 'error';
  message?: string | null;
  onRetry?: () => void;
  onBack?: () => void;
}

/** Экран ожидания и ошибки связи с сервером при начале или восстановлении попытки. Стили — те же, что у ResultsGate. */
export default function AttemptStatusScreen({ status, message, onRetry, onBack }: AttemptStatusScreenProps) {
  return (
    <div className="shell">
      <AppHeader />
      <main className="center-stage">
        <div className="card stage-card">
          {status === 'loading' ? (
            <>
              <div className="spinner" role="status" aria-label="Загрузка" />
              <p className="muted">Связываемся с сервером…</p>
            </>
          ) : (
            <>
              <div className="stage-icon stage-icon--danger"><IconAlert size={30} /></div>
              <h1 className="h2">Не удалось открыть тест</h1>
              <p className="muted" style={{ margin: '10px 0 24px' }}>{message ?? 'Произошла ошибка.'}</p>
              <div className="stack">
                {onRetry && (
                  <button type="button" className="btn btn--primary btn--block" onClick={onRetry}>Повторить</button>
                )}
                {onBack && (
                  <button type="button" className="btn btn--ghost btn--block" onClick={onBack}>На главную</button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
