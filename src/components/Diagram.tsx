/**
 * Technical diagrams drawn as plain SVG with a deterministic layout: fixed-size boxes in columns
 * (or rows for a pipeline), so nothing can overlap whatever the number of nodes.
 *  - LayeredDiagram: one column per role (paquets → pages → services → tables → systèmes…), nodes ordered by
 *    barycentre to reduce crossings, links drawn as curves between box edges.
 *  - Pipeline: numbered steps in rows that snake (→ then ←), for the sequences of 07.
 * Every box is a graph node (click = inspector), every link is a graph edge (dashed = [H]).
 */
import { useMemo, useState } from 'react';
import { nodeById } from '../lib/data';
import { FAMILY, REL, TYPE } from '../lib/meta';
import { useInspect } from '../lib/store';
import type { Confidence, Relation } from '../types/graph';
import { cx } from './ui';

export interface DEdge {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  confidence: Confidence;
  label?: string;
}
export interface DColumn {
  title: string;
  ids: string[];
  /** keep the given order (e.g. filters in web.xml order) instead of minimising crossings */
  fixed?: boolean;
}

const BOX_W = 190;
const BOX_H = 34;
const GAP_Y = 10;
const GAP_X = 92;
const PAD = 24;
const HEAD = 34;
const CHAR_W = 6.7; // 12 px Inter, average

const fit = (s: string, w: number) => {
  const max = Math.max(4, Math.floor(w / CHAR_W));
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
};
const colorOf = (id: string) => `var(${FAMILY[TYPE[nodeById.get(id)?.type ?? 'class'].family].cssVar})`;

function Box({ id, x, y, w, h, dim, active, onEnter, onLeave, label, sub, pr = 0 }: { id: string; x: number; y: number; w: number; h: number; dim: boolean; active: boolean; onEnter: () => void; onLeave: () => void; label?: string; sub?: string; pr?: number }) {
  const [, inspect] = useInspect();
  const n = nodeById.get(id);
  const text = label ?? n?.label ?? id;
  return (
    <g className="cursor-pointer" opacity={dim ? 0.28 : 1} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => inspect(id)} style={{ transition: 'opacity 160ms ease' }}>
      <title>{`${text}${n ? ` — ${TYPE[n.type].label}${n.subtype ? ` · ${n.subtype}` : ''}` : ''}`}</title>
      <rect x={x} y={y} width={w} height={h} rx={8} fill="var(--surface)" stroke={active ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={active ? 1.6 : 1} />
      <rect x={x} y={y + 7} width={3} height={h - 14} rx={1.5} fill={colorOf(id)} />
      <text x={x + 12} y={sub ? y + h / 2 - 3 : y + h / 2 + 4} fontSize={12} fill="var(--text)" fontFamily="Inter Variable, system-ui, sans-serif">
        {fit(text, w - 20 - pr)}
      </text>
      {sub && (
        <text x={x + 12} y={y + h / 2 + 12} fontSize={10} fill="var(--muted)" fontFamily="Inter Variable, system-ui, sans-serif">
          {fit(sub, w - 20)}
        </text>
      )}
    </g>
  );
}

