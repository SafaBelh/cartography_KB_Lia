import cytoscape, { type Core, type ElementDefinition, type StylesheetJson } from 'cytoscape';
import { motion } from 'framer-motion';
import { Magnet, Maximize2, MousePointerClick, RefreshCcw } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, Empty, cx } from '../components/ui';
import { inEdges, nodeById, nodesOf, outEdges } from '../lib/data';
import { EASE, RENDER_OPTS, ensureCy, exportCy, graphStyle, watchSize, zoomInSnapshot } from '../lib/cy';
import { REL } from '../lib/meta';
import { attachDragPhysics, usePhysicsPref } from '../lib/physics';
import { useStore } from '../lib/store';
import type { GEdge, GNode } from '../types/graph';
import { DocRef } from './Workflows';

const lifecycles = nodesOf('lifecycle').sort((a, b) => Number(b.props.etats) - Number(a.props.etats) || a.label.localeCompare(b.label));

interface Model {
  states: GNode[];
  transitions: GEdge[];
  setters: { node: GNode; edges: GEdge[] }[];
  risks: { node: GNode; edges: GEdge[] }[];
}

function modelOf(lcId: string): Model {
  const states = (inEdges.get(lcId) ?? [])
    .filter((e) => e.relation === 'part-of')
    .map((e) => nodeById.get(e.source)!)
    .filter((n) => n?.type === 'state')
    .sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre));
  const ids = new Set(states.map((s) => s.id));
  const transitions = states.flatMap((s) => (outEdges.get(s.id) ?? []).filter((e) => e.relation === 'transition' && ids.has(e.target)));
  const by = (rel: string[], types: string[]) => {
    const m = new Map<string, GEdge[]>();
    for (const s of states) for (const e of inEdges.get(s.id) ?? []) {
      const src = nodeById.get(e.source);
      if (!src || !rel.includes(e.relation) || !types.includes(src.type)) continue;
      m.set(src.id, [...(m.get(src.id) ?? []), e]);
    }
    return [...m.entries()].map(([id, edges]) => ({ node: nodeById.get(id)!, edges }));
  };
  return { states, transitions, setters: by(['sets-state'], ['page', 'service', 'class', 'actCode']), risks: by(['affects', 'mentions'], ['issue', 'question', 'term']) };
}

const extraStyle = (theme: 'light' | 'dark'): StylesheetJson =>
  [
    { selector: 'edge[rel = "transition"][label != ""]', style: { label: 'data(label)', 'font-family': 'JetBrains Mono, ui-monospace, monospace', 'font-size': 9.5, color: theme === 'dark' ? '#c9d1dc' : '#334155', 'text-rotation': 'autorotate', 'text-margin-y': -9, 'text-background-color': theme === 'dark' ? '#121212' : '#fafafa', 'text-background-opacity': 1, 'text-background-padding': '2px' } },
    { selector: 'node[type = "state"]', style: { 'text-wrap': 'wrap', 'text-max-width': '150px', 'font-family': 'Inter Variable, system-ui, sans-serif', 'font-size': 11.5, 'min-zoomed-font-size': 3 } },
    { selector: 'node[type != "state"]', style: { 'text-wrap': 'wrap', 'text-max-width': '140px', 'font-size': 10, 'min-zoomed-font-size': 3 } },
    { selector: 'edge[rel = "transition"]', style: { 'curve-style': 'bezier', 'control-point-step-size': 60 } },
  ] as StylesheetJson;

/** States on one row (doc order), setters above, issues / questions / terms below. Nothing is placed by a force layout. */
function placeRows(cy: Core, m: Model) {
  const GAP = 200;
  const xOf = new Map<string, number>();
  m.states.forEach((s, i) => {
    xOf.set(s.id, i * GAP);
    cy.getElementById(s.id).position({ x: i * GAP, y: 0 });
  });
  const row = (items: { node: GNode; edges: GEdge[] }[], y: number, key: 'target' | 'target2') => {
    const pos = items
      .map((it) => {
        const xs = it.edges.map((e) => xOf.get(key === 'target' ? e.target : e.target) ?? 0);
        return { id: it.node.id, x: xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length) };
      })
      .sort((a, b) => a.x - b.x);
    let last = -Infinity;
    for (const p of pos) {
      const x = Math.max(p.x, last + 170);
      last = x;
      cy.getElementById(p.id).position({ x, y });
    }
  };
  row(m.setters, -170, 'target');
  row(m.risks, 170, 'target');
}

