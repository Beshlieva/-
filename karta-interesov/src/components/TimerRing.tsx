import { QUESTION_TIME_MS, WARNING_THRESHOLD_MS } from '../lib/testSession';

interface TimerRingProps {
  /** Оставшееся время, мс. */
  remainingMs: number;
}

const R = 32;
const C = 2 * Math.PI * R;

/** Круговой таймер. Только отображает переданный остаток — само время считает движок по timestamp. */
export default function TimerRing({ remainingMs }: TimerRingProps) {
  const seconds = Math.ceil(remainingMs / 1000);
  const danger = remainingMs <= WARNING_THRESHOLD_MS;
  const ratio = Math.min(1, Math.max(0, remainingMs / QUESTION_TIME_MS));

  return (
    <div
      className={`timer${danger ? ' timer--danger' : ''}`}
      role="timer"
      aria-label={`Осталось ${seconds} с`}
      data-danger={danger}
    >
      <svg viewBox="0 0 76 76" aria-hidden="true">
        <circle className="timer__track" cx="38" cy="38" r={R} fill="none" strokeWidth="6" />
        <circle
          className="timer__arc"
          cx="38" cy="38" r={R} fill="none" strokeWidth="6"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
        />
      </svg>
      <div className="timer__value">
        <span>{seconds}</span>
      </div>
    </div>
  );
}
