import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconAlert } from '../components/icons';
import { CATEGORIES } from '../data/questions';
import { REGIONS } from '../data/regions';
import { ApiError } from '../types';
import type {
  AdminFilters, AdminOverview, AdminResultDetail, AdminResultRow, AdminUserRow, AnalyticsSummary, Paginated, RegionAggregate,
} from '../types';
import { adminService, describeError } from '../services/api';

const PAGE_SIZE = 20;

const regionName = (code: string | null) => (code ? REGIONS.find(r => r.code === code)?.name ?? code : '—');
const categoryById = new Map(CATEGORIES.map(c => [c.id, c]));
const categoryName = (id: number) => categoryById.get(id)?.name ?? `Направление ${id}`;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

/** Загрузка данных с отменой устаревших запросов. 401 = сессия истекла → выход. */
function useAdminData<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[], onUnauthorized: () => void) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const loadRef = useRef(load);
  loadRef.current = load;
  const unauthorizedRef = useRef(onUnauthorized);
  unauthorizedRef.current = onUnauthorized;

  useEffect(() => {
    const controller = new AbortController();
    setState(prev => ({ ...prev, loading: true, error: null }));
    loadRef.current(controller.signal)
      .then(data => { if (!controller.signal.aborted) setState({ data, loading: false, error: null }); })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof ApiError && err.status === 401) { unauthorizedRef.current(); return; }
        setState({ data: null, loading: false, error: describeError(err) });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

interface Props {
  token: string;
  onLogout: (message?: string) => void;
}

export default function AdminDashboard({ token, onLogout }: Props) {
  const [draft, setDraft] = useState<AdminFilters>({});
  const [filters, setFilters] = useState<AdminFilters>({});
  const [tab, setTab] = useState<'users' | 'results'>('users');
  const [usersPage, setUsersPage] = useState(1);
  const [resultsPage, setResultsPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const expired = useCallback(() => onLogout('Сессия администратора истекла. Войдите снова.'), [onLogout]);
  const { regionCode, dateFrom, dateTo, q } = filters;
  const common = { regionCode, dateFrom, dateTo };

  const overview = useAdminData<AdminOverview>(
    signal => adminService.getOverview(common, { token, signal }), [token, regionCode, dateFrom, dateTo], expired);
  const summary = useAdminData<AnalyticsSummary>(
    signal => adminService.getSummary(common, { token, signal }), [token, regionCode, dateFrom, dateTo], expired);
  const regionStats = useAdminData<RegionAggregate[]>(
    signal => adminService.getRegionStats(common, { token, signal }), [token, regionCode, dateFrom, dateTo], expired);
  const users = useAdminData<Paginated<AdminUserRow>>(
    signal => adminService.listUsers({ ...common, q, page: usersPage, pageSize: PAGE_SIZE }, { token, signal }),
    [token, regionCode, dateFrom, dateTo, q, usersPage], expired);
  const results = useAdminData<Paginated<AdminResultRow>>(
    signal => adminService.listResults({ ...common, q, page: resultsPage, pageSize: PAGE_SIZE }, { token, signal }),
    [token, regionCode, dateFrom, dateTo, q, resultsPage], expired);

  function applyFilters(e: FormEvent) {
    e.preventDefault();
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) return;
    setFilters({ ...draft, q: draft.q?.trim() || undefined });
    setUsersPage(1);
    setResultsPage(1);
  }

  function resetFilters() {
    setDraft({});
    setFilters({});
    setUsersPage(1);
    setResultsPage(1);
  }

  async function handleExport() {
    setExporting(true);
    setExportError(null);
    try {
      const blob = await adminService.exportResultsCsv(filters, { token });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `karta-interesov-results-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expired();
      else setExportError(err instanceof ApiError && err.status === 422 ? err.message : describeError(err));
    } finally {
      setExporting(false);
    }
  }

  const rangeInvalid = Boolean(draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo);
  const filtersActive = Boolean(regionCode || dateFrom || dateTo || q);

  return (
    <div className="shell">
      <AppHeader
        sticky
        right={
          <span className="topbar__user">
            <strong>Администратор</strong>
            <button type="button" className="btn btn--ghost adm-btn-sm" onClick={() => onLogout()}>Выйти</button>
          </span>
        }
      />
      <main className="page">
        <div className="container">
          <h1 className="h2">Панель администратора</h1>
          <p className="lead" style={{ marginTop: 8, marginBottom: 24 }}>Участники и результаты теста. Все данные берутся из базы.</p>

          <form className="card adm-filters" onSubmit={applyFilters} aria-label="Фильтры">
            <div className="field adm-filters__q">
              <label className="field__label" htmlFor="adm-q">Поиск по имени и email</label>
              <input id="adm-q" className="input" type="search" maxLength={100} value={draft.q ?? ''}
                onChange={e => setDraft({ ...draft, q: e.target.value })} placeholder="Например, Анна или @mail.kz" />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="adm-region">Регион</label>
              <select id="adm-region" className="input" value={draft.regionCode ?? ''}
                onChange={e => setDraft({ ...draft, regionCode: e.target.value || undefined })}>
                <option value="">Все регионы</option>
                {REGIONS.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="adm-from">С даты</label>
              <input id="adm-from" className="input" type="date" value={draft.dateFrom ?? ''}
                onChange={e => setDraft({ ...draft, dateFrom: e.target.value || undefined })} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="adm-to">По дату</label>
              <input id="adm-to" className={`input${rangeInvalid ? ' input--error' : ''}`} type="date" value={draft.dateTo ?? ''}
                onChange={e => setDraft({ ...draft, dateTo: e.target.value || undefined })} />
              {rangeInvalid && <p className="field__error" role="alert">Конец периода раньше начала.</p>}
            </div>
            <div className="adm-filters__actions">
              <button type="submit" className="btn btn--primary" disabled={rangeInvalid}>Применить</button>
              <button type="button" className="btn btn--ghost" onClick={resetFilters} disabled={!filtersActive && !draft.q && !draft.regionCode && !draft.dateFrom && !draft.dateTo}>Сбросить</button>
            </div>
          </form>
          <p className="muted small adm-note">
            Регион и период применяются ко всей странице: участники — по дате регистрации, начатые попытки — по дате старта, завершённые — по дате завершения. Поиск действует на таблицы и экспорт.
          </p>

          <section aria-label="Сводка" className="adm-cards">
            <StatCard label="Зарегистрировано" value={overview} pick={o => o.totalUsers} />
            <StatCard label="Начато попыток" value={overview} pick={o => o.startedAttempts} />
            <StatCard label="Завершено тестов" value={overview} pick={o => o.completedAttempts} />
          </section>

          <section className="adm-grid" aria-label="Диаграммы">
            <div className="card card--pad">
              <h2 className="h3">Участники по регионам</h2>
              <Async state={overview} empty={d => d.usersByRegion.length === 0} emptyText="Пока нет зарегистрированных участников.">
                {d => {
                  const rows = [...d.usersByRegion].sort((a, b) => b.users - a.users);
                  const max = Math.max(...rows.map(r => r.users));
                  return <Bars rows={rows.map(r => ({ key: r.regionCode, label: regionName(r.regionCode), value: r.users, max, suffix: '' }))} />;
                }}
              </Async>
            </div>
            <div className="card card--pad">
              <h2 className="h3">Популярные направления</h2>
              <p className="muted small">Сколько раз направление попадало в топ-5 завершённых тестов.</p>
              <Async state={summary} empty={d => d.totalAttempts === 0} emptyText="Пока нет завершённых тестов.">
                {d => {
                  const rows = [...d.categories].filter(c => c.timesInTop5 > 0).sort((a, b) => b.timesInTop5 - a.timesInTop5 || a.categoryId - b.categoryId).slice(0, 10);
                  const max = Math.max(...rows.map(r => r.timesInTop5));
                  return (
                    <Bars rows={rows.map(r => ({
                      key: String(r.categoryId), label: categoryName(r.categoryId), value: r.timesInTop5, max,
                      color: categoryById.get(r.categoryId)?.color, suffix: ` · ${Math.round((r.timesInTop5 / d.totalAttempts) * 100)}% тестов`,
                    }))} />
                  );
                }}
              </Async>
            </div>
          </section>

          <section className="card adm-tables" aria-label="Лучшее направление по регионам">
            <div className="adm-tables__head">
              <div>
                <h2 className="h3">Самое сильное направление в каждом регионе</h2>
                <p className="muted small">Одно направление с наибольшим средним баллом по завершённым тестам региона.</p>
              </div>
            </div>
            <Async state={regionStats} empty={rows => rows.length === 0} emptyText="Пока нет завершённых тестов с указанным регионом.">
              {rows => {
                const ranked = [...rows]
                  .map(region => {
                    const best = [...region.categories].sort(
                      (a, b) => b.averageDisplayScore - a.averageDisplayScore || a.categoryId - b.categoryId,
                    )[0];
                    return best ? { ...region, best } : null;
                  })
                  .filter((region): region is NonNullable<typeof region> => region !== null && region.attempts > 0)
                  .sort((a, b) => b.attempts - a.attempts || a.regionCode.localeCompare(b.regionCode));
                if (ranked.length === 0) return <p className="muted adm-empty">Пока нет завершённых тестов с указанным регионом.</p>;
                return (
                  <div className="adm-scroll">
                    <table className="adm-table">
                      <thead>
                        <tr><th>Регион</th><th>Завершённых тестов</th><th>Самое сильное направление</th><th>Средний балл</th></tr>
                      </thead>
                      <tbody>
                        {ranked.map(region => (
                          <tr key={region.regionCode}>
                            <td>{regionName(region.regionCode)}</td>
                            <td>{region.attempts}</td>
                            <td>{categoryName(region.best.categoryId)}</td>
                            <td>{Math.round(region.best.averageDisplayScore)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }}
            </Async>
          </section>

          <section className="card adm-tables" aria-label="Таблицы">
            <div className="adm-tables__head">
              <div className="tabs adm-tabs" role="tablist" aria-label="Таблица">
                <button type="button" role="tab" className="tab" aria-selected={tab === 'users'} onClick={() => setTab('users')}>
                  Участники{users.data ? ` (${users.data.total})` : ''}
                </button>
                <button type="button" role="tab" className="tab" aria-selected={tab === 'results'} onClick={() => setTab('results')}>
                  Результаты{results.data ? ` (${results.data.total})` : ''}
                </button>
              </div>
              <button type="button" className="btn btn--accent adm-btn-sm" onClick={handleExport} disabled={exporting}>
                {exporting ? 'Готовим файл…' : 'Экспорт результатов в CSV'}
              </button>
            </div>
            {exportError && (
              <div className="form-alert" role="alert" style={{ margin: '0 20px 12px' }}><IconAlert size={18} /><span>{exportError}</span></div>
            )}

            {tab === 'users' ? (
              <Async state={users} empty={d => d.total === 0} emptyText={filtersActive ? 'По этим условиям участников нет.' : 'Пока нет зарегистрированных участников.'}>
                {d => (
                  <>
                    <div className="adm-scroll">
                      <table className="adm-table">
                        <thead><tr><th>Имя</th><th>Email</th><th>Возраст</th><th>Регион</th><th>Регистрация</th><th>Попытки</th><th><span className="sr-only">Действия</span></th></tr></thead>
                        <tbody>
                          {d.items.map(u => (
                            <tr key={u.userId}>
                              <td>{u.name ?? '—'}</td>
                              <td>{u.email ?? '—'}</td>
                              <td>{u.age ?? '—'}</td>
                              <td>{regionName(u.regionCode)}</td>
                              <td>{fmtDate(u.registeredAt)}</td>
                              <td>{u.completedAttempts} из {u.startedAttempts}</td>
                              <td>{u.lastCompletedAttemptId
                                ? <button type="button" className="link-btn" onClick={() => setDetailId(u.lastCompletedAttemptId)}>Результат</button>
                                : <span className="muted small">нет результата</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={d} onPage={setUsersPage} />
                  </>
                )}
              </Async>
            ) : (
              <Async state={results} empty={d => d.total === 0} emptyText={filtersActive ? 'По этим условиям завершённых тестов нет.' : 'Пока нет завершённых тестов.'}>
                {d => (
                  <>
                    <div className="adm-scroll">
                      <table className="adm-table">
                        <thead><tr><th>Завершён</th><th>Участник</th><th>Регион</th><th>Топ-3 направления</th><th>Ответов</th><th><span className="sr-only">Действия</span></th></tr></thead>
                        <tbody>
                          {d.items.map(r => (
                            <tr key={r.attemptId}>
                              <td>{fmtDate(r.completedAt)}</td>
                              <td>{r.name ?? '—'}<br /><span className="muted small">{r.email ?? ''}</span></td>
                              <td>{regionName(r.regionCode)}</td>
                              <td>{r.topCategoryIds.slice(0, 3).map(categoryName).join(', ') || '—'}</td>
                              <td>{r.answeredCount}</td>
                              <td><button type="button" className="link-btn" onClick={() => setDetailId(r.attemptId)}>Результат</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Pager page={d} onPage={setResultsPage} />
                  </>
                )}
              </Async>
            )}
          </section>
        </div>
      </main>
      <AppFooter />
      {detailId && <ResultDialog attemptId={detailId} token={token} onClose={() => setDetailId(null)} onUnauthorized={expired} />}
    </div>
  );
}

// ───────── Вспомогательные компоненты ─────────

interface AsyncState<T> { data: T | null; loading: boolean; error: string | null }

function Async<T>({ state, empty, emptyText, children }: {
  state: AsyncState<T>; empty: (d: T) => boolean; emptyText: string; children: (d: T) => ReactNode;
}) {
  if (state.error) return <div className="form-alert" role="alert" style={{ margin: 16 }}><IconAlert size={18} /><span>{state.error}</span></div>;
  if (!state.data) return <p className="muted adm-empty" aria-busy="true">Загрузка…</p>;
  if (empty(state.data)) return <p className="muted adm-empty">{emptyText}</p>;
  return <div style={{ opacity: state.loading ? 0.6 : 1 }}>{children(state.data)}</div>;
}

function StatCard({ label, value, pick }: { label: string; value: AsyncState<AdminOverview>; pick: (o: AdminOverview) => number }) {
  return (
    <div className="card adm-stat">
      <div className="adm-stat__num">{value.data ? pick(value.data).toLocaleString('ru-RU') : value.error ? '—' : '…'}</div>
      <div className="adm-stat__label">{label}</div>
    </div>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; value: number; max: number; color?: string; suffix: string }[] }) {
  return (
    <ul className="adm-bars">
      {rows.map(r => (
        <li key={r.key}>
          <div className="adm-bars__top"><span>{r.label}</span><span className="muted small">{r.value}{r.suffix}</span></div>
          <div className="scorebar" role="img" aria-label={`${r.label}: ${r.value}`}>
            <div className="scorebar__fill" style={{ width: `${r.max > 0 ? Math.max(3, (r.value / r.max) * 100) : 0}%`, background: r.color ?? 'var(--teal)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Pager({ page, onPage }: { page: Paginated<unknown>; onPage: (n: number) => void }) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  if (pages <= 1) return null;
  return (
    <div className="adm-pager">
      <button type="button" className="btn btn--ghost adm-btn-sm" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>← Назад</button>
      <span className="muted small">Страница {page.page} из {pages}</span>
      <button type="button" className="btn btn--ghost adm-btn-sm" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>Вперёд →</button>
    </div>
  );
}

function ResultDialog({ attemptId, token, onClose, onUnauthorized }: {
  attemptId: string; token: string; onClose: () => void; onUnauthorized: () => void;
}) {
  const state = useAdminData<AdminResultDetail>(signal => adminService.getResultDetail(attemptId, { token, signal }), [attemptId, token], onUnauthorized);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = state.data;
  return (
    <div className="adm-overlay" onClick={onClose}>
      <div className="card adm-dialog" role="dialog" aria-modal="true" aria-label="Результат участника" onClick={e => e.stopPropagation()}>
        <div className="adm-dialog__head">
          <div>
            <h2 className="h3">{d ? d.name ?? 'Участник' : 'Результат'}</h2>
            {d && <p className="muted small">{d.email} · {d.age ? `${d.age} лет · ` : ''}{regionName(d.regionCode)} · завершён {fmtDate(d.completedAt)}</p>}
          </div>
          <button ref={closeRef} type="button" className="btn btn--ghost adm-btn-sm" onClick={onClose}>Закрыть</button>
        </div>
        {state.error && <div className="form-alert" role="alert"><IconAlert size={18} /><span>{state.error}</span></div>}
        {!d && !state.error && <p className="muted adm-empty">Загрузка…</p>}
        {d && (
          <ol className="adm-scores">
            {d.scores.map(s => (
              <li key={s.categoryId} className={s.rank <= 5 ? 'adm-scores__top' : undefined}>
                <div className="adm-bars__top">
                  <span><span className="adm-rank">{s.rank}</span>{categoryName(s.categoryId)}</span>
                  <span className="muted small">{s.displayScore} из 100 · {s.rawScore > 0 ? '+' : ''}{s.rawScore}</span>
                </div>
                <div className="scorebar" role="img" aria-label={`${categoryName(s.categoryId)}: ${s.displayScore} из 100`}>
                  <div className="scorebar__fill" style={{ width: `${s.displayScore}%`, background: categoryById.get(s.categoryId)?.color ?? 'var(--teal)' }} />
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
