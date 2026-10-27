import AppHeader, { AppFooter } from '../components/AppHeader';
import { IconArrowLeft, IconArrowRight, IconClock, IconLock, IconRepeat, IconSkip } from '../components/icons';
import { ANSWER_OPTIONS } from '../data/questions';
import { QUESTION_TIME_MS } from '../lib/testSession';

interface InstructionsScreenProps {
  onBegin: () => void;
  onBack: () => void;
}

const SECONDS = QUESTION_TIME_MS / 1000;

export default function InstructionsScreen({ onBegin, onBack }: InstructionsScreenProps) {
  return (
    <div className="shell">
      <AppHeader />

      <main className="page">
        <div className="container">
          <button type="button" className="linkback" onClick={onBack}>
            <IconArrowLeft size={16} />
            Назад
          </button>

          <h1 className="h2" style={{ marginTop: 12 }}>Как проходить тест</h1>
          <p className="lead" style={{ marginTop: 12, marginBottom: 32 }}>
            Вам будут показаны 174 утверждения — виды занятий. Оцените, насколько вам это нравится. Отвечайте по первому ощущению: правильных и неправильных ответов нет.
          </p>

          <div className="split">
            <div className="rules">
              <div className="card rule">
                <div className="rule__icon"><IconClock size={20} /></div>
                <div>
                  <p className="rule__title">{SECONDS} секунд на каждый вопрос</p>
                  <p className="muted small">Отсчёт начинается, когда вопрос появился на экране, и не останавливается — даже если обновить страницу или перейти на другую вкладку.</p>
                </div>
              </div>
              <div className="card rule rule--warn">
                <div className="rule__icon"><IconSkip size={20} /></div>
                <div>
                  <p className="rule__title">Не успели — вопрос пропускается</p>
                  <p className="muted small">Откроется следующий вопрос. Пропуск не равен нулю: он не влияет на баллы, пока вы на него не ответите.</p>
                </div>
              </div>
              <div className="card rule">
                <div className="rule__icon"><IconRepeat size={20} /></div>
                <div>
                  <p className="rule__title">Пропущенные вопросы пройдите повторно</p>
                  <p className="muted small">В конце теста покажем, сколько вопросов осталось, и предложим пройти только их. Результат откроется после ответа на все 174 вопроса.</p>
                </div>
              </div>
              <div className="card rule">
                <div className="rule__icon"><IconLock size={20} /></div>
                <div>
                  <p className="rule__title">Вернуться к прошлому вопросу нельзя</p>
                  <p className="muted small">Ответ записывается сразу после выбора и больше не меняется.</p>
                </div>
              </div>
            </div>

            <div className="card card--pad">
              <h2 className="h3" style={{ marginBottom: 6 }}>Варианты ответа</h2>
              <p className="muted small" style={{ marginBottom: 16 }}>Выбирайте мышью, касанием или клавишами 1–5.</p>
              <div className="scale">
                {ANSWER_OPTIONS.map((o, i) => (
                  <div className="scale__row" key={o.value}>
                    <span className="answer__tone" style={{ width: 10, height: 10, borderRadius: '50%', background: o.value > 0 ? 'var(--teal)' : o.value < 0 ? '#c0705a' : 'var(--faint)' }} />
                    {o.label}
                    <span className="kbd">{i + 1}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="cta-bar">
            <p className="muted small" style={{ maxWidth: '46ch' }}>
              Таймер первого вопроса запустится сразу после нажатия кнопки. Устройтесь поудобнее и убедитесь, что вас не отвлекут.
            </p>
            <button type="button" className="btn btn--accent" onClick={onBegin}>
              Начать тест
              <IconArrowRight size={18} />
            </button>
          </div>
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
