import { CATEGORIES, toDisplay } from '../data/questions';

interface AllDirectionsRoseProps {
  scores: Record<number, number>;
  onSelect: (categoryId: number) => void;
}

const VW = 560;
const VH = 560;
const CX = VW / 2;
const CY = VH / 2;
const INNER_R = 22;
const MAX_R   = 200;
const SLICE   = 360 / 29;
const GAP     = 0.6;

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

// Sorted by score descending so legend reads top → bottom
export default function AllDirectionsRose({ scores, onSelect }: AllDirectionsRoseProps) {
  const sorted = CATEGORIES
    .map(cat => ({ ...cat, score: scores[cat.id] ?? 0 }))
    .sort((a, b) => b.score - a.score);

  // We draw in original category order around the circle (id order)
  const byId = CATEGORIES.map(cat => ({ ...cat, score: scores[cat.id] ?? 0 }));

  const RING_PTS = [25, 50, 75, 100];
  const ringRaw  = (pt: number) => (pt / 100) * 24 - 12;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={{ maxWidth: 480, aspectRatio: '1/1' }}
        aria-label="Все 29 направлений — полярная диаграмма"
      >
        {/* Guide rings */}
        {RING_PTS.map(pt => {
          const r = scoreToR(ringRaw(pt));
          return (
            <g key={pt}>
              <circle cx={CX} cy={CY} r={r} fill="none" stroke="#CBD5E1" strokeWidth={0.7} strokeDasharray="4 4" />
              <text x={CX} y={CY - r - 3} textAnchor="middle" fontSize="8" fill="#94A3B8" fontFamily="var(--font-sans)" fontWeight="600">
                {pt}
              </text>
            </g>
          );
        })}

        {/* Segments — one per category in id order */}
        {byId.map((cat, i) => {
          const startDeg = i * SLICE + GAP / 2;
          const endDeg   = (i + 1) * SLICE - GAP / 2;
          const midDeg   = i * SLICE + SLICE / 2;
          const outerR   = scoreToR(Math.max(cat.score, -11.5));

          // Icon at midpoint of outer arc
          const iconR = outerR + 10;
          const ip = polarXY(midDeg, iconR > MAX_R + 12 ? MAX_R + 12 : iconR);

          return (
            <g
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              style={{ cursor: 'pointer' }}
            >
              {/* Track */}
              <path d={arcPath(startDeg, endDeg, INNER_R, MAX_R)} fill={cat.color} opacity={0.1} />
              {/* Value */}
              <path d={arcPath(startDeg, endDeg, INNER_R, outerR)} fill={cat.color} opacity={0.85} />
              {/* Hover hitbox */}
              <path d={arcPath(startDeg, endDeg, INNER_R, MAX_R)} fill="transparent"
                onMouseEnter={e => { (e.currentTarget as SVGElement).style.opacity = '0.25'; }}
                onMouseLeave={e => { (e.currentTarget as SVGElement).style.opacity = '0'; }}
              />
              {/* Tiny icon near tip — only if segment is tall enough */}
              {outerR - INNER_R > 30 && (
                <text x={ip.x} y={ip.y + 4} textAnchor="middle" fontSize="9">
                  {cat.icon}
                </text>
              )}
            </g>
          );
        })}

        {/* Center */}
        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="#FFFFFF" />
        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="none" stroke="#E2E8F0" strokeWidth={1} />
        <text x={CX} y={CY - 4} textAnchor="middle" fontSize="7" fill="#94A3B8" fontFamily="var(--font-sans)" fontWeight="700">ВСЕ</text>
        <text x={CX} y={CY + 9} textAnchor="middle" fontSize="12" fill="#0B1F3A" fontFamily="var(--font-display)">29</text>
      </svg>

      {/* Legend — 2 columns, sorted by score */}
      <div className="w-full">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3 text-center" style={{ color: '#55667D' }}>
          Нажмите на направление для подробностей
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {sorted.map((cat, rank) => {
            const disp = toDisplay(cat.score);
            return (
              <button
                key={cat.id}
                onClick={() => onSelect(cat.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-left transition-all duration-100 w-full"
                style={{
                  backgroundColor: rank < 3 ? cat.color + '14' : '#FFFFFF',
                  border: `1px solid ${cat.color}25`,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = cat.color + '22'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = rank < 3 ? cat.color + '14' : '#FFFFFF'; }}
              >
                <span style={{ fontSize: '0.85rem', minWidth: '1.25rem', textAlign: 'center' }}>{cat.icon}</span>
                <span className="flex-1 text-xs font-medium truncate" style={{ color: '#12263F' }}>
                  {cat.name}
                </span>
                <span className="text-xs font-bold shrink-0" style={{ color: cat.color }}>
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
