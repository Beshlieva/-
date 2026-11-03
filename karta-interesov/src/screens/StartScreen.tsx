import { useState } from 'react';
import AppHeader, { AppFooter } from '../components/AppHeader';
import CategoryIcon from '../components/CategoryIcon';
import { IconArrowRight, IconRose, IconTarget, IconList } from '../components/icons';
import { ANSWER_OPTIONS, CATEGORIES, QUESTIONS } from '../data/questions';
import { QUESTION_TIME_MS } from '../lib/testSession';

interface StartScreenProps {
  onStart: () => void;
  onUserAccess?: () => void;
  onAccount?: () => void;
  showEntryLinks?: boolean;
  userName?: string | null;
  onLogout?: () => void;
}

const SECONDS = QUESTION_TIME_MS / 1000;
const SAMPLE = QUESTIONS[1];

const SLIDES = [
  {
    label: 'Ориентир вместо случайного выбора',
    eyebrow: 'КАРТА ИНТЕРЕСОВ · ПРОФОРИЕНТАЦИЯ',
    title: 'Понять, что вам действительно интересно',
    description: 'Ответьте на короткие утверждения о занятиях и получите структурированную карту профессиональных интересов — без правильных и неправильных ответов.',
  },
  {
    label: '29 направлений',
    eyebrow: 'ШИРОКИЙ ВЗГЛЯД НА ВОЗМОЖНОСТИ',
    title: 'От науки и технологий до творчества и людей',
    description: 'Тест рассматривает 29 сфер: от физики, медицины и IT до педагогики, права, искусства и общественной деятельности.',
  },
  {
    label: 'Результат для размышлений',
    eyebrow: 'ВАША КАРТА · ВАШ СЛЕДУЮЩИЙ ШАГ',
    title: 'Не ярлык, а отправная точка для выбора',
    description: 'Сравните ведущие интересы, изучите полный профиль и используйте результат как повод исследовать профессии и обсудить варианты с близкими или консультантом.',
  },
];

function InterestPreview() {
  const categories = [CATEGORIES[10], CATEGORIES[4], CATEGORIES[18], CATEGORIES[24]];
  return (
    <div className="story-art__map" aria-label="Пример визуального представления профиля интересов">
      <div className="story-art__map-head">
        <span className="story-art__mini-mark">КИ</span>
        <span>Карта интересов</span>
        <span className="story-art__live-dot" />
      </div>
      <p className="story-art__map-caption">29 направлений · индивидуальный профиль</p>
      <div className="story-art__orbit">
        <span className="story-art__orbit-line story-art__orbit-line--one" />
        <span className="story-art__orbit-line story-art__orbit-line--two" />
        <span className="story-art__orbit-core"><IconTarget size={28} /></span>
        <span className="story-art__orbit-node story-art__orbit-node--one">IT</span>
        <span className="story-art__orbit-node story-art__orbit-node--two">ЛЮДИ</span>
        <span className="story-art__orbit-node story-art__orbit-node--three">НАУКА</span>
        <span className="story-art__orbit-node story-art__orbit-node--four">ИДЕИ</span>
      </div>
      <div className="story-art__category-list">
        {categories.map((category, index) => (
          <div className="story-art__category" key={category.id}>
            <span className="story-art__category-icon" style={{ background: `${category.color}24`, color: category.color }}>
              <CategoryIcon name={category.icon} size={13} color={category.color} />
            </span>
            <span>{category.name}</span>
            <span className="story-art__category-rank">0{index + 1}</span>
          </div>
        ))}
      </div>
      <span className="story-art__disclaimer">Иллюстрация · ваш результат будет индивидуальным</span>
    </div>
  );
}

function DirectionsPreview() {
  const directions = [
    { name: 'Технологии и вычисления', tag: 'АНАЛИТИКА', style: 'story-art__direction--blue' },
    { name: 'Здоровье и помощь людям', tag: 'ЗАБОТА', style: 'story-art__direction--coral' },
    { name: 'Искусство и визуальные идеи', tag: 'ТВОРЧЕСТВО', style: 'story-art__direction--lilac' },
  ];
  return (
    <div className="story-art__directions" aria-label="Примеры направлений теста">
      <div className="story-art__directions-top">
        <span>Карта областей</span>
        <span>01 — 29</span>
      </div>
      <div className="story-art__direction-cloud" aria-hidden="true">
        <span className="story-art__cloud-shape story-art__cloud-shape--a" />
        <span className="story-art__cloud-shape story-art__cloud-shape--b" />
        <span className="story-art__cloud-shape story-art__cloud-shape--c" />
        <span className="story-art__cloud-shape story-art__cloud-shape--d" />
        <span className="story-art__cloud-center"><IconRose size={30} /></span>
      </div>
      <div className="story-art__direction-list">
        {directions.map(direction => (
          <div className="story-art__direction" key={direction.name}>
            <span className={`story-art__direction-dot ${direction.style}`} />
            <span>{direction.name}</span>
            <small>{direction.tag}</small>
          </div>
        ))}
        <p className="story-art__more">И ещё 26 сфер — от природы до права</p>
      </div>
    </div>
  );
}

