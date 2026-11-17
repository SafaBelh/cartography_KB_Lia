import { motion } from 'framer-motion';
import { CircleHelp, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { sourceLoaded } from '../lib/data';
import { CONF, ISSUE_CAT, TYPE, FAMILY } from '../lib/meta';
import type { Confidence, NodeType } from '../types/graph';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

const CONF_ICON = { V: ShieldCheck, H: CircleHelp };
export function ConfidenceBadge({ c, compact, from }: { c: Confidence; compact?: boolean; from?: string }) {
  const Icon = CONF_ICON[c];
  const fallback = from === 'fallback';
  // without the source, a [V] is the doc's claim, not something this tool re-verified
  const long = c === 'V' && !sourceLoaded ? 'Vérifié dans le code (selon la doc)' : CONF[c].long;
  return (
    <span
      title={`${long}${fallback ? ' — non étiqueté dans la doc, traité comme hypothèse' : ''}`}
      className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none"
      style={{ color: CONF[c].color, borderColor: `color-mix(in oklab, ${CONF[c].color} 35%, transparent)`, background: `color-mix(in oklab, ${CONF[c].color} 10%, transparent)` }}
    >
      <Icon size={11} strokeWidth={2.2} />
      <span className="font-mono">[{c}]</span>
      {!compact && <span className="text-fg-2">{fallback ? 'non étiqueté' : long}</span>}
    </span>
  );
}

/** Issue category of doc 10 (Bug, Sécurité, Secret, Dette…) — the LiaWeb docs have no severity scale. */
export function CategoryBadge({ cat, statut }: { cat?: string; statut?: string }) {
  if (!cat) return null;
  const m = ISSUE_CAT[cat] ?? { label: cat, color: 'var(--muted)' };
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-medium" style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 12%, transparent)` }}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: m.color }} />
      {m.label}
      {statut && statut !== 'constat' && <span className="text-fg-2">· {statut}</span>}
    </span>
  );
}

/** Small shape+color glyph identifying a node type (color is never the only cue: shape + legend + label). */
export function TypeGlyph({ type, size = 10 }: { type: NodeType; size?: number }) {
  const color = `var(${FAMILY[TYPE[type].family].cssVar})`;
  const s = size;
  const shape = TYPE[type].shape;
  let el: ReactNode;
  if (shape.includes('triangle')) el = <polygon points={`${s / 2},1 ${s - 1},${s - 1} 1,${s - 1}`} fill={color} />;
  else if (shape.includes('diamond') || shape === 'rhomboid') el = <polygon points={`${s / 2},0.5 ${s - 0.5},${s / 2} ${s / 2},${s - 0.5} 0.5,${s / 2}`} fill={color} />;
  else if (shape.includes('hexagon') || shape.includes('octagon') || shape.includes('pentagon'))
    el = <polygon points={`${s * 0.25},1 ${s * 0.75},1 ${s - 0.5},${s / 2} ${s * 0.75},${s - 1} ${s * 0.25},${s - 1} 0.5,${s / 2}`} fill={color} />;
  else if (shape === 'star') el = <polygon points={`${s / 2},0 ${s * 0.62},${s * 0.38} ${s},${s * 0.4} ${s * 0.7},${s * 0.62} ${s * 0.8},${s} ${s / 2},${s * 0.78} ${s * 0.2},${s} ${s * 0.3},${s * 0.62} 0,${s * 0.4} ${s * 0.38},${s * 0.38}`} fill={color} />;
  else if (shape === 'ellipse') el = <circle cx={s / 2} cy={s / 2} r={s / 2 - 0.5} fill={color} />;
  else if (shape === 'vee') el = <polygon points={`0.5,1 ${s / 2},${s * 0.45} ${s - 0.5},1 ${s / 2},${s - 0.5}`} fill={color} />;
  else el = <rect x={0.5} y={1.5} width={s - 1} height={s - 3} rx={shape.startsWith('round') || shape === 'barrel' ? 2.5 : 0.8} fill={color} />;
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} className="shrink-0" aria-hidden>
      {el}
    </svg>
  );
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('panel rounded-2xl', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children, right }: { eyebrow?: string; title: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">{eyebrow}</div>}
        <h2 className="text-[22px] font-semibold tracking-tight text-fg">{title}</h2>
        {children && <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-fg-2">{children}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</div>
      <div className="text-[14px] font-medium text-fg">{title}</div>
      {children && <div className="min-w-0 max-w-full text-[13px] leading-relaxed text-fg-2 [overflow-wrap:anywhere] sm:max-w-md">{children}</div>}
    </motion.div>
  );
}

export function Pill({ active, onClick, children, title }: { active?: boolean; onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
        active ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export function IconButton({ onClick, title, children, active, className }: { onClick?: () => void; title: string; children: ReactNode; active?: boolean; className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        'grid h-8 w-8 place-items-center rounded-lg border transition-colors',
        active ? 'border-transparent bg-accent-soft text-accent' : 'border-line text-fg-2 hover:border-line-strong hover:bg-surface-2 hover:text-fg',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Meter({ value, max, color = 'var(--accent)' }: { value: number; max: number; color?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
    </div>
  );
}
