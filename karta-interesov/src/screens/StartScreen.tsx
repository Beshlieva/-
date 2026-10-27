import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconArrowRight, IconRose, IconTarget, IconList } from '../components/icons';
import { ANSWER_OPTIONS, QUESTIONS } from '../data/questions';
import { QUESTION_TIME_MS } from '../lib/testSession';

interface StartScreenProps {
  onStart: () => void;
  onUserAccess?: () => void;
  showEntryLinks?: boolean;
  /** Имя вошедшего пользователя (только при подключённом API). */
  userName?: string | null;
  onLogout?: () => void;
}

const SECONDS = QUESTION_TIME_MS / 1000;
const SAMPLE = QUESTIONS[1]; // «Решать физические задачи» — пример только для витрины

export default function StartScreen({ onStart, onUserAccess, showEntryLinks = false, userName, onLogout }: StartScreenProps) {
  return (
    <div className="shell">
      <AppHeader
        right={showEntryLinks ? (
          <span className="topbar__user">
            {onLogout ? (
              <>
                {userName ? <strong>{userName}</strong> : null}
                <button type="button" className="link-btn" onClick={onLogout}>Выйти</button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={onUserAccess}>Вход / регистрация участника</button>
            )}
            <a className="link-btn" href="#/admin">Вход администратора</a>
          </span>
        ) : onLogout ? (
            <span className="topbar__user">
              {userName ? <strong>{userName}</strong> : null}
              <button type="button" className="link-btn" onClick={onLogout}>Выйти</button>
            </span>
          ) : undefined}
      />

      <main className="page">
        <div className="container">
          <div className="hero">
            <div>
              <span className="chip chip--teal">Профориентационный тест</span>
              <h1 className="h1" style={{ marginTop: 18 }}>Карта интересов</h1>
              <p className="lead" style={{ marginTop: 20 }}>
                Оцените 174 вида деятельности и получите карту своих профессиональных интересов по 29 направлениям — от физики и медицины до права и искусства.
              </p>

              <div className="hero__actions">
                <button type="button" className="btn btn--primary" onClick={onStart}>
                  Начать тест
                  <IconArrowRight size={18} />
                </button>
                <span className="hero__note">Сначала — короткая инструкция</span>
              </div>

              <dl className="facts" style={{ margin: '44px 0 0' }}>
                {[
                  { num: '174', label: 'утверждения' },
                  { num: '29', label: 'направлений' },
                  { num: `${SECONDS} с`, label: 'на каждый вопрос' },
                  { num: '≤ 45', label: 'минут на весь тест' },
                ].map(f => (
                  <div className="fact" key={f.label}>
                    <dt className="fact__num">{f.num}</dt>
                    <dd className="fact__label" style={{ margin: 0 }}>{f.label}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Витрина вопроса: статичная иллюстрация, не интерактивна */}
            <div className="card preview" aria-hidden="true">
              <div className="preview__top">
                <span className="chip">Вопрос 2 из 174</span>
                <div className="timer" style={{ width: 60, height: 60 }}>
                  <svg viewBox="0 0 76 76">
                    <circle className="timer__track" cx="38" cy="38" r="32" fill="none" strokeWidth="6" />
                    <circle className="timer__arc" cx="38" cy="38" r="32" fill="none" strokeWidth="6" strokeDasharray="201" strokeDashoffset="56" />
                  </svg>
                  <div className="timer__value" style={{ fontSize: '1.25rem' }}>11</div>
                </div>
              </div>
              <p className="preview__text">{SAMPLE.text}</p>
              <div className="answers">
                {ANSWER_OPTIONS.map((o, i) => (
                  <div
                    key={o.value}
                    className="answer"
                    style={i === 1 ? { borderColor: 'var(--teal)', background: 'var(--teal-soft)' } : undefined}
                  >
                    <span className="answer__tone" style={{ background: o.value > 0 ? 'var(--teal)' : o.value < 0 ? '#c0705a' : 'var(--faint)' }} />
                    <span className="answer__label">{o.label}</span>
                    <span className="kbd">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="values">
            <div className="card value">
              <div className="value__icon"><IconTarget size={22} /></div>
              <h3 className="h3">Пять ведущих направлений</h3>
              <p className="muted small">Круговая диаграмма с главными интересами и баллом по каждому.</p>
            </div>
            <div className="card value">
              <div className="value__icon"><IconRose size={22} /></div>
              <h3 className="h3">Роза интересов</h3>
              <p className="muted small">Все 29 направлений на одной диаграмме: сразу видно, где интерес выше.</p>
            </div>
            <div className="card value">
              <div className="value__icon"><IconList size={22} /></div>
              <h3 className="h3">Полный рейтинг</h3>
              <p className="muted small">Список направлений от высокого интереса к низкому, со шкалой 0–100.</p>
            </div>
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
