import Fuse from 'fuse.js';
import graphJson from '../../data/graph.json';
import docsJson from '../../data/docs.json';
import statsJson from '../../data/stats.json';
import type { DocsBundle, GEdge, GNode, Graph, NodeType, Relation, Stats } from '../types/graph';
import { REL, TYPE } from './meta';

export const graph = graphJson as unknown as Graph;
export const docsBundle = docsJson as unknown as DocsBundle;
export const stats = statsJson as unknown as Stats;

export const nodeById = new Map<string, GNode>(graph.nodes.map((n) => [n.id, n]));
export const edgeById = new Map<string, GEdge>(graph.edges.map((e) => [e.id, e]));
export const outEdges = new Map<string, GEdge[]>();
export const inEdges = new Map<string, GEdge[]>();
for (const e of graph.edges) {
  (outEdges.get(e.source) ?? outEdges.set(e.source, []).get(e.source)!).push(e);
  (inEdges.get(e.target) ?? inEdges.set(e.target, []).get(e.target)!).push(e);
}

/** Degree without documentation edges (they would make every node look central). */
export const degree = new Map<string, number>();
for (const e of graph.edges) {
  if (e.relation === 'documented-in') continue;
  degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
  degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
}

export const nodesOf = (t: NodeType) => graph.nodes.filter((n) => n.type === t);
export const neighbors = (id: string) => [...(outEdges.get(id) ?? []), ...(inEdges.get(id) ?? [])];
export const sourceLoaded = graph.meta.sourceInfo.loaded;

/** Functional modules of 04 and their domain (Partie A « Préparation et passation », Partie B « Exécution »). */
export const modules = nodesOf('module');
export const domains = [...new Set(modules.map((m) => String(m.props.domaine ?? '')).filter(Boolean))];
/** Domain of a node = domain of the module that contains it (04); undefined when the docs place it in no module. */
export function nodeDomain(n: GNode): string | undefined {
  if (n.type === 'module') return String(n.props.domaine ?? '') || undefined;
  const m = n.module ? nodeById.get(n.module) : undefined;
  return m ? String(m.props.domaine ?? '') || undefined : undefined;
}
/** Path used by the « Trouver un chemin » examples: validating a project creates its consultation (07 §3.2). */
export const PATH_EXAMPLE = { from: 'page:ProjetValidationPage', to: 'tbl:CNS_CONSULTATION' };
export const passesDomain = (n: GNode, filter: string | null) => !filter || !nodeDomain(n) || nodeDomain(n) === filter;

/** Glossary: term id → node; alias (lowercase) → term */
export const terms = nodesOf('term');
export const termByAlias = new Map<string, GNode>();
for (const t of terms) for (const a of [t.label, ...t.aliases]) if (a && a.length >= 3) termByAlias.set(a.toLowerCase(), t);
/** node id → glossary term defining it */
export const definitionOf = new Map<string, GNode>();
for (const e of graph.edges) if (e.relation === 'defines') definitionOf.set(e.target, nodeById.get(e.source)!);

/** Alias → node ids (for linking identifiers inside the docs). */
export const aliasIndex = new Map<string, string[]>();
for (const n of graph.nodes) {
  if (n.type === 'doc') continue;
  for (const a of new Set([n.label, ...n.aliases])) {
    if (!a || a.length < 3) continue;
    const arr = aliasIndex.get(a) ?? [];
    if (!arr.includes(n.id)) arr.push(n.id);
    aliasIndex.set(a, arr);
  }
}

export const docById = new Map(docsBundle.docs.map((d) => [d.id, d]));
export const docIdFromFile = (file: string) => file.split('/').pop()!.slice(0, 2);

