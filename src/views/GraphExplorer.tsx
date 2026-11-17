import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleDot, Crosshair, Focus, Magnet, Maximize2, Minus, Plus, Route, Search, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { NodePicker } from '../components/NodePicker';
import { ConfidenceBadge, Pill, TypeGlyph, cx } from '../components/ui';
import { PATH_EXAMPLE, communities, community, degree, graph, neighborhood, nodeById, passesDomain, shortestPath } from '../lib/data';
import { EASE, RENDER_OPTS, ensureCy, exportCy, graphStyle, multiEdgeKeys, pairKey, watchSize, zoomInSnapshot } from '../lib/cy';
import { FAMILY, REL, TYPE, TYPE_ORDER } from '../lib/meta';
import { attachDragPhysics, usePhysicsPref } from '../lib/physics';
import { download, useStore } from '../lib/store';
import type { GEdge, NodeType, Relation } from '../types/graph';

type LayoutName = 'fcose' | 'dagre' | 'concentric' | 'breadthfirst';
const LAYOUTS: { id: LayoutName; label: string }[] = [
  { id: 'fcose', label: 'Force' },
  { id: 'dagre', label: 'Hiérarchique' },
  { id: 'concentric', label: 'Concentrique' },
  { id: 'breadthfirst', label: 'Arbre' },
];
const commHex = (i: number, theme: 'light' | 'dark') => { const f = Object.values(FAMILY)[i]; return theme === 'dark' ? f.dark : f.light; };
const COMM_COLORS = ['--t-code', '--t-store', '--t-system', '--t-config', '--t-business', '--t-knowledge', '--t-structure', '--t-risk'];
const typeCounts = graph.nodes.reduce<Record<string, number>>((a, n) => ((a[n.type] = (a[n.type] ?? 0) + 1), a), {});
const relCounts = graph.edges.reduce<Record<string, number>>((a, e) => ((a[e.relation] = (a[e.relation] ?? 0) + 1), a), {});

interface LayoutRun {
  root?: string;
  animate: boolean;
  /** false = start from the current positions (incremental: nodes glide instead of reshuffling) */
  randomize: boolean;
  /** fit the viewport as part of the layout animation (not as a jump afterwards) */
  fit: boolean;
}
function layoutOpts(name: LayoutName, o: LayoutRun): cytoscape.LayoutOptions {
  const anim = { animate: o.animate, animationDuration: 700, animationEasing: EASE, fit: o.fit, padding: 40 };
  switch (name) {
    case 'fcose':
      return { name: 'fcose', quality: 'default', randomize: o.randomize, ...anim, nodeRepulsion: () => 14000, idealEdgeLength: () => 95, edgeElasticity: () => 0.4, gravity: 0.25, numIter: 2500, packComponents: true, nodeSeparation: 90, nodeDimensionsIncludeLabels: true } as unknown as cytoscape.LayoutOptions;
    case 'dagre':
      return { name: 'dagre', rankDir: 'LR', nodeSep: 14, rankSep: 70, edgeSep: 6, ...anim } as unknown as cytoscape.LayoutOptions;
    case 'concentric':
      return { name: 'concentric', concentric: (n: cytoscape.NodeSingular) => (o.root && n.id() === o.root ? 1000 : n.data('deg')), levelWidth: () => 4, minNodeSpacing: 8, ...anim } as cytoscape.LayoutOptions;
    default:
      return { name: 'breadthfirst', directed: false, roots: o.root ? [o.root] : undefined, spacingFactor: 0.9, ...anim } as cytoscape.LayoutOptions;
  }
}

/** Hubs are never dragged along by a neighbour: they would drag half the graph with them. */
const isHub = (n: cytoscape.NodeSingular) => !!n.data('hub');