export default function Lifecycles() {
  const [params, setParams] = useSearchParams();
  const lcId = params.get('lc') && nodeById.has(params.get('lc')!) ? params.get('lc')! : lifecycles[0]?.id;
  const selected = params.get('n');
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [physics, setPhysics] = usePhysicsPref();
  const physicsRef = useRef<ReturnType<typeof attachDragPhysics> | null>(null);
  const lc = lcId ? nodeById.get(lcId) : undefined;
  const m = useMemo(() => (lcId ? modelOf(lcId) : null), [lcId]);

  const elements = useMemo<ElementDefinition[]>(() => {
    if (!m) return [];
    const els: ElementDefinition[] = [];
    const conf = (c: string) => store.confidence.has(c as 'V');
    for (const s of m.states) els.push({ data: { id: s.id, label: s.label, type: 'state', conf: s.confidence, size: 30, hub: false } });
    for (const it of [...m.setters, ...m.risks]) {
      const ok = it.edges.filter((e) => conf(e.confidence));
      if (!ok.length) continue;
      const label = it.node.type === 'issue' || it.node.type === 'question' ? it.node.label.split(' · ')[0] : it.node.label;
      els.push({ data: { id: it.node.id, label, type: it.node.type, conf: it.node.confidence, size: 20 } });
      for (const e of ok) els.push({ data: { id: e.id, source: e.source, target: e.target, rel: e.relation, conf: e.confidence, w: REL[e.relation].weight } });
    }
    for (const e of m.transitions) if (conf(e.confidence)) els.push({ data: { id: e.id, source: e.source, target: e.target, rel: 'transition', conf: e.confidence, w: 2, label: e.label ?? '' } });
    return els;
  }, [m, store.confidence]);

  useEffect(() => {
    ensureCy();
    const cy = cytoscape({ container: ref.current!, style: [...(graphStyle(store.theme, { minZoomedFont: 3, fontSize: 11 }) as object[]), ...(extraStyle(store.theme) as object[])] as StylesheetJson, minZoom: 0.2, maxZoom: 3, ...RENDER_OPTS, boxSelectionEnabled: false });
    cyRef.current = cy;
    const unwatch = watchSize(cy, ref.current!, () => cy.fit(undefined, 50));
    const unsnap = zoomInSnapshot(cy);
    // states keep their doc order: only setters and risks follow a dragged neighbour
    physicsRef.current = attachDragPhysics(cy, physics, { pinned: (n) => n.data('type') === 'state' });
    cy.on('tap', 'node', (e) => {
      const id = e.target.id() as string;
      setParams((p) => (p.set('n', id), p));
    });
    cy.on('mouseover', 'node', (e) => void e.target.addClass('hover'));
    cy.on('mouseout', 'node', (e) => void e.target.removeClass('hover'));
    store.exporter.current = { png: () => exportCy(cy, 'png', `cycle-${lcId}`, store.theme), svg: () => exportCy(cy, 'svg', `cycle-${lcId}`, store.theme) };
    return () => {
      unwatch();
      unsnap();
      physicsRef.current?.destroy();
      physicsRef.current = null;
      store.exporter.current = null;
      cy.destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => physicsRef.current?.setEnabled(physics), [physics]);
  useEffect(() => {
    cyRef.current?.style([...(graphStyle(store.theme, { minZoomedFont: 3, fontSize: 11 }) as object[]), ...(extraStyle(store.theme) as object[])] as StylesheetJson);
  }, [store.theme]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !m) return;
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
    placeRows(cy, m);
    cy.stop(true).animate({ fit: { eles: cy.elements(), padding: 50 }, duration: 450, easing: EASE });
  }, [elements]); // eslint-disable-line react-hooks/exhaustive-deps

  // selection: highlight only, no relayout
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const n = selected ? cy.getElementById(selected) : cy.collection();
    cy.batch(() => {
      cy.elements().removeClass('hl');
      if (n.nonempty()) {
        n.addClass('hl');
        n.connectedEdges().addClass('hl');
      }
    });
  }, [selected, elements]);

  if (!lc || !m) return <Empty icon={<RefreshCcw size={18} />} title="Aucun cycle de vie extrait" />;
  const explicit = m.transitions.filter((t) => !t.provenance.every((p) => p.method.includes('inferred'))).length;

  return (
    <div className="flex h-full min-h-[600px] flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1">
          {lifecycles.map((l) => (
            <button key={l.id} onClick={() => setParams((p) => (p.set('lc', l.id), p.delete('n'), p))} className={cx('rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors', l.id === lc.id ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}>
              {l.label} <span className="ml-1 text-[10.5px] text-muted tnum">{String(l.props.etats)}</span>
            </button>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11.5px] text-muted">
          <MousePointerClick size={13} /> clic = inspecter
          <button onClick={() => setPhysics(!physics)} aria-pressed={physics} title="Physique : en glissant un nœud, ses voisins le suivent élastiquement (les états restent dans l’ordre de la doc)" className={cx('ml-2 inline-flex h-7 items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium', physics ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:text-fg')}>
            <Magnet size={13} /> Physique
          </button>
          <button onClick={() => cyRef.current?.stop(true).animate({ fit: { eles: cyRef.current.elements(), padding: 50 }, duration: 550, easing: EASE })} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-fg-2 hover:text-fg" title="Tout afficher">
            <Maximize2 size={13} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[320px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-line px-4 py-4 xl:flex" data-noexport="1">
          <Card className="p-4">
            <div className="mb-1 flex items-center gap-2">
              <span className="min-w-0 flex-1 text-[14px] font-semibold text-fg">{lc.label}</span>
              <ConfidenceBadge c={lc.confidence} compact from={lc.provenance[0]?.confidenceFrom} />
            </div>
            {typeof lc.props.colonne === 'string' && <div className="mb-1 font-mono text-[11.5px] text-muted [overflow-wrap:anywhere]">stocké dans {lc.props.colonne}</div>}
            <div className="mb-2 text-[12px] text-fg-2">
              {m.states.length} états · {explicit} transition(s) écrite(s) · {m.transitions.length - explicit} déduite(s) [H] · {m.setters.length} acteur(s)
            </div>
            {lc.description && <p className="mb-2 rounded-lg bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-2.5 py-2 text-[12px] leading-snug text-fg-2">{lc.description}</p>}
            <DocRef n={lc} />
          </Card>
          <div>
            <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">États (ordre de la doc)</div>
            <div className="flex flex-col gap-1.5">
              {m.states.map((s) => (
                <div key={s.id} className="flex min-w-0 items-center gap-2">
                  <NodeChip id={s.id} />
                  {s.description && s.description !== s.label && !s.label.endsWith(s.description) && <span className="min-w-0 truncate text-[11.5px] text-muted" title={s.description}>{s.description}</span>}
                  <span className="ml-auto shrink-0">
                    <ConfidenceBadge c={s.confidence} compact from={s.provenance[0]?.confidenceFrom} />
                  </span>
                </div>
              ))}
            </div>
          </div>
          {m.setters.length > 0 && (
            <div>
              <div className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Qui positionne l’état</div>
              <div className="flex flex-col gap-2">
                {m.setters.map((it) =>
                  it.edges.map((e) => (
                    <div key={e.id} className="rounded-lg border border-line p-2 text-[11.5px] leading-snug text-fg-2">
                      <div className="mb-1 flex flex-wrap items-center gap-1">
                        <NodeChip id={e.source} compact /> → <NodeChip id={e.target} compact />
                      </div>
                      <span className="[overflow-wrap:anywhere]">{e.label}</span>
                    </div>
                  )),
                )}
              </div>
            </div>
          )}
          {m.states.length > 0 && m.transitions.length === 0 && <p className="px-1 text-[11.5px] leading-relaxed text-muted">La doc ne décrit aucune transition entre ces états : ils sont affichés dans l’ordre du tableau, sans flèche.</p>}
        </aside>
        <motion.div key={lc.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative min-w-0 flex-1">
          <div className="dot-grid absolute inset-0 overflow-hidden [contain:strict]">
            <div ref={ref} className="h-full w-full overflow-hidden" role="img" aria-label={`Cycle de vie : ${lc.label}`} />
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-3 py-2 text-[11px] text-fg-2" data-noexport="1">
            <span>— transition écrite [V/H]</span>
            <span>- - - ordre du tableau [H] ou « positionne »</span>
            <span>en haut : classes / actes · en bas : problèmes, questions</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
