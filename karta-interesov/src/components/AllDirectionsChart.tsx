import { CATEGORIES, toDisplay } from '../data/questions';

interface AllDirectionsChartProps {
  scores: Record<number, number>;
  onSelect: (categoryId: number) => void;
}

export default function AllDirectionsChart({ scores, onSelect }: AllDirectionsChartProps) {
  const sorted = CATEGORIES
    .map(cat => ({ ...cat, score: scores[cat.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((cat, i) => {
        const score = cat.score;
        // Positive bar: from 50% rightward. Negative: from 50% leftward.
        // Track width = 100%, bar occupies half the track for +/-12
        const pct = Math.abs(score) / 12; // 0..1
        const isPositive = score >= 0;

        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id)}
            className="w-full text-left rounded-2xl px-4 py-3.5 transition-all duration-150"
            style={{
              backgroundColor: i < 3 ? cat.color + '10' : '#FFFFFF',
              border: i < 3 ? `1.5px solid ${cat.color}30` : '1.5px solid #D9E2EC',
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = cat.color + '18';
              (e.currentTarget as HTMLElement).style.border = `1.5px solid ${cat.color}50`;
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.backgroundColor = i < 3 ? cat.color + '10' : '#FFFFFF';
              (e.currentTarget as HTMLElement).style.border = i < 3 ? `1.5px solid ${cat.color}30` : '1.5px solid #D9E2EC';
            }}
          >
            <div className="flex items-center gap-3">
              {/* Icon */}
              <span className="text-lg w-7 text-center shrink-0">{cat.icon}</span>

              {/* Name */}
              <span
                className="shrink-0 font-medium text-sm"
                style={{ color: '#0B1F3A', minWidth: '8rem', maxWidth: '8rem' }}
              >
                {cat.name}
              </span>

              {/* Bar track */}
              <div
                className="flex-1 relative rounded-full overflow-hidden"
                style={{ height: 10, backgroundColor: '#D9E2EC' }}
              >
                {/* Center divider */}
                <div
                  className="absolute top-0 bottom-0 w-0.5"
                  style={{ left: '50%', backgroundColor: '#C8C3BC', zIndex: 1 }}
                />

                {/* Colored bar */}
                {score !== 0 && (
                  <div
                    className="absolute top-0 bottom-0 rounded-full transition-all duration-700 ease-out"
                    style={{
                      backgroundColor: cat.color,
                      width: `${pct * 50}%`,
                      left: isPositive ? '50%' : `${50 - pct * 50}%`,
                    }}
                  />
                )}
              </div>

              {/* Score (100-pt scale) */}
              <span
                className="shrink-0 text-sm font-bold w-10 text-right"
                style={{
                  color: score > 0 ? cat.color : score < 0 ? '#C97048' : '#55667D',
                  fontFamily: 'var(--font-sans)',
                }}
              >
                {toDisplay(score)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