export default function GraphExplorer() {
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const selected = params.get('n');
  const focus = Number(params.get('focus') ?? 0);
  const fromId = params.get('from');
  const toId = params.get('to');
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [layout, setLayout] = useState<LayoutName>((params.get('layout') as LayoutName) || 'fcose');
  const [colorBy, setColorBy] = useState<'type' | 'community'>('type');
  const [hiddenRels, setHiddenRels] = useState<Set<Relation>>(new Set(['documented-in', 'mentions']));
  const [showIsolated, setShowIsolated] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [pathOpen, setPathOpen] = useState(!!(fromId || toId));
  const [directed, setDirected] = useState(false);
  const [visibleCount, setVisibleCount] = useState({ n: 0, e: 0 });
  const [ready, setReady] = useState(false);
  const [physics, setPhysics] = usePhysicsPref();
  const physicsRef = useRef<ReturnType<typeof attachDragPhysics> | null>(null);
  const layoutRef = useRef<cytoscape.Layouts | null>(null);
  // the visible set depends on the selection only in focus mode: a plain click must not rebuild the graph
  const focusId = focus && selected ? selected : null;

  const setParam = useCallback(
    (kv: Record<string, string | null>) =>
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(kv)) v === null ? p.delete(k) : p.set(k, v);
        return p;
      }),
    [setParams],
  );

  const path: GEdge[] | null = useMemo(() => (fromId && toId ? shortestPath(fromId, toId, { directed }) : null), [fromId, toId, directed]);
  const pathNodes = useMemo(() => {
    if (!path || !fromId) return new Set<string>();
    const s = new Set([fromId]);
    path.forEach((e) => (s.add(e.source), s.add(e.target)));
    return s;
  }, [path, fromId]);

  // ---------------------------------------------------------------- visible elements
  const elements = useMemo(() => {
    const confOk = (c: string) => store.confidence.has(c as 'V');
    let visible = graph.nodes.filter((n) => !store.hiddenTypes.has(n.type) && confOk(n.confidence) && passesDomain(n, store.domainFilter));
    if (focusId && nodeById.has(focusId)) {
      const nb = neighborhood(focusId, focus === 2 ? 2 : 1, (e) => !hiddenRels.has(e.relation));
      visible = visible.filter((n) => nb.has(n.id));
      if (!visible.some((n) => n.id === focusId)) visible.push(nodeById.get(focusId)!);
    }
    const ids = new Set(visible.map((n) => n.id));
    for (const id of pathNodes) if (!ids.has(id)) (ids.add(id), visible.push(nodeById.get(id)!));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && (!hiddenRels.has(e.relation) || path?.includes(e)) && confOk(e.confidence));
    // nodes with no visible edge are packed in a dense grid by the layout: hidden unless asked for
    if (!showIsolated && !focusId) {
      const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
      visible = visible.filter((n) => linked.has(n.id) || pathNodes.has(n.id));
    }
    const multi = multiEdgeKeys(edges);
    const commIndex = new Map(communities.slice(0, 8).map((c, i) => [c.id, i]));
    const els: ElementDefinition[] = [
      ...visible.map((n) => {
        const d = degree.get(n.id) ?? 0;
        const ci = commIndex.get(community.get(n.id) ?? '');
        return {
          group: 'nodes' as const,
          data: {
            id: n.id,
            label: n.label.length > 34 ? n.label.slice(0, 32) + '…' : n.label,
            type: n.type,
            conf: n.confidence,
            docOnly: n.docOnly,
            deg: d,
            hub: d >= 24 || n.type === 'module' || n.type === 'project',
            size: Math.min(54, 11 + Math.sqrt(d) * 5.2),
            // both theme variants: switching theme only swaps the stylesheet, never the elements
            ccDark: ci === undefined ? '#4b5466' : commHex(ci, 'dark'),
            ccLight: ci === undefined ? '#a3acbb' : commHex(ci, 'light'),
            commIdx: ci ?? -1,
          },
        };
      }),
      ...edges.map((e) => ({
        group: 'edges' as const,
        data: { id: e.id, source: e.source, target: e.target, rel: e.relation, conf: e.confidence, w: REL[e.relation].weight, relLabel: REL[e.relation].label, multi: multi.has(pairKey(e.source, e.target)) },
      })),
    ];
    return { els, nodes: visible.length, edges: edges.length };
  }, [store.hiddenTypes, store.confidence, store.domainFilter, hiddenRels, focus, focusId, pathNodes, path, showIsolated]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- cytoscape lifecycle
  useEffect(() => {
    ensureCy();
    const cy = cytoscape({
      container: containerRef.current!,
      style: graphStyle(store.theme),
      minZoom: 0.08,
      maxZoom: 3.5,
      ...RENDER_OPTS,
      boxSelectionEnabled: false,
    });
    cyRef.current = cy;
    // the container can be 0×0 when cytoscape initialises (lazy route, flex layout): fit once it has a size
    const unwatch = watchSize(cy, containerRef.current!, () => cy.fit(undefined, 40));
    const unsnap = zoomInSnapshot(cy);
    physicsRef.current = attachDragPhysics(cy, physics, { pinned: isHub });
    store.exporter.current = {
      png: () => exportCy(cy, 'png', `graphe-${graph.meta.projectLabel}`, store.theme),
      svg: () => exportCy(cy, 'svg', `graphe-${graph.meta.projectLabel}`, store.theme),
      json: () => {
        const ids = new Set(cy.nodes().map((n) => n.id()));
        const eids = new Set(cy.edges().map((e) => e.id()));
        download(`graphe-visible-${graph.meta.projectLabel}.json`, JSON.stringify({ meta: graph.meta, nodes: graph.nodes.filter((n) => ids.has(n.id)), edges: graph.edges.filter((e) => eids.has(e.id)) }, null, 1));
      },
    };
    return () => {
      unwatch();
      unsnap();
      layoutRef.current?.stop();
      physicsRef.current?.destroy();
      physicsRef.current = null;
      store.exporter.current = null;
      cy.destroy();
      cyRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => physicsRef.current?.setEnabled(physics), [physics]);

  useEffect(() => {
    cyRef.current?.style(graphStyle(store.theme));
    if (cyRef.current && store.exporter.current) {
      const cy = cyRef.current;
      store.exporter.current.png = () => exportCy(cy, 'png', `graphe-${graph.meta.projectLabel}`, store.theme);
      store.exporter.current.svg = () => exportCy(cy, 'svg', `graphe-${graph.meta.projectLabel}`, store.theme);
    }
  }, [store.theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // events (re-bound when setParam identity changes)
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const onTap = (e: cytoscape.EventObject) => setParam({ n: e.target.id(), tab: null });
    const onBg = (e: cytoscape.EventObject) => {
      if (e.target === cy) setParam({ n: null, tab: null, focus: null });
    };
    const onDbl = (e: cytoscape.EventObject) => setParam({ n: e.target.id(), focus: '1' });
    const onOver = (e: cytoscape.EventObject) => {
      const n = e.target;
      cy.batch(() => {
        n.addClass('hover');
        if (cy.$('.hl').length) return;
        n.addClass('nbr');
        n.neighborhood('node').addClass('nbr');
      });
    };
    const onOut = (e: cytoscape.EventObject) =>
      cy.batch(() => {
        e.target.removeClass('hover');
        if (!cy.$('.hl').length) cy.$('.nbr').removeClass('nbr');
      });
    cy.on('tap', 'node', onTap);
    cy.on('tap', onBg);
    cy.on('dbltap', 'node', onDbl);
    cy.on('mouseover', 'node', onOver);
    cy.on('mouseout', 'node', onOut);
    return () => {
      cy.off('tap', 'node', onTap);
      cy.off('tap', onBg);
      cy.off('dbltap', 'node', onDbl);
      cy.off('mouseover', 'node', onOver);
      cy.off('mouseout', 'node', onOut);
    };
  }, [setParam]);

  // elements + layout: diff the element set, keep positions of the nodes that stay, glide to the new layout
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    layoutRef.current?.stop();
    const first = cy.nodes().empty();
    const keep = new Set(elements.els.map((e) => e.data.id!));
    let added: cytoscape.NodeCollection = cy.collection();
    cy.batch(() => {
      cy.elements().filter((e) => !keep.has(e.id())).remove();
      const fresh = elements.els.filter((e) => cy.getElementById(e.data.id!).empty());
      added = cy.add(fresh).nodes();
    });
    if (!first && added.nonempty()) {
      // new nodes appear next to the neighbours already on screen, not at (0,0)
      const placed = cy.nodes().not(added);
      const bb = placed.nonempty() ? placed.boundingBox({}) : { x1: 0, y1: 0, w: 0, h: 0 };
      const cx0 = bb.x1 + bb.w / 2;
      const cy0 = bb.y1 + bb.h / 2;
      cy.batch(() => {
        added.nodes().forEach((n) => {
          const anchors = n.neighborhood('node').not(added);
          const base = anchors.nonempty() ? anchors.boundingBox({}) : null;
          const x = base ? base.x1 + base.w / 2 : cx0;
          const y = base ? base.y1 + base.h / 2 : cy0;
          n.position({ x: x + (Math.random() - 0.5) * 40, y: y + (Math.random() - 0.5) * 40 });
        });
      });
    }
    setVisibleCount({ n: elements.nodes, e: elements.edges });
    const name = focusId && layout === 'fcose' ? 'concentric' : layout;
    const l = cy.layout(
      layoutOpts(name, {
        root: focusId ?? undefined,
        // the very first layout is computed off-screen and faded in: no 300-node "explosion" from the origin
        animate: !first && elements.nodes < 600,
        randomize: first,
        fit: !selected || !!focus || first,
      }),
    );
    layoutRef.current = l;
    l.one('layoutstop', () => {
      if (layoutRef.current !== l) return;
      // a small focus neighbourhood would be fitted at the maximum zoom: keep labels readable
      if (cy.zoom() > 1.5) cy.stop(true).animate({ zoom: 1.5, center: { eles: cy.elements() }, duration: 300, easing: EASE });
      setReady(true);
      highlightRef.current();
    });
    l.run();
  }, [elements, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => cy.nodes().forEach((n) => void n.toggleClass('bycomm', colorBy === 'community')));
  }, [colorBy, elements]);

  const applyHighlight = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass('hl nbr faded path');
      if (path && path.length) {
        const ids = new Set(path.map((e) => e.id));
        cy.elements().addClass('faded');
        for (const id of pathNodes) cy.getElementById(id).removeClass('faded').addClass('path');
        cy.edges().filter((e) => ids.has(e.id())).removeClass('faded').addClass('path');
      } else if (selected) {
        const n = cy.getElementById(selected);
        if (n.nonempty()) {
          const hood = n.closedNeighborhood();
          cy.elements().not(hood).addClass('faded');
          n.addClass('hl');
          hood.nodes().not(n).addClass('nbr');
          n.connectedEdges().addClass('hl');
        }
      }
      if (filterText.trim()) {
        const q = filterText.trim().toLowerCase();
        const match = cy.nodes().filter((n) => String(n.data('label')).toLowerCase().includes(q) || n.id().toLowerCase().includes(q));
        if (match.nonempty()) {
          cy.elements().not(match).addClass('faded');
          match.removeClass('faded').addClass('nbr');
        }
      }
    });
    if (path && path.length) {
      cy.stop(true);
      cy.animate({ fit: { eles: cy.$('.path'), padding: 80 }, duration: 600, easing: EASE });
    } else if (selected && cy.getElementById(selected).nonempty() && !focus) {
      cy.stop(true);
      cy.animate({ center: { eles: cy.getElementById(selected) }, zoom: Math.max(cy.zoom(), 1.1), duration: 550, easing: EASE });
    }
  }, [selected, path, pathNodes, filterText, focus]);

  const highlightRef = useRef(applyHighlight);
  highlightRef.current = applyHighlight;
  useEffect(applyHighlight, [applyHighlight]);

  // keyboard: f = focus toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
      if (e.key === 'f' && selected) setParam({ focus: focus ? null : '1' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, focus, setParam]);

  const zoomBy = (f: number) => {
    const cy = cyRef.current;
    const el = containerRef.current;
    if (!cy || !el) return;
    const level = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * f));
    // zoom around the screen centre: keep the model point under the centre fixed
    const c = { x: el.clientWidth / 2, y: el.clientHeight / 2 };
    const pan = cy.pan();
    const k = level / cy.zoom();
    cy.stop(true).animate({ zoom: level, pan: { x: c.x - (c.x - pan.x) * k, y: c.y - (c.y - pan.y) * k }, duration: 260, easing: EASE });
  };

  const zoomToCluster = (members: string[]) => {
    const cy = cyRef.current;
    if (!cy) return;
    const set = new Set(members);
    const eles = cy.nodes().filter((n) => set.has(n.id()));
    if (eles.empty()) return;
    cy.batch(() => {
      cy.elements().removeClass('hl nbr path').addClass('faded');
      eles.removeClass('faded').addClass('nbr');
      eles.edgesWith(eles).removeClass('faded');
    });
    cy.stop(true).animate({ fit: { eles, padding: 70 }, duration: 650, easing: EASE });
  };

  const toggleType = (t: NodeType) => {
    const s = new Set(store.hiddenTypes);
    s.has(t) ? s.delete(t) : s.add(t);
    store.setHiddenTypes(s);
  };
  const toggleRel = (r: Relation) => {
    const s = new Set(hiddenRels);
    s.has(r) ? s.delete(r) : s.add(r);
    setHiddenRels(s);
  };

  return (
    <div className="flex h-full min-h-[560px]">
      {/* ------------------------------------------------ left rail */}
      <aside className="hidden w-[284px] shrink-0 flex-col overflow-y-auto border-r border-line bg-surface/30 px-4 py-4 lg:flex" data-noexport="1">
        <div className="relative mb-4">
          <Search size={14} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Surligner dans le graphe…" className="h-8 w-full rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-muted focus:border-[var(--ring)]" />
        </div>
        <RailTitle
          right={
            <button onClick={() => store.setHiddenTypes(store.hiddenTypes.size ? new Set() : new Set(TYPE_ORDER.filter((t) => !['package', 'page', 'service', 'class'].includes(t))))} className="text-[11px] text-muted hover:text-fg">
              {store.hiddenTypes.size ? 'Tout' : 'Aucun'}
            </button>
          }
        >
          Types de nœuds
        </RailTitle>
        <div className="mb-5 flex flex-col">
          {TYPE_ORDER.filter((t) => typeCounts[t]).map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-surface-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={!store.hiddenTypes.has(t)} onChange={() => toggleType(t)} />
              <TypeGlyph type={t} />
              <span className="flex-1 text-[12.5px] text-fg-2">{TYPE[t].plural}</span>
              <span className="text-[11px] text-muted tnum">{typeCounts[t]}</span>
            </label>
          ))}
        </div>
        <RailTitle>Communautés</RailTitle>
        <div className="mb-5 flex flex-col">
          {communities.slice(0, 14).map((c, i) => (
            <button key={c.id} onClick={() => zoomToCluster(c.members)} className="group flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left hover:bg-surface-2" title="Zoomer sur la communauté">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i < 8 ? `var(${COMM_COLORS[i]})` : 'var(--muted)' }} />
              <span className="flex-1 truncate font-mono text-[12px] text-fg-2 group-hover:text-fg">{c.name}</span>
              <span className="text-[11px] text-muted tnum">{c.members.length}</span>
            </button>
          ))}
          {communities.length > 8 && <div className="px-1.5 pt-1 text-[10.5px] text-muted">Couleurs : 8 premières communautés, les autres en gris.</div>}
        </div>
        <RailTitle>Relations</RailTitle>
        <div className="flex flex-col">
          {(Object.keys(REL) as Relation[]).filter((r) => relCounts[r]).map((r) => (
            <label key={r} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1.5 py-1 hover:bg-surface-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={!hiddenRels.has(r)} onChange={() => toggleRel(r)} />
              <EdgeSample style={REL[r].style} />
              <span className="flex-1 text-[12px] text-fg-2">{REL[r].label}</span>
              <span className="text-[11px] text-muted tnum">{relCounts[r]}</span>
            </label>
          ))}
        </div>
      </aside>

      {/* ------------------------------------------------ canvas */}
      <div className="relative min-w-0 flex-1">
        {/* cytoscape forces `position: relative` on its container, so it must be a full-size child of the absolute layer */}
        {/* overflow + contain: nothing cytoscape does inside can resize or scroll the page around it */}
        <div className="dot-grid absolute inset-0 overflow-hidden [contain:strict]">
          <div ref={containerRef} className={cx('h-full w-full overflow-hidden transition-opacity duration-500 ease-out', ready ? 'opacity-100' : 'opacity-0')} aria-label="Graphe interactif" role="img" />
        </div>
        <div className={cx('pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start gap-2 p-3', selected && 'lg:pr-[460px]')} data-noexport="1">
          <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1">
            {LAYOUTS.map((l) => (
              <button key={l.id} onClick={() => (setLayout(l.id), setParam({ layout: l.id }))} className={cx('rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors', layout === l.id ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}>
                {l.label}
              </button>
            ))}
          </div>
          <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1">
            <button onClick={() => setColorBy('type')} className={cx('rounded-lg px-2.5 py-1.5 text-[12px] font-medium', colorBy === 'type' ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}>
              Couleur : type
            </button>
            <button onClick={() => setColorBy('community')} className={cx('rounded-lg px-2.5 py-1.5 text-[12px] font-medium', colorBy === 'community' ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}>
              communauté
            </button>
          </div>
          <div className="glass pointer-events-auto flex items-center gap-1 rounded-xl p-1">
            <button
              disabled={!selected}
              onClick={() => setParam({ focus: focus === 1 ? '2' : focus === 2 ? null : '1' })}
              className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium disabled:opacity-40', focus ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}
              title="Focus : voisinage à 1 puis 2 sauts (f)"
            >
              <Focus size={13} /> Focus {focus ? `${focus} saut${focus > 1 ? 's' : ''}` : ''}
            </button>
            <button onClick={() => setPathOpen(!pathOpen)} className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium', pathOpen ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}>
              <Route size={13} /> Chemin
            </button>
            <button
              onClick={() => setPhysics(!physics)}
              aria-pressed={physics}
              className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium', physics ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}
              title="Physique : en glissant un nœud, ses voisins le suivent élastiquement"
            >
              <Magnet size={13} /> Physique
            </button>
            <button
              onClick={() => setShowIsolated(!showIsolated)}
              aria-pressed={showIsolated}
              className={cx('inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium', showIsolated ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}
              title="Afficher aussi les nœuds sans relation visible (masqués par défaut : ils s’empilent en grille)"
            >
              <CircleDot size={13} /> Isolés
            </button>
          </div>
          <div className="ml-auto glass pointer-events-auto flex items-center gap-0.5 rounded-xl p-1">
            <CanvasBtn title="Zoom +" onClick={() => zoomBy(1.35)}>
              <Plus size={14} />
            </CanvasBtn>
            <CanvasBtn title="Zoom −" onClick={() => zoomBy(1 / 1.35)}>
              <Minus size={14} />
            </CanvasBtn>
            <CanvasBtn title="Tout afficher" onClick={() => cyRef.current?.stop(true).animate({ fit: { eles: cyRef.current.elements(), padding: 40 }, duration: 550, easing: EASE })}>
              <Maximize2 size={14} />
            </CanvasBtn>
            {selected && (
              <CanvasBtn title="Centrer la sélection" onClick={() => cyRef.current?.stop(true).animate({ center: { eles: cyRef.current.getElementById(selected) }, duration: 500, easing: EASE })}>
                <Crosshair size={14} />
              </CanvasBtn>
            )}
          </div>
        </div>

        <AnimatePresence>
          {pathOpen && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="glass absolute left-3 top-[104px] z-20 flex max-h-[calc(100%-116px)] w-[360px] max-w-[calc(100%-24px)] flex-col overflow-y-auto rounded-2xl p-4" data-noexport="1">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-fg">
                  <Route size={14} className="text-accent" /> Trouver un chemin
                </div>
                <button onClick={() => (setPathOpen(false), setParam({ from: null, to: null }))} className="text-muted hover:text-fg" aria-label="Fermer">
                  <X size={14} />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <NodePicker value={fromId} onChange={(id) => setParam({ from: id })} placeholder="Départ (ex. ProjetValidationPage)" />
                <NodePicker value={toId} onChange={(id) => setParam({ to: id })} placeholder="Arrivée (ex. CNS_CONSULTATION)" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill onClick={() => setParam({ from: PATH_EXAMPLE.from, to: PATH_EXAMPLE.to })}>
                    <Sparkles size={11} /> Validation du projet → CNS_CONSULTATION
                  </Pill>
                  <Pill onClick={() => setParam({ from: 'page:AvisPublicationHomePage', to: 'sys:boamp' })}>Avis → BOAMP</Pill>
                  <label className="ml-auto flex items-center gap-1.5 text-[11.5px] text-fg-2">
                    <input type="checkbox" className="accent-[var(--accent)]" checked={directed} onChange={(e) => setDirected(e.target.checked)} /> orienté
                  </label>
                </div>
              </div>
              {fromId && toId && (
                <div className="mt-3 max-h-[42vh] overflow-y-auto border-t border-line pt-3">
                  {!path && <div className="text-[12.5px] text-fg-2">Aucun chemin trouvé{directed ? ' en suivant le sens des arêtes' : ''}.</div>}
                  {path && (
                    <ol className="flex flex-col gap-1.5">
                      <li>
                        <NodeChip id={fromId} compact />
                      </li>
                      {path.map((e, i) => {
                        const next = pathNext(path, fromId, i);
                        return (
                          <li key={e.id} className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-2 pl-3 text-[11px] text-muted">
                              <span className="h-4 w-px bg-line-strong" />
                              {e.source === next ? '←' : '→'} {REL[e.relation].label}
                              <ConfidenceBadge c={e.confidence} compact />
                            </div>
                            <NodeChip id={next} compact />
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  {path && <div className="mt-3 text-[11px] leading-snug text-muted">Plus court chemin (BFS) hors liens de documentation ; cliquez un nœud puis « Expliquer » pour la preuve de chaque saut.</div>}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {!pathOpen && <Legend count={visibleCount} narrow={!!selected} />}
      </div>
    </div>
  );
}

function pathNext(path: GEdge[], from: string, i: number): string {
  let cur = from;
  for (let k = 0; k <= i; k++) cur = path[k].source === cur ? path[k].target : path[k].source;
  return cur;
}

function RailTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between px-1.5">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">{children}</span>
      {right}
    </div>
  );
}

function CanvasBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="grid h-7 w-7 place-items-center rounded-lg text-fg-2 hover:bg-surface-3 hover:text-fg">
      {children}
    </button>
  );
}

export function EdgeSample({ style }: { style: 'solid' | 'dashed' | 'dotted' }) {
  return (
    <svg width="22" height="8" className="shrink-0" aria-hidden>
      <line x1="1" y1="4" x2="21" y2="4" stroke="var(--text-2)" strokeWidth="1.6" strokeDasharray={style === 'dashed' ? '4 3' : style === 'dotted' ? '1.5 2.5' : undefined} strokeLinecap="round" />
    </svg>
  );
}

function Legend({ count, narrow }: { count: { n: number; e: number }; narrow: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className={cx('glass absolute bottom-3 left-3 z-10 max-w-[calc(100%-24px)] rounded-xl px-3 py-2.5', narrow && 'lg:max-w-[calc(100%-476px)]')} data-noexport="1">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-[11px] text-muted" aria-expanded={open}>
        <span className="font-semibold uppercase tracking-[0.12em]">Légende</span>
        <span className="ml-auto tnum">
          {count.n} nœuds · {count.e} arêtes
        </span>
      </button>
      {open && (
        <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-5 gap-y-1">
          {(Object.keys(FAMILY) as (keyof typeof FAMILY)[]).map((f) => (
            <div key={f} className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] text-fg-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${FAMILY[f].cssVar})` }} />
              {FAMILY[f].label}
            </div>
          ))}
          <div className="col-span-full mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <EdgeSample style="solid" /> structure · appel · transition · table
            </span>
            <span className="flex items-center gap-1.5">
              <EdgeSample style="dashed" /> positionne · met en œuvre · concerne ; trait pointillé fin = [H]
            </span>
            <span className="flex items-center gap-1.5">
              <EdgeSample style="dotted" /> même phrase · configure · glossaire
            </span>
            <span>taille = degré · forme = type</span>
          </div>
        </div>
      )}
    </div>
  );
}
