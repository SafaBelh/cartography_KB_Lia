import { motion } from 'framer-motion';
import { Boxes, Database, FolderTree, GitMerge, Link2, Plug, Route, ScrollText } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DiagramLegend, LayeredDiagram, Pipeline, type DColumn, type DEdge } from '../components/Diagram';
import { Card, cx } from '../components/ui';
import { docsBundle, graph, inEdges, nodeById, nodesOf, outEdges } from '../lib/data';
import { SYSTEM_CAT } from '../lib/meta';
import { buildSchema } from '../lib/schema';
import type { GEdge, GNode, NodeType, Relation } from '../types/graph';

const WEAK: Relation[] = ['documented-in', 'mentions', 'affects', 'defines', 'implements', 'recommends'];
const toD = (e: GEdge): DEdge => ({ id: e.id, source: e.source, target: e.target, relation: e.relation, confidence: e.confidence, label: e.label });
const edgesAmong = (ids: Set<string>, rels?: Relation[]) => graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && !WEAK.includes(e.relation) && (!rels || rels.includes(e.relation))).map(toD);
const byLabel = (a: string, b: string) => (nodeById.get(a)?.label ?? a).localeCompare(nodeById.get(b)?.label ?? b);

// ------------------------------------------------------------------ diagram builders
const MODULE_COLS: [string, NodeType[]][] = [
  ['Paquets', ['package']],
  ['Pages Wicket', ['page']],
  ['Services & classes', ['service', 'class']],
  ['Données', ['table', 'view', 'object', 'migration']],
  ['Systèmes, URL, config', ['system', 'endpoint', 'config', 'tech', 'file', 'resource', 'actCode']],
];
function moduleDiagram(mid: string) {
  const members = new Set((outEdges.get(mid) ?? []).filter((e) => e.relation === 'contains').map((e) => e.target));
  const shown = new Set(members);
  const allowed = new Set(MODULE_COLS.flatMap(([, t]) => t));
  for (const m of members) {
    for (const e of [...(outEdges.get(m) ?? []), ...(inEdges.get(m) ?? [])]) {
      if (WEAK.includes(e.relation)) continue;
      const o = e.source === m ? e.target : e.source;
      const n = nodeById.get(o);
      if (n && allowed.has(n.type) && !(n.type === 'system' && n.subtype === 'database')) shown.add(o);
    }
  }
  // keep the diagram legible: module members first, then the most connected neighbours
  const list = [...shown].sort((a, b) => Number(members.has(b)) - Number(members.has(a)));
  const kept = new Set(list.slice(0, 70));
  const columns: DColumn[] = MODULE_COLS.map(([title, types]) => ({ title, ids: [...kept].filter((id) => types.includes(nodeById.get(id)!.type)).sort(byLabel) }));
  return { columns, edges: edgesAmong(kept), truncated: shown.size - kept.size };
}

function requestDiagram() {
  const filters = nodesOf('step')
    .filter((s) => s.props.workflow === 'wf:filtres')
    .sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre))
    .flatMap((s) => (inEdges.get(s.id) ?? []).filter((e) => e.relation === 'implements').map((e) => e.source));
  const eps = new Set<string>();
  const exposers = new Set<string>();
  for (const e of graph.edges) {
    const t = nodeById.get(e.target);
    if (t?.type !== 'endpoint') continue;
    if (e.relation === 'applies-to' && filters.includes(e.source)) eps.add(e.target);
    if (e.relation === 'exposes') {
      eps.add(e.target);
      exposers.add(e.source);
    }
  }
  const ids = new Set([...filters, ...eps, ...exposers]);
  return {
    columns: [
      { title: 'Filtres (ordre web.xml)', ids: [...new Set(filters)], fixed: true },
      { title: 'Points d’entrée', ids: [...eps].sort(byLabel) },
      { title: 'Classes qui exposent', ids: [...exposers].sort(byLabel) },
    ],
    edges: edgesAmong(ids, ['applies-to', 'exposes', 'uses']),
  };
}

