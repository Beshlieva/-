import { useEffect, useState } from 'react';
import { CATEGORIES, toDisplay } from '../data/questions';
import Top5Chart from '../components/Top5Chart';
import AllDirectionsChart from '../components/AllDirectionsChart';
import AllDirectionsRose from '../components/AllDirectionsRose';
import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconInfo, IconList, IconRose, IconTarget } from '../components/icons';
import type { ResultSource } from '../types';

interface ResultsScreenProps {
  /** Сырые баллы направлений (id → −12..+12). Считаются в слое services/api. */
  scores: Record<number, number>;
  answeredCount: number;
  /** 'local' — посчитано в браузере; 'server' — результат вернул backend. */
  source: ResultSource;
  /** true — попытка сохранена на сервере. */
  persisted: boolean;
  onRetake: () => void;
}

function ScoreBar({ score, color }: { score: number; color: string }) {
  const pct = ((score + 12) / 24) * 100;
  return (
    <div className="scorebar" aria-hidden="true">
      <div className="scorebar__mid" />
      <div className="scorebar__fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

interface DetailCardProps {
  categoryId: number;
  score: number;
  onClose: () => void;
}

function DetailCard({ categoryId, score, onClose }: DetailCardProps) {
  const cat = CATEGORIES.find(c => c.id === categoryId)!;
  const level = score >= 8 ? 'Высокий' : score >= 4 ? 'Средний' : score >= 0 ? 'Нейтральный' : 'Низкий';
  const levelClass = score >= 8 ? 'chip--teal' : score >= 4 ? 'chip--teal' : score >= 0 ? '' : 'chip--danger';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={e => e.stopPropagation()}>
        <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">✕</button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, display: 'grid', placeItems: 'center', fontSize: '1.5rem', background: cat.color + '1a', flex: 'none' }} aria-hidden="true">
            {cat.icon}
          </div>
          <div>
            <p className="small muted">Направление {cat.id} из {CATEGORIES.length}</p>
            <h2 className="h3" id="detail-title" style={{ fontSize: '1.5rem' }}>{cat.name}</h2>
          </div>
        </div>

        <p className="muted small" style={{ marginBottom: 20 }}>{cat.description}</p>

        <div style={{ background: 'var(--surface-2)', borderRadius: 12, padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <span className="small muted">Ваш результат</span>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.8rem', color: 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}>
              {toDisplay(score)} <span className="small muted" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400 }}>/ 100</span>
            </span>
          </div>
          <ScoreBar score={score} color={cat.color} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }} className="small muted">
            <span>0</span><span>50</span><span>100</span>
          </div>
        </div>

        <span className={`chip ${levelClass}`}>{level} интерес</span>
      </div>
    </div>
  );
}

export default function ResultsScreen({ scores, answeredCount, source, persisted, onRetake }: ResultsScreenProps) {
  const [activeDetail, setActiveDetail] = useState<number | null>(null);
  const [tab, setTab] = useState<'chart' | 'all' | 'rose'>('chart');

  const sorted = CATEGORIES
    .map(cat => ({ ...cat, score: scores[cat.id] }))
    .sort((a, b) => b.score - a.score);
  const top5 = sorted.slice(0, 5);

  const tabs = [
    { key: 'chart', label: 'Топ-5', icon: <IconTarget size={16} /> },
    { key: 'rose', label: 'Роза', icon: <IconRose size={16} /> },
    { key: 'all', label: 'Список', icon: <IconList size={16} /> },
  ] as const;

  function handleRetake() {
    if (window.confirm('Начать тест заново? Текущие ответы и результат будут удалены с этого устройства.')) onRetake();
  }

  return (
    <div className="shell">
      <AppHeader />

      <main className="page">
        <div className="container container--narrow">
          <div className="results-head">
            <div>
              <h1 className="h2">Ваша карта интересов</h1>
              <p className="muted" style={{ marginTop: 8 }}>
                Отвечено на {answeredCount} вопросов · 29 направлений
              </p>
              <div className="badges">
                {source === 'server' && persisted
                  ? <span className="chip chip--teal">Сохранён на сервере</span>
                  : <span className="chip chip--amber">Локальный результат · не сохранён на сервере</span>}
              </div>
            </div>
          </div>

          <div className="tabs" role="tablist" aria-label="Вид результата">
            {tabs.map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                className="tab"
                onClick={() => setTab(t.key)}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{t.icon}{t.label}</span>
              </button>
            ))}
          </div>

          {tab === 'chart' && (
            <div>
              <div className="panel-card">
                <h2 className="h3" style={{ textAlign: 'center' }}>5 ведущих направлений</h2>
                <p className="small muted" style={{ textAlign: 'center', margin: '4px 0 20px' }}>Чем шире сектор — тем выше интерес</p>
                <Top5Chart scores={scores} />
              </div>

              <div className="top-list">
                {top5.map((cat, i) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`top-item${i === 0 ? ' top-item--first' : ''}`}
                    onClick={() => setActiveDetail(cat.id)}
                  >
                    <span className="top-item__rank">{i + 1}</span>
                    <span style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: cat.color + '1a', flex: 'none' }} aria-hidden="true">{cat.icon}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600, color: 'var(--navy)' }}>{cat.name}</span>
                      <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.description}</span>
                    </span>
                    <span className="top-item__score" style={{ color: cat.color }}>{cat.score > 0 ? `+${cat.score}` : cat.score}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === 'rose' && (
            <div className="panel-card">
              <h2 className="h3" style={{ textAlign: 'center' }}>Все 29 направлений</h2>
              <p className="small muted" style={{ textAlign: 'center', margin: '4px 0 20px' }}>Чем длиннее лепесток — тем выше интерес · шкала 0–100</p>
              <AllDirectionsRose scores={scores} onSelect={setActiveDetail} />
            </div>
          )}

          {tab === 'all' && (
            <div className="panel-card">
              <h2 className="h3" style={{ marginBottom: 4 }}>Все 29 направлений</h2>
              <p className="small muted" style={{ marginBottom: 18 }}>От высокого интереса к низкому</p>
              <AllDirectionsChart scores={scores} onSelect={setActiveDetail} />
            </div>
          )}

          <div className="local-note" role="note">
            <span style={{ flex: 'none', marginTop: 2 }}><IconInfo size={18} /></span>
            <span>
              {source === 'server' && persisted
                ? 'Результат сохранён на сервере и привязан к вашей попытке.'
                : 'Результат рассчитан в вашем браузере. Он не отправлялся на сервер и не попал в базу данных. Черновик ответов хранится только на этом устройстве и удаляется кнопкой «Пройти тест заново».'}
            </span>
          </div>

          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button type="button" className="btn btn--ghost" onClick={handleRetake}>Пройти тест заново</button>
          </div>
        </div>
      </main>

      <AppFooter />

      {activeDetail !== null && (
        <DetailCard categoryId={activeDetail} score={scores[activeDetail]} onClose={() => setActiveDetail(null)} />
      )}
    </div>
  );
}
