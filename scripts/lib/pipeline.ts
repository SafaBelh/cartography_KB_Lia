import { dirname, relative, resolve } from 'node:path';
import type { Check, DocsBundle, Graph, Stats } from '../../src/types/graph';
import { GraphBuilder } from './builder';
import { loadConfig } from './config';
import { extractFromDocs } from './docs-extract';

export const EXTRACTOR_VERSION = '1.0.0';

export interface BuildOptions {
  configPath: string;
  docsDir?: string;
  now?: string;
}

export function buildOutputs(o: BuildOptions): { graph: Graph; docs: DocsBundle; stats: Stats; log: string[] } {
  const log: string[] = [];
  const cfg = loadConfig(o.configPath);
  const base = dirname(o.configPath);
  const docsDir = resolve(o.docsDir ?? resolve(base, cfg.docsDir));
  const provRoot = resolve(base, cfg.provenanceRoot);
  const provenancePrefix = (relative(provRoot, docsDir).replace(/\\/g, '/') + '/').replace(/^\/$/, '');
  const now = o.now ?? new Date().toISOString();
  const b = new GraphBuilder();

  log.push('ℹ mode documentation : le code source LiaWeb (SVN) n’est pas disponible — extraction depuis la base de connaissances uniquement');
  const dx = extractFromDocs(cfg, docsDir, b, { provenancePrefix });
  b.finalize();

  const nodes = [...b.nodes.values()].sort((a, c) => a.id.localeCompare(c.id));
  const edges = [...b.edges.values()].sort((a, c) => a.id.localeCompare(c.id));
  const graph: Graph = {
    meta: {
      generatedAt: now,
      extractorVersion: EXTRACTOR_VERSION,
      projectLabel: cfg.projectLabel,
      title: cfg.title,
      mode: 'docs-only',
      sourceInfo: {
        loaded: false,
        note: `Code source non chargé : le dépôt SVN de LiaWeb n’est pas disponible. Le graphe est construit uniquement depuis les ${dx.docs.length} documents de la base de connaissances (nœuds « doc-only »).`,
      },
      scopeNote: cfg.scopeNote,
      declared: dx.declared.map(({ id, label, count, type, provenance }) => ({ id, label, count, type, provenance })),
      warnings: b.warnings,
    },
    nodes,
    edges,
  };

  // ------------------------------------------------------------ docs bundle
  const docs: DocsBundle = {
    generatedAt: now,
    docs: dx.docs.map((d) => {
      const ln = dx.lineNodes.get(d.id) ?? new Map<number, Set<string>>();
      const lineNodes: Record<string, string[]> = {};
      for (const [n, ids] of ln) lineNodes[String(n)] = [...ids].filter((id) => b.has(id)).sort();
      return {
        id: d.id,
        file: d.file,
        title: d.title,
        markdown: d.text,
        lineNodes,
        sections: d.sections
          .filter((s) => s.id !== 'top')
          .map((s) => {
            const ids = new Set<string>();
            for (const [n, set] of ln) if (n >= s.startLine && n <= s.endLine) set.forEach((x) => b.has(x) && ids.add(x));
            return { id: s.id, title: s.title.replace(/`/g, ''), level: s.level, startLine: s.startLine, endLine: s.endLine, nodeIds: [...ids].sort() };
          }),
      };
    }),
  };

  // ------------------------------------------------------------ stats + checks
  const count = <T,>(arr: T[], key: (x: T) => string) => arr.reduce<Record<string, number>>((acc, x) => ((acc[key(x)] = (acc[key(x)] ?? 0) + 1), acc), {});
  const checks: Check[] = [];
  for (const d of dx.declared) {
    const mapped = nodes.filter((n) => n.type === d.type && (!d.subtype || n.subtype === d.subtype || n.props.paquet === d.subtype)).length;
    const where = `${d.provenance.file.split('/').pop()}:${d.provenance.line}`;
    checks.push({ id: `declared-${d.id}`, label: d.label, expected: `${d.count} (déclaré ${where})`, actual: `${mapped} nommés dans la doc`, status: 'n/a', note: 'code source non chargé : seuls les éléments nommés dans la doc sont cartographiés' });
  }
  const noProv = nodes.filter((n) => !n.provenance.length);
  checks.push({ id: 'provenance', label: 'Chaque nœud a une provenance', expected: '0 sans provenance', actual: `${noProv.length} sans provenance`, status: noProv.length ? 'fail' : 'pass' });
  const ids = new Set(nodes.map((n) => n.id));
  const dangling = edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
  checks.push({ id: 'dangling', label: 'Arêtes orphelines', expected: '0', actual: String(dangling.length), status: dangling.length ? 'fail' : 'pass' });
  const noRule = edges.filter((e) => e.provenance.some((p) => !p.metadata?.rule));
  checks.push({ id: 'edge-rule', label: 'Chaque arête porte sa règle (provenance.metadata.rule)', expected: '0 sans règle', actual: `${noRule.length} sans règle`, status: noRule.length ? 'fail' : 'pass' });
  // provenance line integrity: the cited doc line must contain the entity (or the form written in the doc)
  const docText = new Map(dx.docs.map((d) => [d.file, d.lines]));
  let bad = 0;
  const badList: string[] = [];
  for (const n of nodes) {
    for (const p of n.provenance) {
      if (p.method !== 'mention' || !p.line) continue;
      const raw = docText.get(p.file.split('/').pop()!)?.[p.line - 1]?.raw ?? '';
      const needles = [n.label, ...n.aliases, n.id.split(':').slice(1).join(':').split('/').pop()!, p.metadata?.via ?? ''].filter((x) => x && x.length >= 1);
      if (!needles.some((x) => raw.includes(x))) {
        bad++;
        if (badList.length < 6) badList.push(`${n.id} @ ${p.file.split('/').pop()}:${p.line}`);
      }
    }
  }
  checks.push({ id: 'line-integrity', label: 'Lignes de provenance contenant l’entité citée', expected: '0 écart', actual: `${bad} écart(s)`, status: bad ? 'fail' : 'pass', note: badList.join(' ; ') || undefined });
  // secrets: no snippet or property may carry a value written after « = » for a secret-like key
  const secretLike = /\b(password|passwd|pwd|mot de passe|secret|token|apikey|api[_-]?key|j_password)\s*=\s*["']?[^\s"'`|]{4,}/i;
  const leaks = nodes.filter((n) => [...Object.values(n.props).map(String), n.description ?? '', ...n.provenance.map((p) => p.snippet ?? '')].some((s) => secretLike.test(s)));
  checks.push({ id: 'secrets', label: 'Aucune valeur de secret copiée', expected: '0', actual: String(leaks.length), status: leaks.length ? 'fail' : 'pass', note: 'les secrets de 10 §2 sont cités par emplacement et nature uniquement' });

  const unmapped = [{ item: 'Code source LiaWeb (SVN, branche trunk)', reason: 'dépôt non disponible : classes, tables et relations réelles non cartographiées au-delà de ce que la doc nomme' }, ...dx.unmapped];
  const nodesConf = count(nodes, (n) => n.confidence);
  const edgesConf = count(edges, (e) => e.confidence);
  const stats: Stats = {
    generatedAt: now,
    mode: 'docs-only',
    nodes: nodes.length,
    edges: edges.length,
    byType: count(nodes, (n) => n.type),
    byRelation: count(edges, (e) => e.relation),
    byConfidence: { V: nodesConf.V ?? 0, H: nodesConf.H ?? 0 },
    edgesByConfidence: { V: edgesConf.V ?? 0, H: edgesConf.H ?? 0 },
    docOnlyNodes: nodes.filter((n) => n.docOnly).length,
    checks,
    unmapped,
  };
  return { graph, docs, stats, log };
}