function persistenceDiagram() {
  const maps = graph.edges.filter((e) => e.relation === 'maps-to');
  const ents = [...new Set(maps.filter((e) => nodeById.get(e.source)!.type !== 'object').map((e) => e.source))].sort(byLabel);
  const objs = [...new Set(maps.filter((e) => nodeById.get(e.source)!.type === 'object').map((e) => e.source))].sort(byLabel);
  const tbls = [...new Set(maps.map((e) => e.target))].sort(byLabel);
  return { columns: [{ title: 'Entités JPA (05 §3.2)', ids: ents }, { title: 'Tables', ids: tbls }, { title: 'Objets du moteur LIA (11 §1)', ids: objs }], edges: maps.map(toD) };
}

const schema = buildSchema(graph, docsBundle);
function tableLinksDiagram() {
  const ok = schema.links.filter((l) => l.fromTable && l.toTable);
  // columns by depth along the documented chain
  const depth = new Map<string, number>();
  const roots = [...new Set(ok.map((l) => l.fromTable!))].filter((t) => !ok.some((l) => l.toTable === t));
  roots.forEach((r) => depth.set(r, 0));
  for (let i = 0; i < 6; i++) for (const l of ok) if (depth.has(l.fromTable!)) depth.set(l.toTable!, Math.max(depth.get(l.toTable!) ?? 0, depth.get(l.fromTable!)! + 1));
  const max = Math.max(0, ...depth.values());
  const columns = Array.from({ length: max + 1 }, (_, i) => ({ title: i === 0 ? 'Racine de la chaîne' : `Niveau ${i}`, ids: [...depth.entries()].filter(([, d]) => d === i).map(([t]) => t).sort(byLabel) }));
  const edges: DEdge[] = ok.map((l, i) => ({ id: `link-${i}`, source: l.fromTable!, target: l.toTable!, relation: 'sequence', confidence: 'H', label: l.card }));
  return { columns, edges, unresolved: schema.links.filter((l) => !l.fromTable || !l.toTable), source: schema.links[0]?.source };
}

function integrationsDiagram() {
  const calls = graph.edges.filter((e) => e.relation === 'calls' && nodeById.get(e.target)?.type === 'system');
  const callers = [...new Set(calls.map((e) => e.source))].sort(byLabel);
  const order = Object.keys(SYSTEM_CAT);
  const systems = [...new Set(calls.map((e) => e.target))].sort((a, b) => order.indexOf(nodeById.get(a)!.subtype ?? '') - order.indexOf(nodeById.get(b)!.subtype ?? '') || byLabel(a, b));
  return { columns: [{ title: 'Code appelant', ids: callers }, { title: 'Systèmes externes', ids: systems }], edges: calls.map(toD) };
}

function migrationDiagram() {
  const migs = nodesOf('migration');
  const root = migs.filter((m) => m.subtype === 'racine' || m.subtype === 'manifeste').map((m) => m.id);
  const folders = migs.filter((m) => /dossier/.test(m.subtype ?? '')).map((m) => m.id).sort(byLabel);
  const scripts = migs.filter((m) => m.subtype === 'script' || m.subtype === 'tâche Java').map((m) => m.id).sort(byLabel);
  const created = [...new Set(graph.edges.filter((e) => e.relation === 'creates' && nodeById.get(e.source)?.type === 'migration').map((e) => e.target))].sort(byLabel);
  const ids = new Set([...root, ...folders, ...scripts, ...created, 'cls:DatabaseUpdater'].filter((x) => nodeById.has(x)));
  return {
    columns: [
      { title: 'Démarrage', ids: ['cls:DatabaseUpdater', ...root].filter((x) => nodeById.has(x)) },
      { title: 'Dossiers', ids: folders },
      { title: 'Scripts & tâches', ids: scripts },
      { title: 'Vues (re)créées', ids: created },
    ],
    edges: edgesAmong(ids, ['part-of', 'creates']),
  };
}

