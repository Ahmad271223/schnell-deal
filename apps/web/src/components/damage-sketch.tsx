'use client';

import clsx from 'clsx';
import { DAMAGE_ZONE_LABELS, type DamageZone } from '@sd/shared';

type Shape = { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number } | { kind: 'poly'; points: string };

/** Draufsicht, Fahrzeugfront oben. Linke Fahrzeugseite = linke Bildseite. */
const SHAPES: Partial<Record<DamageZone, Shape>> = {
  FRONT_BUMPER: { kind: 'rect', x: 80, y: 10, w: 140, h: 28, rx: 14 },
  HEADLIGHT_LEFT: { kind: 'rect', x: 84, y: 40, w: 40, h: 14, rx: 4 },
  HEADLIGHT_RIGHT: { kind: 'rect', x: 176, y: 40, w: 40, h: 14, rx: 4 },
  HOOD: { kind: 'rect', x: 86, y: 56, w: 128, h: 92, rx: 6 },
  WINDSHIELD: { kind: 'poly', points: '92,150 208,150 198,190 102,190' },
  ROOF: { kind: 'rect', x: 102, y: 192, w: 96, h: 150, rx: 6 },
  REAR_WINDOW: { kind: 'poly', points: '102,344 198,344 208,380 92,380' },
  TRUNK_LID: { kind: 'rect', x: 86, y: 382, w: 128, h: 80, rx: 6 },
  TAILLIGHT_LEFT: { kind: 'rect', x: 84, y: 464, w: 40, h: 14, rx: 4 },
  TAILLIGHT_RIGHT: { kind: 'rect', x: 176, y: 464, w: 40, h: 14, rx: 4 },
  REAR_BUMPER: { kind: 'rect', x: 80, y: 480, w: 140, h: 28, rx: 14 },
  FENDER_FL: { kind: 'rect', x: 56, y: 56, w: 28, h: 92, rx: 6 },
  FENDER_FR: { kind: 'rect', x: 216, y: 56, w: 28, h: 92, rx: 6 },
  DOOR_FL: { kind: 'rect', x: 56, y: 150, w: 28, h: 100, rx: 4 },
  DOOR_FR: { kind: 'rect', x: 216, y: 150, w: 28, h: 100, rx: 4 },
  DOOR_RL: { kind: 'rect', x: 56, y: 252, w: 28, h: 100, rx: 4 },
  DOOR_RR: { kind: 'rect', x: 216, y: 252, w: 28, h: 100, rx: 4 },
  QUARTER_RL: { kind: 'rect', x: 56, y: 354, w: 28, h: 108, rx: 6 },
  QUARTER_RR: { kind: 'rect', x: 216, y: 354, w: 28, h: 108, rx: 6 },
  SILL_LEFT: { kind: 'rect', x: 42, y: 180, w: 12, h: 170, rx: 3 },
  SILL_RIGHT: { kind: 'rect', x: 246, y: 180, w: 12, h: 170, rx: 3 },
  MIRROR_LEFT: { kind: 'rect', x: 26, y: 154, w: 26, h: 20, rx: 6 },
  MIRROR_RIGHT: { kind: 'rect', x: 248, y: 154, w: 26, h: 20, rx: 6 },
  WHEEL_FL: { kind: 'rect', x: 22, y: 76, w: 18, h: 50, rx: 5 },
  WHEEL_FR: { kind: 'rect', x: 260, y: 76, w: 18, h: 50, rx: 5 },
  WHEEL_RL: { kind: 'rect', x: 22, y: 388, w: 18, h: 50, rx: 5 },
  WHEEL_RR: { kind: 'rect', x: 260, y: 388, w: 18, h: 50, rx: 5 },
};

const OTHER_ZONES: DamageZone[] = ['INTERIOR_FRONT', 'INTERIOR_REAR', 'ENGINE', 'UNDERBODY', 'OTHER'];

export function DamageSketch({
  counts,
  selected,
  onSelect,
  readOnly,
}: {
  counts: Partial<Record<DamageZone, number>>;
  selected?: DamageZone | null;
  onSelect?: (zone: DamageZone) => void;
  readOnly?: boolean;
}) {
  const entries = Object.entries(SHAPES) as [DamageZone, Shape][];
  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox="0 0 300 518" className="h-auto w-full max-w-[320px]" role="group" aria-label="Fahrzeugskizze, Front oben">
        <text x="150" y="8" textAnchor="middle" fontSize="8" fill="#64748b">VORNE</text>
        {entries.map(([zone, s]) => {
          const n = counts[zone] ?? 0;
          const isSel = selected === zone;
          const common = {
            className: clsx(!readOnly && 'cursor-pointer outline-none', 'transition-colors'),
            fill: isSel ? '#dc2626' : n > 0 ? '#fecaca' : '#e2e8f0',
            stroke: isSel ? '#991b1b' : n > 0 ? '#b91c1c' : '#94a3b8',
            strokeWidth: isSel || n > 0 ? 2 : 1,
          };
          const label = `${DAMAGE_ZONE_LABELS[zone]}${n ? `, ${n} Schaden/Schäden erfasst` : ''}`;
          const handlers = readOnly
            ? {}
            : {
                role: 'button',
                tabIndex: 0,
                onClick: () => onSelect?.(zone),
                onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onSelect?.(zone)),
              };
          const center = s.kind === 'rect' ? { x: s.x + s.w / 2, y: s.y + s.h / 2 } : null;
          return (
            <g key={zone} aria-label={label} {...handlers}>
              <title>{label}</title>
              {s.kind === 'rect' ? <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} {...common} /> : <polygon points={s.points} {...common} />}
              {n > 0 && center && (
                <text x={center.x} y={center.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#7f1d1d" pointerEvents="none">
                  {n}
                </text>
              )}
            </g>
          );
        })}
        <text x="150" y="516" textAnchor="middle" fontSize="8" fill="#64748b">HINTEN</text>
      </svg>
      <div className="flex flex-wrap justify-center gap-2">
        {OTHER_ZONES.map((zone) => {
          const n = counts[zone] ?? 0;
          return (
            <button
              key={zone}
              type="button"
              disabled={readOnly}
              onClick={() => onSelect?.(zone)}
              className={clsx(
                'rounded-full border px-3 py-1.5 text-xs font-medium',
                selected === zone ? 'border-brand-700 bg-brand-600 text-white' : n > 0 ? 'border-red-400 bg-red-50 text-red-800' : 'border-slate-300 bg-white text-slate-700',
              )}
            >
              {DAMAGE_ZONE_LABELS[zone]}
              {n > 0 && ` (${n})`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