function ResultsPreview() {
  return (
    <div className="story-art__results" aria-label="Пример разделов персонального результата">
      <div className="story-art__results-head">
        <div>
          <span className="story-art__results-kicker">ИТОГ ТЕСТА</span>
          <p>Ваш профиль интересов</p>
        </div>
        <span className="story-art__results-badge"><IconTarget size={18} /></span>
      </div>
      <div className="story-art__result-feature">
        <span className="story-art__result-feature-icon"><IconRose size={22} /></span>
        <span><strong>Ведущие сферы</strong><small>С чего начать знакомство</small></span>
        <IconArrowRight size={17} />
      </div>
      <div className="story-art__result-feature">
        <span className="story-art__result-feature-icon story-art__result-feature-icon--light"><IconTarget size={22} /></span>
        <span><strong>Профиль целиком</strong><small>Сравнение всех направлений</small></span>
        <IconArrowRight size={17} />
      </div>
      <div className="story-art__result-feature">
        <span className="story-art__result-feature-icon story-art__result-feature-icon--gold"><IconList size={22} /></span>
        <span><strong>Рейтинг интересов</strong><small>Понятный список с баллами</small></span>
        <IconArrowRight size={17} />
      </div>
      <p className="story-art__result-note">Результат показывает интересы, а не измеряет способности и не выбирает профессию за вас.</p>
    </div>
  );
}

function SlideArtwork({ index }: { index: number }) {
  if (index === 1) return <DirectionsPreview />;
  if (index === 2) return <ResultsPreview />;
  return <InterestPreview />;
}