export function LayeredDiagram({ columns, edges, ariaLabel, edgeLabels }: { columns: DColumn[]; edges: DEdge[]; ariaLabel: string; edgeLabels?: boolean }) {
  const [hover, setHover] = useState<string | null>(null);
  const cols = columns.filter((c) => c.ids.length);
  // barycentre ordering (2 sweeps) to reduce crossings
  const ordered = useMemo(() => {
    const out = cols.map((c) => [...c.ids]);
    const nb = new Map<string, string[]>();
    for (const e of edges) {
      nb.set(e.source, [...(nb.get(e.source) ?? []), e.target]);
      nb.set(e.target, [...(nb.get(e.target) ?? []), e.source]);
    }
    for (let sweep = 0; sweep < 4; sweep++) {
      const pos = new Map<string, number>();
      out.forEach((c) => c.forEach((id, i) => pos.set(id, i / Math.max(1, c.length - 1))));
      const range = sweep % 2 === 0 ? out.map((_, i) => i).slice(1) : out.map((_, i) => i).reverse().slice(1);
      for (const ci of range) {
        if (cols[ci].fixed) continue;
        const ref = sweep % 2 === 0 ? ci - 1 : ci + 1;
        const refSet = new Set(out[ref] ?? []);
        const bary = (id: string) => {
          const ps = (nb.get(id) ?? []).filter((x) => refSet.has(x)).map((x) => pos.get(x)!);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(id) ?? 0.5;
        };
        out[ci].sort((a, b) => bary(a) - bary(b));
      }
    }
    return out;
  }, [cols.map((c) => c.ids.join(',')).join('|'), edges.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxRows = Math.max(1, ...ordered.map((c) => c.length));
  const colH = (n: number) => n * BOX_H + (n - 1) * GAP_Y;
  const height = PAD * 2 + HEAD + colH(maxRows);
  const width = PAD * 2 + cols.length * BOX_W + (cols.length - 1) * GAP_X;
  const at = new Map<string, { x: number; y: number; col: number }>();
  ordered.forEach((c, ci) => {
    const top = PAD + HEAD + (colH(maxRows) - colH(c.length)) / 2;
    c.forEach((id, i) => at.set(id, { x: PAD + ci * (BOX_W + GAP_X), y: top + i * (BOX_H + GAP_Y), col: ci }));
  });
  // links inside one column (package nesting…) would pile up on the column edge: not drawn
  const shown = edges.filter((e) => at.has(e.source) && at.has(e.target) && e.source !== e.target && at.get(e.source)!.col !== at.get(e.target)!.col);
  const linked = (id: string) => !hover || id === hover || shown.some((e) => (e.source === hover && e.target === id) || (e.target === hover && e.source === id));

  return (
    <div className="overflow-auto rounded-xl">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="select-none">
        <defs>
          <marker id="dg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--muted)" />
          </marker>
          <marker id="dg-arrow-hl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {cols.map((c, ci) => (
          <text key={c.title} x={PAD + ci * (BOX_W + GAP_X)} y={PAD + 12} fontSize={10.5} fontWeight={650} letterSpacing="0.12em" fill="var(--muted)">
            {c.title.toUpperCase()} · {c.ids.length}
          </text>
        ))}
        {shown.map((e) => {
          const a = at.get(e.source)!;
          const b = at.get(e.target)!;
          const same = a.col === b.col;
          const [l, r] = a.col <= b.col ? [a, b] : [b, a];
          const x1 = same ? l.x + BOX_W : l.x + BOX_W;
          const y1 = l.y + BOX_H / 2;
          const x2 = same ? r.x + BOX_W : r.x;
          const y2 = r.y + BOX_H / 2;
          const d = same ? `M${x1} ${y1} C ${x1 + 46} ${y1}, ${x2 + 46} ${y2}, ${x2} ${y2}` : `M${x1} ${y1} C ${x1 + GAP_X / 2} ${y1}, ${x2 - GAP_X / 2} ${y2}, ${x2} ${y2}`;
          const hl = !!hover && (e.source === hover || e.target === hover);
          const forward = at.get(e.source)!.col <= at.get(e.target)!.col;
          const style = REL[e.relation].style;
          const dash = e.confidence === 'H' ? '4 4' : style === 'dashed' ? '6 3' : style === 'dotted' ? '1.5 3' : undefined;
          return (
            <g key={e.id} opacity={hover && !hl ? 0.12 : 1} style={{ transition: 'opacity 160ms ease' }}>
              <path d={d} fill="none" stroke={hl ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={hl ? 1.8 : 1.2} strokeDasharray={dash} markerEnd={REL[e.relation].arrow && forward ? `url(#${hl ? 'dg-arrow-hl' : 'dg-arrow'})` : undefined} markerStart={REL[e.relation].arrow && !forward ? `url(#${hl ? 'dg-arrow-hl' : 'dg-arrow'})` : undefined}>
                <title>{`${nodeById.get(e.source)?.label} ${REL[e.relation].label} ${nodeById.get(e.target)?.label} [${e.confidence}]`}</title>
              </path>
              {edgeLabels && e.label && (
                <g>
                  {/* next to the arrowhead: labels of a fan-out never stack */}
                  <rect x={x2 - 52} y={y2 - 21} width={32} height={15} rx={4} fill="var(--surface)" stroke="var(--border)" />
                  <text x={x2 - 36} y={y2 - 10} fontSize={10} textAnchor="middle" fill="var(--text-2)" fontFamily="JetBrains Mono, monospace">
                    {e.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        {[...at.entries()].map(([id, p]) => (
          <Box key={id} id={id} x={p.x} y={p.y} w={BOX_W} h={BOX_H} dim={!linked(id)} active={hover === id} onEnter={() => setHover(id)} onLeave={() => setHover(null)} />
        ))}
      </svg>
    </div>
  );
}

export interface PStep {
  id: string;
  label: string;
  sub?: string;
}

/** Numbered steps in rows of `perRow`, snaking left→right then right→left. */
export function Pipeline({ steps, perRow = 4, ariaLabel }: { steps: PStep[]; perRow?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<string | null>(null);
  const W = 230;
  const H = 52;
  const GX = 54;
  const GY = 46;
  const rows = Math.ceil(steps.length / perRow);
  const width = PAD * 2 + perRow * W + (perRow - 1) * GX;
  const height = PAD * 2 + rows * H + (rows - 1) * GY;
  const pos = steps.map((_, i) => {
    const r = Math.floor(i / perRow);
    const k = i % perRow;
    const c = r % 2 === 0 ? k : perRow - 1 - k;
    return { x: PAD + c * (W + GX), y: PAD + r * (H + GY) };
  });
  return (
    <div className="overflow-auto rounded-xl">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="select-none">
        <defs>
          <marker id="pl-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
          </marker>
        </defs>
        {pos.slice(1).map((b, i) => {
          const a = pos[i];
          const sameRow = a.y === b.y;
          const d = sameRow
            ? a.x < b.x
              ? `M${a.x + W} ${a.y + H / 2} L ${b.x - 2} ${b.y + H / 2}`
              : `M${a.x} ${a.y + H / 2} L ${b.x + W + 2} ${b.y + H / 2}`
            : `M${a.x + W / 2} ${a.y + H} L ${b.x + W / 2} ${b.y - 2}`;
          return <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth={1.6} markerEnd="url(#pl-arrow)" opacity={0.75} />;
        })}
        {steps.map((s, i) => (
          <g key={s.id}>
            <Box id={s.id} x={pos[i].x} y={pos[i].y} w={W} h={H} dim={!!hover && hover !== s.id} active={hover === s.id} onEnter={() => setHover(s.id)} onLeave={() => setHover(null)} label={s.label} sub={s.sub} pr={22} />
            <circle cx={pos[i].x + W - 14} cy={pos[i].y + 14} r={9} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1} className="pointer-events-none" />
            <text x={pos[i].x + W - 14} y={pos[i].y + 17.5} fontSize={9.5} fontWeight={650} textAnchor="middle" fill="var(--accent-2)" className="pointer-events-none">
              {i + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

export function DiagramLegend({ className }: { className?: string }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted', className)}>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden>
          <line x1="1" y1="4" x2="21" y2="4" stroke="var(--border-strong)" strokeWidth="1.4" />
        </svg>
        relation écrite
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="22" height="8" aria-hidden>
          <line x1="1" y1="4" x2="21" y2="4" stroke="var(--border-strong)" strokeWidth="1.4" strokeDasharray="4 4" />
        </svg>
        [H] ou relation faible
      </span>
      <span>survol = liens du nœud · clic = provenance</span>
    </div>
  );
}
