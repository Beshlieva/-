import CategoryIcon from './CategoryIcon';
import { CATEGORIES, toDisplay } from '../data/questions';

interface AllDirectionsRoseProps {
  scores: Record<number, number>;
  onSelect: (categoryId: number) => void;
}

const VW = 560;
const VH = 560;
const CX = VW / 2;
const CY = VH / 2;
const INNER_R = 28;
const MAX_R = 200;
const GAP = 8;

function toRad(d: number) { return (d * Math.PI) / 180; }
function polarXY(deg: number, r: number) {
  const rad = toRad(deg - 90);
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}
function arcPath(s: number, e: number, r1: number, r2: number) {
  const p1 = polarXY(s, r1), p2 = polarXY(e, r1);
  const p3 = polarXY(s, r2), p4 = polarXY(e, r2);
  const lg = e - s > 180 ? 1 : 0;
  return `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A${r1} ${r1} 0 ${lg} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} L${p4.x.toFixed(1)} ${p4.y.toFixed(1)} A${r2} ${r2} 0 ${lg} 0 ${p3.x.toFixed(1)} ${p3.y.toFixed(1)} Z`;
}
function scoreToR(s: number) { return INNER_R + ((s + 12) / 24) * (MAX_R - INNER_R); }

export default function AllDirectionsRose({ scores, onSelect }: AllDirectionsRoseProps) {
  const top10 = CATEGORIES
    .map(cat => ({ ...cat, score: scores[cat.id] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
  const slice = 360 / top10.length;
  const ringPoints = [25, 50, 75, 100];
  const ringRaw = (pt: number) => (pt / 100) * 24 - 12;

  return (
    <div className="flex flex-col items-center gap-5 w-full">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={{ maxWidth: 500, aspectRatio: '1/1' }}
        aria-label="Роза — топ 10 направлений"
      >
        {ringPoints.map(pt => {
          const r = scoreToR(ringRaw(pt));
          return (
            <g key={pt}>
              <circle cx={CX} cy={CY} r={r} fill="none" stroke="#CBD5E1" strokeWidth={0.9} strokeDasharray="5 5" />
              <text x={CX} y={CY - r - 6} textAnchor="middle" fontSize="8" fill="#7C8AA5" fontFamily="var(--font-sans)" fontWeight="700">
                {pt}
              </text>
            </g>
          );
        })}

        {top10.map((cat, i) => {
          const startDeg = i * slice + GAP / 2;
          const endDeg = (i + 1) * slice - GAP / 2;
          const midDeg = i * slice + slice / 2;
          const outerR = scoreToR(Math.max(cat.score, -11.5));
          const labelPos = polarXY(midDeg, MAX_R + 32);
          const iconPos = polarXY(midDeg, MAX_R + 16);
          const textAnchor = midDeg > 180 && midDeg < 360 ? 'end' : 'start';

          return (
            <g
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              style={{ cursor: 'pointer' }}
            >
              <path d={arcPath(startDeg, endDeg, INNER_R, MAX_R)} fill={cat.color} opacity={0.08} />
              <path d={arcPath(startDeg, endDeg, INNER_R, outerR)} fill={cat.color} opacity={0.9} />
              <path d={arcPath(startDeg, endDeg, INNER_R, MAX_R)} fill="transparent" stroke="transparent" strokeWidth={10} />

              {outerR - INNER_R > 22 && (
                <text
                  x={polarXY(midDeg, (outerR + INNER_R) / 2).x}
                  y={polarXY(midDeg, (outerR + INNER_R) / 2).y + 4}
                  textAnchor="middle"
                  fontSize="10"
                  fontWeight="800"
                  fill="white"
                  fontFamily="var(--font-sans)"
                >
                  {toDisplay(cat.score)}
                </text>
              )}

              <text
                x={labelPos.x}
                y={labelPos.y + 4}
                textAnchor={textAnchor}
                fontSize="10"
                fontWeight="700"
                fill="#12263F"
                fontFamily="var(--font-sans)"
              >
                {cat.name}
              </text>
            </g>
          );
        })}

        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="#FFFFFF" />
        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="none" stroke="#E2E8F0" strokeWidth={1} />
        <text x={CX} y={CY - 6} textAnchor="middle" fontSize="8" fill="#7C8AA5" fontFamily="var(--font-sans)" fontWeight="700">ТОП</text>
        <text x={CX} y={CY + 10} textAnchor="middle" fontSize="15" fill="#0B1F3A" fontFamily="var(--font-display)">10</text>
      </svg>

      <div className="w-full">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3 text-center" style={{ color: '#55667D' }}>
          Нажмите на направление для подробностей
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {top10.map((cat, rank) => {
            const disp = toDisplay(cat.score);
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => onSelect(cat.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all duration-100 w-full"
                style={{
                  backgroundColor: rank < 3 ? cat.color + '14' : '#FFFFFF',
                  border: `1px solid ${cat.color}25`,
                  cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.82rem', minWidth: '1.25rem', textAlign: 'center' }}>
                  <CategoryIcon name={cat.icon} size={12} color={cat.color} />
                </span>
                <span className="flex-1 text-[11px] font-medium truncate" style={{ color: '#12263F' }}>
                  {cat.name}
                </span>
                <span className="text-[11px] font-bold shrink-0" style={{ color: cat.color }}>
                  {disp}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