export default function StartScreen({ onStart, onUserAccess, onAccount, showEntryLinks = false, userName, onLogout }: StartScreenProps) {
  const [activeSlide, setActiveSlide] = useState(0);
  const slide = SLIDES[activeSlide];

  function selectSlide(index: number) {
    setActiveSlide((index + SLIDES.length) % SLIDES.length);
  }

  return (
    <div className="shell">
      <AppHeader
        right={showEntryLinks ? (
          <nav className="topbar__user" aria-label="Вход в учётную запись">
            {onLogout ? (
              <>
                {userName ? <strong>{userName}</strong> : null}
                {onAccount ? <button type="button" className="link-btn" onClick={onAccount}>Личный кабинет</button> : null}
                <button type="button" className="link-btn" onClick={onLogout}>Выйти</button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={onUserAccess}>Вход участника</button>
            )}
            <a className="topbar__admin-link" href="#/admin">Для администратора</a>
          </nav>
        ) : onLogout ? (
          <span className="topbar__user">
            {userName ? <strong>{userName}</strong> : null}
            {onAccount ? <button type="button" className="link-btn" onClick={onAccount}>Личный кабинет</button> : null}
            <button type="button" className="link-btn" onClick={onLogout}>Выйти</button>
          </span>
        ) : undefined}
      />

      <main className="page landing-page">
        <div className="container">
          <section className="story-hero" aria-roledescription="карусель" aria-label="О профориентационном тесте">
            <div className="story-hero__copy" key={slide.title}>
              <span className="story-hero__eyebrow"><span />{slide.eyebrow}</span>
              <h1 className="story-hero__title" aria-live="polite">{slide.title}</h1>
              <p className="story-hero__description">{slide.description}</p>
              <div className="story-hero__actions">
                <button type="button" className="btn story-hero__cta" onClick={onStart}>
                  Пройти тест
                  <IconArrowRight size={18} />
                </button>
                <span className="story-hero__hint">174 утверждения · около 40 минут</span>
              </div>
              <div className="story-hero__trust">
                <span className="story-hero__trust-icon"><IconTarget size={17} /></span>
                <span>Основано на методике «Карта интересов»<br /><small>Помогает исследовать предпочтения, не ставит диагнозов</small></span>
              </div>
            </div>

            <div className="story-hero__visual" key={`visual-${activeSlide}`}>
              <div className="story-hero__visual-glow" />
              <SlideArtwork index={activeSlide} />
              <div className="story-hero__index"><span>0{activeSlide + 1}</span><i />03</div>
            </div>

            <div className="story-hero__controls">
              <div className="story-hero__slide-label">
                <span>УЗНАЙТЕ, КАК ЭТО РАБОТАЕТ</span>
                <strong>{slide.label}</strong>
              </div>
              <div className="story-hero__pagination">
                <button type="button" className="story-hero__arrow" onClick={() => selectSlide(activeSlide - 1)} aria-label="Предыдущий слайд">←</button>
                <div className="story-hero__dots" role="group" aria-label="Выбрать слайд">
                  {SLIDES.map((item, index) => (
                    <button
                      type="button"
                      key={item.label}
                      className={`story-hero__dot${activeSlide === index ? ' is-active' : ''}`}
                      aria-label={`Слайд ${index + 1}: ${item.label}`}
                      aria-current={activeSlide === index ? 'step' : undefined}
                      onClick={() => selectSlide(index)}
                    />
                  ))}
                </div>
                <button type="button" className="story-hero__arrow" onClick={() => selectSlide(activeSlide + 1)} aria-label="Следующий слайд">→</button>
              </div>
            </div>
          </section>

          <section className="landing-facts" aria-label="О тесте в цифрах">
            {[
              { num: '29', label: 'сфер интересов', note: 'от науки до искусства' },
              { num: '174', label: 'утверждения', note: 'про реальные занятия' },
              { num: `${SECONDS} сек`, label: 'на ответ', note: 'короткий темп теста' },
              { num: '01', label: 'ваш профиль', note: 'без единого ярлыка' },
            ].map((fact, index) => (
              <div className="landing-fact" key={fact.label}>
                <span className="landing-fact__number">{fact.num}</span>
                <span className="landing-fact__body"><strong>{fact.label}</strong><small>{fact.note}</small></span>
                {index < 3 && <span className="landing-fact__divider" />}
              </div>
            ))}
          </section>

          <section className="landing-method">
            <div className="landing-method__heading">
              <span className="landing-method__eyebrow">ВАШ РЕЗУЛЬТАТ</span>
              <h2 className="h2">Не просто тест. Карта для следующего шага.</h2>
              <p className="lead">Посмотрите на свои интересы под разными углами и выберите, что хочется исследовать дальше.</p>
            </div>
            <div className="values">
              <article className="card value">
                <div className="value__icon"><IconTarget size={22} /></div>
                <h3 className="h3">Пять ведущих сфер</h3>
                <p className="muted small">Короткий список направлений, к которым сейчас больше всего тянет.</p>
              </article>
              <article className="card value">
                <div className="value__icon"><IconRose size={22} /></div>
                <h3 className="h3">Профиль целиком</h3>
                <p className="muted small">Увидьте, как сочетаются интересы в науке, технике, людях и творчестве.</p>
              </article>
              <article className="card value">
                <div className="value__icon"><IconList size={22} /></div>
                <h3 className="h3">Понятная шкала</h3>
                <p className="muted small">Баллы помогают сравнить направления и начать разговор о будущем.</p>
              </article>
            </div>
            <div className="landing-method__footnote">
              <span>Важно</span>
              Результат отражает ответы и интересы на момент прохождения. Это инструмент для размышления, а не обещание карьерного успеха или окончательный выбор профессии.
            </div>
          </section>

          <section className="landing-question">
            <div>
              <span className="landing-question__eyebrow">ОДИН ИЗ 174 ВОПРОСОВ</span>
              <h2 className="h2">А вам было бы интересно…</h2>
              <p className="landing-question__text">{SAMPLE.text.toLowerCase()}?</p>
              <p className="muted small">Отвечайте так, как чувствуете сейчас. Здесь нет оценки и неправильного ответа.</p>
            </div>
            <div className="landing-question__answers" aria-label="Пример вариантов ответа">
              {ANSWER_OPTIONS.map(option => (
                <span className="landing-question__answer" key={option.value}>
                  <span>{option.label}</span><span className="kbd">{option.value}</span>
                </span>
              ))}
            </div>
          </section>

          <section className="landing-end">
            <div>
              <span className="landing-method__eyebrow">НАЧНИТЕ С ИНТЕРЕСА</span>
              <h2 className="h2">Возможно, ваш следующий шаг ближе, чем кажется.</h2>
            </div>
            <button type="button" className="btn story-hero__cta" onClick={onStart}>Перейти к тесту <IconArrowRight size={18} /></button>
          </section>
        </div>
      </main>
      <AppFooter />
    </div>
  );
}
