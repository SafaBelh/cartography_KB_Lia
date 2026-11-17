import type { Confidence, GEdge, GNode, NodeType, PropValue, Provenance, Relation } from '../../src/types/graph';

const RANK: Record<Confidence, number> = { V: 2, H: 1 };

export interface NodeInit {
  type: NodeType;
  label: string;
  subtype?: string;
  module?: string;
  description?: string;
  props?: Record<string, PropValue>;
  aliases?: string[];
}

/** Mutable graph store that merges provenance and keeps ids stable. */
export class GraphBuilder {
  nodes = new Map<string, GNode>();
  edges = new Map<string, GEdge>();
  warnings: string[] = [];

  has(id: string) {
    return this.nodes.has(id);
  }

  get(id: string) {
    return this.nodes.get(id);
  }

  upsertNode(id: string, init: NodeInit, prov?: Provenance): GNode {
    let n = this.nodes.get(id);
    if (!n) {
      n = {
        id,
        type: init.type,
        label: init.label,
        subtype: init.subtype,
        module: init.module,
        description: init.description,
        props: { ...(init.props ?? {}) },
        aliases: [...new Set(init.aliases ?? [])],
        confidence: 'H',
        docOnly: true,
        provenance: [],
      };
      this.nodes.set(id, n);
    } else {
      if (init.subtype && !n.subtype) n.subtype = init.subtype;
      if (init.module && !n.module) n.module = init.module;
      if (init.description && !n.description) n.description = init.description;
      if (init.props) for (const [k, v] of Object.entries(init.props)) if (n.props[k] === undefined) n.props[k] = v;
      if (init.aliases) n.aliases = [...new Set([...n.aliases, ...init.aliases])];
    }
    if (prov) this.addNodeProv(n, prov);
    return n;
  }

  addNodeProv(n: GNode, prov: Provenance) {
    if (!n.provenance.some((p) => sameProv(p, prov))) n.provenance.push(prov);
  }

  addEdge(source: string, target: string, relation: Relation, prov: Provenance, label?: string): GEdge | null {
    if (source === target) return null;
    if (!this.nodes.has(source) || !this.nodes.has(target)) {
      this.warnings.push(`edge skipped (missing node): ${relation} ${source} -> ${target}`);
      return null;
    }
    const id = `${relation}:${source}->${target}`;
    let e = this.edges.get(id);
    if (!e) {
      e = { id, source, target, relation, label, confidence: prov.confidence, docOnly: true, provenance: [] };
      this.edges.set(id, e);
    }
    if (label && !e.label) e.label = label;
    if (!e.provenance.some((p) => sameProv(p, prov))) e.provenance.push(prov);
    return e;
  }

  /** Confidence = strongest claim among provenance; docOnly = no source-file provenance.
   *  Generic "flows-to" edges are dropped when a more specific relation links the same pair. */
  finalize() {
    const specific = new Set<string>();
    for (const e of this.edges.values()) {
      if (e.relation === 'flows-to' || e.relation === 'documented-in' || e.relation === 'mentions') continue;
      specific.add(`${e.source}|${e.target}`);
      specific.add(`${e.target}|${e.source}`);
    }
    for (const [id, e] of this.edges) if (e.relation === 'flows-to' && specific.has(`${e.source}|${e.target}`)) this.edges.delete(id);

    const fin = (x: { confidence: Confidence; docOnly: boolean; provenance: Provenance[] }) => {
      if (x.provenance.length) {
        x.confidence = x.provenance.map((p) => p.confidence).reduce((a, b) => (RANK[a] >= RANK[b] ? a : b));
      }
      // the LiaWeb source (SVN) is never loaded: every fact comes from the docs or the config dictionary
      x.docOnly = true;
    };
    this.nodes.forEach(fin);
    this.edges.forEach(fin);
  }

  degree(): Map<string, number> {
    const d = new Map<string, number>();
    for (const e of this.edges.values()) {
      d.set(e.source, (d.get(e.source) ?? 0) + 1);
      d.set(e.target, (d.get(e.target) ?? 0) + 1);
    }
    return d;
  }
}

function sameProv(a: Provenance, b: Provenance) {
  return a.kind === b.kind && a.file === b.file && a.line === b.line && a.method === b.method;
}