function workflowDiagram(wfId: string) {
  const steps = nodesOf('step')
    .filter((s) => s.props.workflow === wfId)
    .sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre));
  const ids = new Set(steps.map((s) => s.id));
  const seq = graph.edges.filter((e) => e.relation === 'sequence' && ids.has(e.source) && ids.has(e.target));
  const linear = steps.every((s) => seq.filter((e) => e.source === s.id).length <= 1 && seq.filter((e) => e.target === s.id).length <= 1) && seq.length === steps.length - 1;
  const sub = (s: GNode) =>
    (inEdges.get(s.id) ?? [])
      .filter((e) => e.relation === 'implements')
      .map((e) => nodeById.get(e.source)!.label)
      .filter((l) => l !== s.label.replace(/^\d+\.\s*/, ''))
      .slice(0, 3)
      .join(' · ');
  if (linear) return { kind: 'pipeline' as const, steps: steps.map((s) => ({ id: s.id, label: s.label.replace(/^\d+\.\s*/, ''), sub: sub(s) || undefined })) };
  // DAG: rank = longest path from a source
  const rank = new Map<string, number>(steps.map((s) => [s.id, 0]));
  for (let i = 0; i < steps.length; i++) for (const e of seq) rank.set(e.target, Math.max(rank.get(e.target)!, rank.get(e.source)! + 1));
  const max = Math.max(0, ...rank.values());
  return {
    kind: 'layered' as const,
    columns: Array.from({ length: max + 1 }, (_, i) => ({ title: `Rang ${i + 1}`, ids: steps.filter((s) => rank.get(s.id) === i).map((s) => s.id) })),
    edges: seq.map(toD),
  };
}

// ------------------------------------------------------------------ view
const DIAGRAMS = [
  { id: 'module', label: 'Module fonctionnel', icon: Boxes, intro: 'Ce que la section du module (04) cite — paquets, pages, services, classes, tables — et leurs voisins directs dans le graphe (paquets des classes, tables des entités, systèmes appelés).' },
  { id: 'requete', label: 'Chaîne d’une requête', icon: Route, intro: 'Filtres de web.xml dans l’ordre (02 §3), points d’entrée auxquels ils s’appliquent, et classes qui exposent ces URL (servlets, ressources REST de 06 §5.2, pages montées).' },
  { id: 'persistance', label: 'Entités et tables', icon: Database, intro: 'Correspondance entité JPA → table (05 §3.2) et objet du moteur LIA → table (11 §1, 05 §2.2). Deux chemins de persistance vers la même base.' },
  { id: 'tables', label: 'Liens entre tables', icon: Link2, intro: 'La « Chaîne principale » de 05 : liens de table à table avec la cardinalité écrite. La doc dit qu’ils sont garantis par des clés étrangères mais ne nomme pas les colonnes : aucune colonne n’est reliée.' },
  { id: 'integrations', label: 'Intégrations', icon: Plug, intro: 'Paquets et classes qui appellent un système externe (lignes des tableaux de 06, phrases explicites), systèmes rangés par catégorie.' },
  { id: 'migrations', label: 'Migrations dbupdate', icon: FolderTree, intro: 'DatabaseUpdater au démarrage, dossiers de version, scripts et tâches Java nommés par la doc, vues recréées par maj99 (05 §3.3, §4).' },
  { id: 'workflow', label: 'Enchaînement', icon: GitMerge, intro: 'Étapes d’un enchaînement de 07 / 02 / 05 dans l’ordre écrit ; sous chaque étape, les classes citées sur sa ligne. Le diagramme de 07 §1 suit ses flèches.' },
];

