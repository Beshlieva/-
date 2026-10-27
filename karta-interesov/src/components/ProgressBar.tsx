interface ProgressBarProps {
  answered: number;
  skipped: number;
  total: number;
}

/** Общий прогресс: бирюзовый — отвечено, янтарный — пропущено (ожидают повторного прохождения). */
export default function ProgressBar({ answered, skipped, total }: ProgressBarProps) {
  const a = (answered / total) * 100;
  const s = (skipped / total) * 100;
  return (
    <div>
      <div
        className="progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={answered}
        aria-label="Отвечено вопросов"
      >
        <div className="progress__done" style={{ width: `${a}%` }} />
        <div className="progress__skip" style={{ width: `${s}%` }} />
      </div>
      <div className="progress-meta">
        <span><i className="dot" style={{ background: 'var(--teal)' }} />Отвечено {answered}</span>
        <span><i className="dot" style={{ background: '#e0a43b' }} />Пропущено {skipped}</span>
        <span>Всего {total}</span>
      </div>
    </div>
  );
}
