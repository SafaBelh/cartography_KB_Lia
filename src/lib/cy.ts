import cytoscape, { type Core, type NodeSingular, type StylesheetJson } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import fcose from 'cytoscape-fcose';
import svg from 'cytoscape-svg';
import { REL, TYPE, familyColor } from './meta';
import type { NodeType, Relation } from '../types/graph';

let registered = false;
export function ensureCy() {
  if (registered) return;
  cytoscape.use(fcose);
  cytoscape.use(dagre);
  cytoscape.use(svg);
  // overlapping nodes during a layout make cytoscape log one warning per edge and per frame: pure overhead
  if (import.meta.env.PROD) cytoscape.warnings(false);
  registered = true;
}

/** Shared easing for every canvas animation (layouts, viewport, tweens). */
export const EASE = 'ease-in-out-cubic' as const;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Renderer options shared by the canvas views.
 * - pixelRatio is capped at 2: on 3× screens the canvas would be 9× the pixels for no visible gain.
 * - textureOnViewport is off by default; zoomInSnapshot() turns it on only while the wheel zooms in.
 */
export const RENDER_OPTS = {
  pixelRatio: Math.min(2, typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1),
  textureOnViewport: false,
  hideEdgesOnViewport: false,
  motionBlur: false,
  wheelSensitivity: 1,
} as const;

/**
 * Wheel zoom-in uses cytoscape's viewport snapshot (one bitmap scaled per frame: 60 fps whatever the
 * graph size); everything else is drawn live.
 * The snapshot only covers what was on screen when it was taken, so using it for zoom-out or pan leaves
 * blank margins that pop in ~150 ms after the gesture (the "lag" of the first version). Zooming in never
 * reveals anything outside the snapshot, so only that direction uses it; it is sharpened 150 ms after
 * the wheel stops.
 */
export function zoomInSnapshot(cy: Core): () => void {
  const el = cy.container();
  if (!el) return () => {};
  const r = (cy as unknown as { renderer(): { textureOnViewport: boolean; textureCache: unknown } }).renderer();
  let timer = 0;
  const set = (on: boolean) => {
    if (r.textureOnViewport === on) return;
    r.textureOnViewport = on;
    r.textureCache = null; // next frame takes a fresh snapshot (or draws live)
  };
  const onWheel = (e: WheelEvent) => {
    set(e.deltaY < 0);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => set(false), 200);
  };
  const onPress = () => set(false);
  el.addEventListener('wheel', onWheel, { capture: true, passive: true });
  el.addEventListener('mousedown', onPress, { capture: true });
  el.addEventListener('touchstart', onPress, { capture: true, passive: true });
  return () => {
    window.clearTimeout(timer);
    el.removeEventListener('wheel', onWheel, { capture: true });
    el.removeEventListener('mousedown', onPress, { capture: true });
    el.removeEventListener('touchstart', onPress, { capture: true });
  };
}

/**
 * Keep cytoscape in sync with its container size.
 * Only calls cy.resize() when the integer size really changed, at most once per frame.
 * (Calling it on every ResizeObserver tick created a feedback loop: cytoscape sizes its canvases
 * to the rounded clientHeight, the 0.5 px overflow toggled the page scrollbars, which resized the
 * container again — 60 full canvas resets per second.)
 */
export function watchSize(cy: Core, el: HTMLElement, onFirstSize?: () => void): () => void {
  let w = 0;
  let h = 0;
  let raf = 0;
  let pendingFirst = !!onFirstSize;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const nw = el.clientWidth;
      const nh = el.clientHeight;
      if (!nw || !nh) return;
      if (nw !== w || nh !== h) {
        w = nw;
        h = nh;
        cy.resize();
      }
      if (pendingFirst && cy.elements().nonempty()) {
        pendingFirst = false;
        onFirstSize!();
      }
    });
  });
  ro.observe(el);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}

