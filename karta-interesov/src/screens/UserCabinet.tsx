import { useEffect, useState } from 'react';
import AppHeader, { AppFooter } from '../components/AppHeader';
import { CATEGORIES } from '../data/questions';
import { REGIONS } from '../data/regions';
import { attemptService, describeError } from '../services/api';
import type { AuthUser, UserTestResult } from '../types';

interface UserCabinetProps {
  user: AuthUser;
  token: string;
  onBack: () => void;
  onStart: () => void;
  onLogout: () => void;
}

type HistoryState =
  | { status: 'loading' }
  | { status: 'ready'; items: UserTestResult[]; page: number; pageSize: number; total: number }
  | { status: 'error'; message: string };

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Дата не указана'
    : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

function categoryName(id: number): string {
  return CATEGORIES.find(category => category.id === id)?.name ?? `Направление ${id}`;
}

export default function UserCabinet({ user, token, onBack, onStart, onLogout }: UserCabinetProps) {
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<HistoryState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    attemptService.resultsHistory(token, page, { signal: controller.signal })
      .then(history => {
        if (!controller.signal.aborted) {
          setState({ status: 'ready', ...history });
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState({ status: 'error', message: describeError(error) });
      });
    return () => controller.abort();
  }, [token, page, retry]);

  const region = REGIONS.find(item => item.code === user.regionCode)?.name ?? user.regionCode;

  return (
    <div className="shell">
      <AppHeader
        right={(
          <nav className="topbar__user" aria-label="Личный кабинет">
            <button type="button" className="link-btn" onClick={onBack}>На главную</button>
            <button type="button" className="link-btn" onClick={onLogout}>Выйти</button>
          </nav>
        )}
      />
      <main className="page">
        <div className="container container--narrow">
          <p className="story-hero__eyebrow"><span />ВАШ ПРОФИЛЬ</p>
          <h1 className="h2" style={{ marginTop: 8 }}>Личный кабинет</h1>
          <p className="lead" style={{ marginTop: 8, marginBottom: 24 }}>
            Здесь хранятся данные учётной записи и результаты тестов, сохранённые в базе.
          </p>

          <section className="panel-card" aria-labelledby="cabinet-profile-title">
            <h2 id="cabinet-profile-title" className="h3" style={{ marginBottom: 18 }}>Данные участника</h2>
            <dl className="cabinet-profile">
              <div><dt>Email</dt><dd>{user.email}</dd></div>
              <div><dt>Имя</dt><dd>{user.displayName || 'Не указано'}</dd></div>
              <div><dt>Возраст</dt><dd>{user.age === null ? 'Не указан' : `${user.age} лет`}</dd></div>
              <div><dt>Регион</dt><dd>{region || 'Не указан'}</dd></div>
              <div><dt>Дата регистрации</dt><dd>{formatDate(user.createdAt)}</dd></div>
            </dl>
          </section>

          <section aria-labelledby="cabinet-results-title" style={{ marginTop: 30 }}>
            <div className="cabinet-section-heading">
              <div>
                <h2 id="cabinet-results-title" className="h3">Мои результаты</h2>
                <p className="small muted" style={{ marginTop: 5 }}>История загружается из вашей учётной записи в MySQL.</p>
              </div>
              <button type="button" className="btn btn--primary" onClick={onStart}>Начать тест</button>
            </div>

            {state.status === 'loading' && <p className="muted" role="status">Загружаем историю результатов…</p>}
            {state.status === 'error' && (
              <div className="panel-card" role="alert">
                <p className="muted">{state.message}</p>
                <button type="button" className="btn btn--ghost" style={{ marginTop: 14 }} onClick={() => setRetry(value => value + 1)}>
                  Повторить загрузку
                </button>
              </div>
            )}
            {state.status === 'ready' && state.total === 0 && (
              <div className="panel-card cabinet-empty">
                <h3 className="h3">Вы ещё не проходили тест</h3>
                <p className="muted" style={{ margin: '8px 0 18px' }}>
                  После завершения теста здесь появятся сохранённые направления интересов и подробные баллы.
                </p>
                <button type="button" className="btn btn--primary" onClick={onStart}>Перейти к тестированию</button>
              </div>
            )}
            {state.status === 'ready' && state.items.length > 0 && (
              <>
                <p className="small muted" style={{ margin: '12px 0' }}>
                  Прохождений: {state.total}. Сначала показаны последние.
                </p>
                <div className="cabinet-history">
                  {state.items.map((result, index) => (
                    <details className="panel-card cabinet-result" key={result.attemptId}>
                      <summary>
                        <span>
                          <strong>Прохождение {state.total - ((state.page - 1) * state.pageSize + index)}</strong>
                          <small>{formatDate(result.completedAt)}</small>
                        </span>
                        <span className="chip chip--teal">Сохранён · {result.answeredCount}/174</span>
                      </summary>
                      <div className="cabinet-result__body">
                        <h3 className="h3">Наиболее выраженные направления</h3>
                        <ol className="cabinet-top">
                          {result.topCategoryIds.map((id, rank) => {
                            const score = result.scores.find(item => item.categoryId === id);
                            return (
                              <li key={id}>
                                <span>{rank + 1}. {categoryName(id)}</span>
                                <strong>{score?.displayScore ?? 0}%</strong>
                              </li>
                            );
                          })}
                        </ol>
                        <details className="cabinet-all-scores">
                          <summary>Подробная расшифровка по всем направлениям</summary>
                          <ol>
                            {result.scores
                              .slice()
                              .sort((a, b) => b.displayScore - a.displayScore || a.categoryId - b.categoryId)
                              .map(score => (
                                <li key={score.categoryId}>
                                  <span>{categoryName(score.categoryId)}</span>
                                  <strong>{score.displayScore}% <small>({score.rawScore > 0 ? '+' : ''}{score.rawScore} балл.)</small></strong>
                                </li>
                              ))}
                          </ol>
                        </details>
                      </div>
                    </details>
                  ))}
                </div>
                <div className="cabinet-pagination">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={state.page <= 1}
                    onClick={() => setPage(value => value - 1)}
                  >
                    Предыдущие
                  </button>
                  <span className="small muted">Страница {state.page} из {Math.max(1, Math.ceil(state.total / state.pageSize))}</span>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={state.page * state.pageSize >= state.total}
                    onClick={() => setPage(value => value + 1)}
                  >
                    Следующие
                  </button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
