import { motion } from 'framer-motion';
import { Boxes, Network, Search, Shapes } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, Empty, TypeGlyph, cx } from '../components/ui';
import { degree, inEdges, nodeById, nodesOf, outEdges, passesDomain } from '../lib/data';
import { REL, TYPE } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import type { GNode, NodeType } from '../types/graph';
import { DocRef } from './Workflows';

const TABS: NodeType[] = ['module', 'package', 'page', 'service', 'class', 'object', 'table', 'view', 'migration', 'system', 'endpoint', 'tech', 'config', 'brick', 'resource', 'lifecycle', 'workflow', 'actCode', 'rule', 'sourceRoot', 'file', 'licence', 'convention', 'term'];
const MODULE_GROUPS: [string, NodeType[]][] = [
  ['Paquets', ['package']],
  ['Pages', ['page']],
  ['Services', ['service']],
  ['Classes', ['class']],
  ['Tables & vues', ['table', 'view']],
];
const PAGE = 90;

function ModuleCard({ m }: { m: GNode }) {
  const nav = useNavigate();
  const [sel, inspect] = useInspect();
  const members = (outEdges.get(m.id) ?? []).filter((e) => e.relation === 'contains').map((e) => nodeById.get(e.target)!).filter(Boolean);
  const issues = new Set(members.flatMap((x) => (inEdges.get(x.id) ?? []).filter((e) => e.relation === 'affects' && nodeById.get(e.source)?.type === 'issue').map((e) => e.source)));
  return (
    <Card className={cx('flex h-full min-w-0 flex-col gap-3 p-5', sel === m.id && 'ring-1 ring-[var(--ring)]')}>
      <div className="flex items-start gap-2">
        <TypeGlyph type="module" size={12} />
        <button onClick={() => inspect(m.id)} className="min-w-0 flex-1 text-left text-[15px] font-semibold leading-tight text-fg hover:text-accent-2">
          {m.label}
        </button>
        <ConfidenceBadge c={m.confidence} compact from={m.provenance[0]?.confidenceFrom} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-fg-2">{String(m.props.domaine ?? '')}</span>
        <DocRef n={m} />
      </div>
      {m.description && <p className="line-clamp-3 text-[12.5px] leading-relaxed text-fg-2">{m.description}</p>}
      <div className="grid grid-cols-5 gap-1.5 text-center">
        {MODULE_GROUPS.map(([label, types]) => (
          <div key={label} className="rounded-lg border border-line bg-surface-2/60 px-1 py-1.5">
            <div className="tnum text-[15px] font-semibold text-fg">{members.filter((x) => types.includes(x.type)).length}</div>
            <div className="truncate text-[10px] text-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        {MODULE_GROUPS.map(([label, types]) => {
          const list = members.filter((x) => types.includes(x.type));
          if (!list.length) return null;
          return (
            <div key={label} className="flex min-w-0 flex-wrap items-center gap-1">
              <span className="mr-1 w-[78px] shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-muted">{label}</span>
              {list.slice(0, 5).map((x) => (
                <NodeChip key={x.id} id={x.id} compact />
              ))}
              {list.length > 5 && <span className="text-[11px] text-muted">+{list.length - 5}</span>}
            </div>
          );
        })}
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button onClick={() => nav(`/diagrams?d=module&m=${encodeURIComponent(m.id)}`)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
          <Shapes size={13} /> Diagramme
        </button>
        <button onClick={() => nav(`/graph?n=${encodeURIComponent(m.id)}&focus=1`)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
          <Network size={13} /> Graphe
        </button>
        {issues.size > 0 && <span className="ml-auto text-[11.5px] text-critical">{issues.size} problème(s) lié(s)</span>}
      </div>
    </Card>
  );
}

function NodeCard({ n }: { n: GNode }) {
  const [sel, inspect] = useInspect();
  const rels = [...(outEdges.get(n.id) ?? []), ...(inEdges.get(n.id) ?? [])].filter((e) => !['documented-in', 'mentions'].includes(e.relation));
  const top = rels.slice(0, 4);
  return (
    <Card className={cx('flex h-full min-w-0 flex-col gap-2 p-4', sel === n.id && 'ring-1 ring-[var(--ring)]')}>
      <div className="flex items-start gap-2">
        <span className="mt-1">
          <TypeGlyph type={n.type} size={10} />
        </span>
        <button onClick={() => inspect(n.id)} className="min-w-0 flex-1 text-left font-mono text-[13px] font-semibold leading-snug text-fg [overflow-wrap:anywhere] hover:text-accent-2">
          {n.label}
        </button>
        <ConfidenceBadge c={n.confidence} compact from={n.provenance[0]?.confidenceFrom} />
      </div>
      {(n.subtype || n.props.paquet) && (
        <div className="min-w-0 truncate text-[11px] text-muted" title={[n.subtype, n.props.paquet].filter(Boolean).join(' · ')}>
          {[n.subtype && n.subtype.toLowerCase() !== TYPE[n.type].label.toLowerCase() ? n.subtype : '', n.props.paquet].filter(Boolean).join(' · ')}
        </div>
      )}
      {n.description && <p className="line-clamp-2 text-[12px] leading-relaxed text-fg-2">{n.description}</p>}
      {top.length > 0 && (
        <div className="flex min-w-0 flex-col gap-1">
          {top.map((e) => {
            const other = e.source === n.id ? e.target : e.source;
            return (
              <div key={e.id} className="flex min-w-0 items-center gap-1.5 text-[10.5px] text-muted">
                <span className="w-[86px] shrink-0 truncate">{e.source === n.id ? REL[e.relation].label : `← ${REL[e.relation].label}`}</span>
                <NodeChip id={other} compact className="min-w-0" />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <DocRef n={n} />
        <span className="text-[10.5px] text-muted tnum">{rels.length} relation(s)</span>
      </div>
    </Card>
  );
}

export default function Catalog() {
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const type = (TABS.includes(params.get('type') as NodeType) ? params.get('type') : 'module') as NodeType;
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t, nodesOf(t).length])), []);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return nodesOf(type)
      .filter((n) => store.confidence.has(n.confidence) && passesDomain(n, store.domainFilter))
      .filter((n) => !ql || n.label.toLowerCase().includes(ql) || n.aliases.some((a) => a.toLowerCase().includes(ql)) || (n.description ?? '').toLowerCase().includes(ql) || String(n.props.paquet ?? '').toLowerCase().includes(ql))
      .sort((a, b) => (type === 'module' ? String(a.props.domaine).localeCompare(String(b.props.domaine)) : 0) || (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.label.localeCompare(b.label));
  }, [type, q, store.confidence, store.domainFilter]);

  return (
    <div className="mx-auto max-w-[1500px] px-6 pb-16 pt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Catalogue</div>
          <h2 className="text-[22px] font-semibold tracking-tight text-fg">Modules et nœuds, en cartes</h2>
          <p className="mt-1.5 max-w-3xl text-[13.5px] leading-relaxed text-fg-2">Une lecture sans canevas : chaque carte est un nœud du graphe, avec ses relations principales et la ligne de doc qui le prouve. Les modules sont ceux de 04 (parties A et B).</p>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} placeholder={`Chercher dans ${TYPE[type].plural.toLowerCase()}…`} className="h-8 w-[260px] max-w-full rounded-lg border border-line bg-surface pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-muted" />
        </div>
      </div>
      <div className="mb-6 flex flex-wrap gap-1">
        {TABS.filter((t) => counts[t]).map((t) => (
          <button key={t} onClick={() => (setParams((p) => (p.set('type', t), p)), setLimit(PAGE))} className={cx('inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors', t === type ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}>
            <TypeGlyph type={t} size={9} /> {TYPE[t].plural} <span className="text-[10.5px] text-muted tnum">{counts[t]}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={type === 'module' ? <Boxes size={18} /> : <Search size={18} />} title="Aucun élément ne correspond" />
      ) : (
        <div className={cx('grid grid-cols-[minmax(0,1fr)] gap-4', type === 'module' ? 'md:grid-cols-2 2xl:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4')}>
          {list.slice(0, limit).map((n, i) => (
            <motion.div key={n.id} className="min-w-0" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 16) * 0.015 }}>
              {type === 'module' ? <ModuleCard m={n} /> : <NodeCard n={n} />}
            </motion.div>
          ))}
        </div>
      )}
      {list.length > limit && (
        <div className="mt-6 flex justify-center">
          <button onClick={() => setLimit(limit + PAGE)} className="rounded-lg border border-line px-4 py-2 text-[12.5px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
            Afficher {Math.min(PAGE, list.length - limit)} de plus ({list.length - limit} restants)
          </button>
        </div>
      )}
    </div>
  );
}