// ------------------------------------------------------------------ communities (label propagation, deterministic)
export function computeCommunities(): Map<string, string> {
  const ids = graph.nodes.filter((n) => n.type !== 'doc').map((n) => n.id).sort();
  const label = new Map(ids.map((id) => [id, id]));
  const adj = new Map<string, { id: string; w: number }[]>();
  for (const e of graph.edges) {
    if (e.relation === 'documented-in' || e.relation === 'mentions') continue;
    const w = REL[e.relation].structural ? 0.4 : 1;
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push({ id: e.target, w });
    (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push({ id: e.source, w });
  }
  // hubs (project, database, Wicket…) would swallow everything: they don't vote
  const silent = new Set(graph.nodes.filter((n) => n.type === 'project' || n.type === 'sourceRoot' || (n.type === 'system' && n.subtype === 'database') || (degree.get(n.id) ?? 0) > 40).map((n) => n.id));
  for (let iter = 0; iter < 12; iter++) {
    let changed = 0;
    for (const id of ids) {
      const score = new Map<string, number>();
      for (const nb of adj.get(id) ?? []) {
        if (silent.has(nb.id)) continue;
        const l = label.get(nb.id)!;
        score.set(l, (score.get(l) ?? 0) + nb.w);
      }
      if (!score.size) continue;
      const best = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      if (best !== label.get(id)) {
        label.set(id, best);
        changed++;
      }
    }
    if (!changed) break;
  }
  return label;
}
export const community = computeCommunities();
export interface Community {
  id: string;
  name: string;
  members: string[];
}
export const communities: Community[] = (() => {
  const groups = new Map<string, string[]>();
  for (const [id, l] of community) groups.set(l, [...(groups.get(l) ?? []), id]);
  return [...groups.entries()]
    .filter(([, m]) => m.length >= 3)
    .map(([l, members]) => {
      const hub = [...members].sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0];
      return { id: l, name: nodeById.get(hub)?.label ?? l, members };
    })
    .sort((a, b) => b.members.length - a.members.length);
})();

// ------------------------------------------------------------------ path finding
const PATH_EXCLUDED: Relation[] = ['documented-in', 'mentions', 'defines', 'affects'];
export function shortestPath(from: string, to: string, opts: { directed?: boolean; exclude?: Relation[] } = {}): GEdge[] | null {
  const excl = new Set(opts.exclude ?? PATH_EXCLUDED);
  const prev = new Map<string, GEdge>();
  const seen = new Set([from]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    const cand = [...(outEdges.get(cur) ?? []), ...(opts.directed ? [] : inEdges.get(cur) ?? [])];
    for (const e of cand) {
      if (excl.has(e.relation)) continue;
      const nxt = e.source === cur ? e.target : e.source;
      const nn = nodeById.get(nxt);
      if (!nn || nn.type === 'doc' || seen.has(nxt)) continue;
      // don't route through the project / database hubs: they make every path trivial
      if (nxt !== to && (nn.type === 'project' || (nn.type === 'system' && nn.subtype === 'database'))) continue;
      seen.add(nxt);
      prev.set(nxt, e);
      q.push(nxt);
    }
  }
  if (!prev.has(to)) return from === to ? [] : null;
  const path: GEdge[] = [];
  let cur = to;
  while (cur !== from) {
    const e = prev.get(cur)!;
    path.unshift(e);
    cur = e.source === cur ? e.target : e.source;
  }
  return path;
}

export function neighborhood(id: string, hops: number, allowed?: (e: GEdge) => boolean): Set<string> {
  const out = new Set([id]);
  let frontier = [id];
  for (let h = 0; h < hops; h++) {
    const next: string[] = [];
    for (const cur of frontier) {
      for (const e of neighbors(cur)) {
        if (allowed && !allowed(e)) continue;
        const o = e.source === cur ? e.target : e.source;
        if (!out.has(o)) {
          out.add(o);
          next.push(o);
        }
      }
    }
    frontier = next;
  }
  return out;
}

// ------------------------------------------------------------------ search
export interface SearchItem {
  kind: 'node' | 'section' | 'view' | 'action';
  id: string;
  title: string;
  subtitle: string;
  keywords: string;
  nodeType?: NodeType;
  href?: string;
}
export const searchItems: SearchItem[] = [
  ...graph.nodes.map((n) => ({
    kind: 'node' as const,
    id: n.id,
    title: n.label,
    subtitle: `${TYPE[n.type].label}${n.subtype && n.type !== 'step' ? ` · ${n.subtype}` : ''}${typeof n.props.paquet === 'string' ? ` · ${n.props.paquet}` : ''}`,
    keywords: [n.id, ...n.aliases, n.description ?? ''].join(' '),
    nodeType: n.type,
  })),
  ...docsBundle.docs.flatMap((d) =>
    d.sections.map((s) => ({
      kind: 'section' as const,
      id: `${d.id}#${s.id}`,
      title: s.title,
      subtitle: `${d.file}`,
      keywords: `${d.title} ${s.title}`,
      href: `/docs/${d.id}?line=${s.startLine}`,
    })),
  ),
];
export const fuse = new Fuse(searchItems, {
  keys: [
    { name: 'title', weight: 3 },
    { name: 'keywords', weight: 1 },
    { name: 'subtitle', weight: 0.5 },
  ],
  threshold: 0.34,
  ignoreLocation: true,
  includeMatches: false,
});

export const docLine = (file: string, line: number): string => {
  const d = docById.get(docIdFromFile(file));
  return d?.markdown.split('\n')[line - 1] ?? '';
};