/** Pairs of nodes linked by more than one edge: only those need (costlier) bezier curves. */
export function multiEdgeKeys(edges: { source: string; target: string }[]): Set<string> {
  const count = new Map<string, number>();
  for (const e of edges) {
    const k = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return new Set([...count].filter(([, n]) => n > 1).map(([k]) => k));
}
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Animate node positions in one rAF loop (one batch per frame instead of one animation per node).
 * A new tween on the same cy cancels the previous one.
 */
export function tweenPositions(cy: Core, targets: Map<string, { x: number; y: number }>, duration = 480): Promise<void> {
  const token = {};
  cy.scratch('_tween', token);
  const nodes: NodeSingular[] = [];
  cy.nodes().forEach((n) => {
    if (!n.isParent() && targets.has(n.id())) nodes.push(n);
  });
  const from = nodes.map((n) => ({ ...n.position() }));
  const to = nodes.map((n) => targets.get(n.id())!);
  const t0 = performance.now();
  return new Promise((resolve) => {
    const step = (t: number) => {
      if (cy.destroyed() || cy.scratch('_tween') !== token) return resolve();
      const k = Math.min(1, (t - t0) / duration);
      const e = easeInOutCubic(k);
      cy.batch(() => {
        nodes.forEach((n, i) => void n.position({ x: from[i].x + (to[i].x - from[i].x) * e, y: from[i].y + (to[i].y - from[i].y) * e }));
      });
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

const cssVar = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function graphStyle(theme: 'light' | 'dark', opts: { minZoomedFont?: number; fontSize?: number; groupFontSize?: number } = {}): StylesheetJson {
  const text = cssVar('--text', theme === 'dark' ? '#ededed' : '#171717');
  const text2 = cssVar('--text-2', '#a7b0bf');
  const bg = cssVar('--bg', theme === 'dark' ? '#121212' : '#fafafa');
  const accent = cssVar('--accent', '#5b9be6');
  const edge = theme === 'dark' ? 'rgba(167,176,191,0.28)' : 'rgba(71,85,105,0.30)';
  const types = Object.keys(TYPE) as NodeType[];
  const rels = Object.keys(REL) as Relation[];
  return [
    {
      selector: 'node',
      style: {
        'background-color': '#888',
        width: 'data(size)',
        height: 'data(size)',
        label: 'data(label)',
        'font-family': 'JetBrains Mono, ui-monospace, monospace',
        'font-size': opts.fontSize ?? 8,
        color: text2,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-margin-y': 3,
        // labels appear progressively: hubs first, everything once zoomed in (keeps the overview legible)
        'min-zoomed-font-size': opts.minZoomedFont ?? 10,
        // long names never spill over their neighbours: one line, ellipsis, opaque label background
        'text-wrap': 'ellipsis',
        'text-max-width': '120px',
        'text-background-color': bg,
        'text-background-opacity': 0.92,
        'text-background-padding': '1.5px',
        'text-background-shape': 'roundrectangle',
        'border-width': 1.5,
        'border-color': bg,
        'overlay-padding': 4,
        'overlay-opacity': 0,
        // soft halo used for hover / grab (animated through underlay-opacity)
        'underlay-color': accent,
        'underlay-padding': 7,
        'underlay-opacity': 0,
        'underlay-shape': 'ellipse',
        'transition-property': 'opacity, text-opacity, background-color, border-color, border-width, underlay-opacity, underlay-padding',
        'transition-duration': 240,
        'transition-timing-function': 'ease-in-out-sine',
      } as never,
    },
    ...types.map((t) => ({
      selector: `node[type = "${t}"]`,
      style: { 'background-color': familyColor(t, theme), shape: TYPE[t].shape as never },
    })),
    { selector: 'node[?hub]', style: { 'font-size': 11, color: text, 'font-weight': 600, 'text-max-width': '160px' } },
    { selector: 'node[?docOnly][type = "class"]', style: { 'border-style': 'solid' } },
    { selector: 'node[conf = "H"]', style: { 'background-opacity': 0.72 } },
    {
      selector: 'edge',
      style: {
        width: 'data(w)',
        'line-color': edge,
        'target-arrow-color': edge,
        // straight edges are much cheaper to recompute while dragging; parallel edges keep a bezier (below)
        'curve-style': 'straight',
        'arrow-scale': 0.7,
        opacity: 0.9,
        'transition-property': 'opacity, line-color, target-arrow-color, width',
        'transition-duration': 240,
        'transition-timing-function': 'ease-in-out-sine',
      } as never,
    },
    { selector: 'edge[?multi]', style: { 'curve-style': 'bezier' } },
    ...rels.map((r) => ({
      selector: `edge[rel = "${r}"]`,
      style: {
        'line-style': REL[r].style,
        'target-arrow-shape': REL[r].arrow ? 'triangle' : 'none',
        ...(r === 'documented-in' || r === 'mentions' ? { opacity: 0.35 } : {}),
        ...(r === 'transition' ? { 'line-color': accent, 'target-arrow-color': accent } : {}),
      },
    })),
    { selector: 'edge[conf = "H"]', style: { 'line-dash-pattern': [4, 4] } },
    { selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0 } },
    { selector: 'edge.faded', style: { opacity: 0.04 } },
    { selector: '.hidden', style: { display: 'none' } },
    {
      selector: 'node.hl',
      style: { 'border-color': accent, 'border-width': 3, color: text, 'font-size': 11, 'z-index': 20, 'text-opacity': 1 },
    },
    { selector: 'node.nbr', style: { color: text, 'text-opacity': 1 } },
    { selector: 'node.hover', style: { 'underlay-opacity': theme === 'dark' ? 0.22 : 0.16, 'underlay-padding': 9, color: text, 'text-opacity': 1, 'z-index': 25 } as never },
    { selector: 'node:grabbed', style: { 'underlay-opacity': theme === 'dark' ? 0.32 : 0.24, 'underlay-padding': 12, 'z-index': 40 } as never },
    { selector: 'node.bycomm', style: { 'background-color': theme === 'dark' ? 'data(ccDark)' : 'data(ccLight)' } },
    {
      selector: 'edge.hl',
      style: { 'line-color': accent, 'target-arrow-color': accent, opacity: 1, width: 2.4, 'z-index': 20 },
    },
    {
      selector: 'node.path',
      style: { 'border-color': accent, 'border-width': 3.5, color: text, 'font-size': 12, 'font-weight': 600, 'z-index': 30, 'text-opacity': 1 },
    },
    {
      selector: 'edge.path',
      style: { 'line-color': accent, 'target-arrow-color': accent, width: 3.2, opacity: 1, 'z-index': 30, label: 'data(relLabel)', 'font-size': 9, color: accent, 'text-background-color': bg, 'text-background-opacity': 0.9, 'text-background-padding': '2px', 'text-rotation': 'autorotate' },
    },
    {
      selector: ':parent',
      style: {
        'underlay-opacity': 0,
        'background-opacity': theme === 'dark' ? 0.05 : 0.04,
        'background-color': accent,
        'border-color': theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.14)',
        'border-width': 1,
        shape: 'round-rectangle',
        'corner-radius': 14 as never,
        padding: '18px',
        label: 'data(label)',
        'text-valign': 'top',
        'text-halign': 'center',
        'text-margin-y': -6,
        'font-family': 'Inter Variable, system-ui, sans-serif',
        'font-size': opts.groupFontSize ?? 11,
        'font-weight': 600,
        color: text2,
        'text-outline-width': 0,
        'text-wrap': 'ellipsis',
        'text-max-width': '360px',
      },
    },
    { selector: 'node.collapsed', style: { 'underlay-shape': 'round-rectangle', 'underlay-padding': 4, shape: 'round-rectangle', width: 150, height: 40, 'background-color': accent, 'background-opacity': 0.14, 'border-color': accent, 'border-width': 1, label: 'data(label)', 'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 0, color: text, 'font-family': 'Inter Variable, system-ui, sans-serif', 'font-size': 10.5, 'text-wrap': 'wrap', 'text-max-width': '140px' } },
  ] as StylesheetJson;
}

export function exportCy(cy: Core, kind: 'png' | 'svg', name: string, theme: 'light' | 'dark') {
  const bg = cssVar('--bg', theme === 'dark' ? '#121212' : '#fafafa');
  let url: string;
  if (kind === 'png') {
    const blob = cy.png({ output: 'blob', full: true, scale: 2, bg }) as unknown as Blob;
    url = URL.createObjectURL(blob);
  } else {
    const s = (cy as unknown as { svg: (o: object) => string }).svg({ full: true, scale: 1, bg });
    url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${kind}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