export default function Diagrams() {
  const [params, setParams] = useSearchParams();
  const d = DIAGRAMS.find((x) => x.id === params.get('d')) ?? DIAGRAMS[0];
  const modules = nodesOf('module');
  const mid = params.get('m') && nodeById.has(params.get('m')!) ? params.get('m')! : modules.find((m) => m.label === 'Marché')?.id ?? modules[0]?.id;
  const workflows = nodesOf('workflow');
  const wfId = params.get('wf') && nodeById.has(params.get('wf')!) ? params.get('wf')! : 'wf:calcul-decompte';
  const set = (kv: Record<string, string>) =>
    setParams((p) => {
      for (const [k, v] of Object.entries(kv)) p.set(k, v);
      return p;
    });

  const body = useMemo(() => {
    switch (d.id) {
      case 'module': {
        const m = moduleDiagram(mid);
        return { layered: m, note: m.truncated > 0 ? `${m.truncated} voisin(s) supplémentaire(s) non affichés (70 nœuds au plus).` : undefined };
      }
      case 'requete':
        return { layered: requestDiagram() };
      case 'persistance':
        return { layered: persistenceDiagram() };
      case 'tables': {
        const t = tableLinksDiagram();
        return { layered: t, labels: true, note: t.unresolved.length ? `Non dessiné : ${t.unresolved.map((l) => `${l.from} ${l.card} ${l.to}`).join(', ')} — « Lot » désigne deux objets du moteur (flot, flcs), la table n’est pas déterminée.` : undefined, src: t.source };
      }
      case 'integrations':
        return { layered: integrationsDiagram() };
      case 'migrations':
        return { layered: migrationDiagram() };
      default: {
        const w = workflowDiagram(wfId);
        return w.kind === 'pipeline' ? { pipeline: w.steps } : { layered: { columns: w.columns, edges: w.edges } };
      }
    }
  }, [d.id, mid, wfId]);

  return (
    <div className="flex h-full min-h-[600px]">
      <nav className="hidden w-[250px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-surface px-3 py-5 lg:flex" aria-label="Diagrammes">
        <div className="mb-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">Diagrammes techniques</div>
        {DIAGRAMS.map((x) => {
          const Icon = x.icon;
          return (
            <button key={x.id} onClick={() => set({ d: x.id })} className={cx('flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors', x.id === d.id ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
              <Icon size={14} className="shrink-0 text-muted" /> {x.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-12 pt-6">
        <div className="mb-3 flex flex-wrap gap-1 lg:hidden">
          {DIAGRAMS.map((x) => (
            <button key={x.id} onClick={() => set({ d: x.id })} className={cx('rounded-lg border px-2.5 py-1 text-[12px]', x.id === d.id ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2')}>
              {x.label}
            </button>
          ))}
        </div>
        <h2 className="mb-1 text-[20px] font-semibold tracking-tight text-fg">{d.id === 'module' ? `Module · ${nodeById.get(mid)?.label}` : d.id === 'workflow' ? nodeById.get(wfId)?.label : d.label}</h2>
        <p className="mb-4 max-w-4xl text-[13px] leading-relaxed text-fg-2">{d.intro}</p>
        {d.id === 'module' && (
          <div className="mb-4 flex flex-wrap gap-1">
            {modules.map((m) => (
              <button key={m.id} onClick={() => set({ m: m.id })} className={cx('rounded-lg border px-2.5 py-1 text-[12px] transition-colors', m.id === mid ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}>
                {m.label}
              </button>
            ))}
          </div>
        )}
        {d.id === 'workflow' && (
          <div className="mb-4 flex flex-wrap gap-1">
            {workflows.map((w) => (
              <button key={w.id} onClick={() => set({ wf: w.id })} className={cx('rounded-lg border px-2.5 py-1 text-[12px] transition-colors', w.id === wfId ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}>
                {w.label}
              </button>
            ))}
          </div>
        )}
        <motion.div key={`${d.id}-${mid}-${wfId}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <Card className="dot-grid p-4">
            {body.layered && (body.layered.columns.some((c) => c.ids.length) ? <LayeredDiagram columns={body.layered.columns} edges={body.layered.edges} edgeLabels={'labels' in body && !!body.labels} ariaLabel={d.label} /> : <div className="p-8 text-center text-[13px] text-muted">La doc ne cite aucun élément pour ce diagramme.</div>)}
            {body.pipeline && <Pipeline steps={body.pipeline} perRow={4} ariaLabel={d.label} />}
          </Card>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <DiagramLegend />
            {'src' in body && body.src && (
              <Link to={`/docs/${body.src.doc}?line=${body.src.line}`} className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-accent">
                <ScrollText size={11} /> {body.src.doc}:{body.src.line}
              </Link>
            )}
          </div>
          {'note' in body && body.note && <p className="mt-2 text-[12px] leading-relaxed text-muted">{body.note}</p>}
        </motion.div>
      </div>
    </div>
  );
}
