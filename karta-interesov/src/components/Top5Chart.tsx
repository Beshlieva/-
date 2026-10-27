import { CATEGORIES, toDisplay } from '../data/questions';

interface Top5ChartProps {
  scores: Record<number, number>;
}

const PALETTE = [
  { fill: '#3B7DD8', light: '#DBEAFE' },
  { fill: '#F59E0B', light: '#FEF3C7' },
  { fill: '#22A367', light: '#D1FAE5' },
  { fill: '#E05BAA', light: '#FCE7F3' },
  { fill: '#7C5CE8', light: '#EDE9FE' },
];

// Canvas — wide to give labels room on both sides
const VW = 780;
const VH = 600;
const CX = VW / 2;   // 390
const CY = VH / 2;   // 300
const INNER_R = 30;
const MAX_R   = 155;
const GAP_DEG = 3;

function toRad(deg: number) { return (deg * Math.PI) / 180; }
function polarXY(angleDeg: number, r: number) {
  const rad = toRad(angleDeg - 90); // 0° = top
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}
function arcPath(s: number, e: number, r1: number, r2: number) {
  const p1 = polarXY(s, r1), p2 = polarXY(e, r1);
  const p3 = polarXY(s, r2), p4 = polarXY(e, r2);
  const lg = e - s > 180 ? 1 : 0;
  return `M${p1.x.toFixed(1)} ${p1.y.toFixed(1)} A${r1} ${r1} 0 ${lg} 1 ${p2.x.toFixed(1)} ${p2.y.toFixed(1)} L${p4.x.toFixed(1)} ${p4.y.toFixed(1)} A${r2} ${r2} 0 ${lg} 0 ${p3.x.toFixed(1)} ${p3.y.toFixed(1)} Z`;
}
// score (−12..+12) → radius
function scoreToR(s: number) { return INNER_R + ((s + 12) / 24) * (MAX_R - INNER_R); }

export default function Top5Chart({ scores }: Top5ChartProps) {
  const top5 = CATEGORIES
    .map(cat => ({ ...cat, score: scores[cat.id] ?? 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const SLICE = 360 / top5.length; // 72°

  // Guide rings at 0, 25, 50, 75, 100 pts (display scale)
  const RING_PTS = [25, 50, 75, 100];
  const ringRawFromPct = (pt: number) => (pt / 100) * 24 - 12;

  return (
    <div className="flex flex-col items-center gap-6 w-full">
      <svg
        viewBox={`0 0 ${VW} ${VH}`}
        width="100%"
        style={{ maxWidth: '100%', aspectRatio: `${VW}/${VH}`, overflow: 'visible' }}
        aria-label="Топ-5 профессиональных направлений"
      >
        {/* Guide rings */}
        {RING_PTS.map(pt => {
          const r = scoreToR(ringRawFromPct(pt));
          const labelPos = polarXY(-1, r); // near top
          return (
            <g key={pt}>
              <circle cx={CX} cy={CY} r={r} fill="none" stroke="#CBD5E1" strokeWidth={0.8} strokeDasharray="5 4" />
              <text x={labelPos.x - 4} y={labelPos.y + 3} textAnchor="end" fontSize="9" fill="#94A3B8" fontFamily="var(--font-sans)" fontWeight="600">
                {pt}
              </text>
            </g>
          );
        })}

        {/* Segments */}
        {top5.map((cat, i) => {
          const startDeg = i * SLICE + GAP_DEG / 2;
          const endDeg   = (i + 1) * SLICE - GAP_DEG / 2;
          const midDeg   = i * SLICE + SLICE / 2;
          const outerR   = scoreToR(Math.max(cat.score, -11));
          const { fill, light } = PALETTE[i];
          const disp = toDisplay(cat.score);

          // Label position — far enough out so full text fits
          const LABEL_R = MAX_R + 42;
          const ICON_R  = MAX_R + 60;
          const lp = polarXY(midDeg, LABEL_R);
          const ip = polarXY(midDeg, ICON_R);

          // Text anchor based on quadrant
          const norm = ((midDeg % 360) + 360) % 360;
          const anchor =
            norm < 25 || norm > 335 ? 'middle' :
            norm >= 25 && norm < 155 ? 'start' :
            norm >= 155 && norm < 205 ? 'middle' : 'end';

          // Score label position inside segment
          const scoreR = INNER_R + (outerR - INNER_R) * 0.6;
          const sp = polarXY(midDeg, scoreR);

          // Connector tip → outer ring
          const tip  = polarXY(midDeg, outerR + 4);
          const conn = polarXY(midDeg, MAX_R + 10);

          return (
            <g key={cat.id}>
              {/* Track */}
              <path d={arcPath(startDeg, endDeg, INNER_R, MAX_R)} fill={light} opacity={0.55} />
              {/* Value */}
              <path d={arcPath(startDeg, endDeg, INNER_R, outerR)} fill={fill} opacity={0.92} />
              <path d={arcPath(startDeg, endDeg, INNER_R, outerR)} fill="none" stroke={fill} strokeWidth={1.2} opacity={0.5} />

              {/* Score inside */}
              {outerR - INNER_R > 22 && (
                <text x={sp.x} y={sp.y + 4} textAnchor="middle" fontSize="12" fontWeight="800" fill="white" fontFamily="var(--font-sans)">
                  {disp}
                </text>
              )}

              {/* Connector */}
              <line x1={tip.x} y1={tip.y} x2={conn.x} y2={conn.y} stroke={fill} strokeWidth={1} opacity={0.4} />

              {/* Label — full name, no truncation */}
              <text x={lp.x} y={lp.y} textAnchor={anchor} fontSize="11.5" fontWeight="700" fill={fill} fontFamily="var(--font-sans)">
                {cat.name}
              </text>
              {/* Icon */}
              <text x={ip.x} y={ip.y + 5} textAnchor={anchor} fontSize="14">
                {cat.icon}
              </text>
            </g>
          );
        })}

        {/* Center */}
        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="#FFFFFF" />
        <circle cx={CX} cy={CY} r={INNER_R - 2} fill="none" stroke="#E2E8F0" strokeWidth={1} />
        <text x={CX} y={CY - 5} textAnchor="middle" fontSize="9" fill="#94A3B8" fontFamily="var(--font-sans)" fontWeight="600">ТОП</text>
        <text x={CX} y={CY + 11} textAnchor="middle" fontSize="16" fill="#0B1F3A" fontFamily="var(--font-display)">5</text>
      </svg>

      {/* Legend */}
      <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
        {top5.map((cat, i) => {
          const { fill, light } = PALETTE[i];
          return (
            <div key={cat.id} className="flex items-center gap-3 px-4 py-2.5 rounded-xl"
              style={{ backgroundColor: light, border: `1.5px solid ${fill}30` }}>
              <span className="text-base shrink-0">{cat.icon}</span>
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: fill }} />
              <span className="text-sm font-semibold flex-1" style={{ color: '#0B1F3A' }}>{cat.name}</span>
              <span className="text-sm font-bold" style={{ color: fill, fontFamily: 'var(--font-display)' }}>
                {toDisplay(cat.score)} б.
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
