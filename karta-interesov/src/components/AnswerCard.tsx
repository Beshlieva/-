interface AnswerCardProps {
  value: number;
  label: string;
  /** Клавиша быстрого ответа (1–5). */
  hotkey: number;
  onClick: () => void;
}

/** Вариант ответа. Выбор сразу записывается и открывает следующий вопрос, поэтому «выбранного» состояния нет. */
export default function AnswerCard({ value, label, hotkey, onClick }: AnswerCardProps) {
  const tone = value > 0 ? 'pos' : value < 0 ? 'neg' : 'neu';
  return (
    <button type="button" className={`answer answer--${tone}`} onClick={onClick} data-value={value}>
      <span className="answer__tone" aria-hidden="true" />
      <span className="answer__label">{label}</span>
      <span className="kbd" aria-hidden="true">{hotkey}</span>
    </button>
  );
}
