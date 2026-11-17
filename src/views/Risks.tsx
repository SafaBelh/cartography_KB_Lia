import { AnimatePresence, motion } from 'framer-motion';
import { CircleHelp, Search, ShieldAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { CategoryBadge, Card, ConfidenceBadge, Empty, Pill, SectionTitle, cx } from '../components/ui';
import { docIdFromFile, nodeById, nodesOf, outEdges, passesDomain } from '../lib/data';
import { ISSUE_CAT } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import type { GNode } from '../types/graph';

const all = [...nodesOf('issue'), ...nodesOf('question')];
const STATUTS: [string, string][] = [['confirmé', 'Confirmé (10 : constaté dans le code)'], ['potentiel', 'Potentiel (à vérifier)'], ['constat', 'Constat (dette, limites)']];
const catOrder = Object.keys(ISSUE_CAT);

export default function Risks() {
  const store = useStore();
  const [params, setParams] = useSearchParams();
  const [selected, inspect] = useInspect();
  const kind = params.get('kind') ?? 'all';
  const [cat, setCat] = useState<string | null>(null);
  const [sev, setSev] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const cats = useMemo(() => [...new Set(all.filter((n) => kind === 'all' || n.type === (kind === 'question' ? 'question' : 'issue')).map((n) => String(n.props.categorie ?? '')))].filter(Boolean), [kind]);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all
      .filter((n) => kind === 'all' || n.type === (kind === 'question' ? 'question' : 'issue'))
      .filter((n) => !cat || n.props.categorie === cat)
      .filter((n) => !sev || n.props.statut === sev)
      .filter((n) => store.confidence.has(n.confidence))
      .filter((n) => !ql || (n.description ?? n.label).toLowerCase().includes(ql) || targets(n).some((t) => t.label.toLowerCase().includes(ql)))
      .filter((n) => !store.domainFilter || !targets(n).length || targets(n).some((t) => passesDomain(t, store.domainFilter)))
      .sort((a, b) => (a.type === b.type ? 0 : a.type === 'issue' ? -1 : 1) || (a.type === 'issue' ? catOrder.indexOf(String(a.subtype)) - catOrder.indexOf(String(b.subtype)) : 0));
  }, [kind, cat, sev, q, store.confidence, store.domainFilter]);

  const setKind = (k: string) =>
    setParams((p) => {
      k === 'all' ? p.delete('kind') : p.set('kind', k);
      return p;
    });

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-8">
      <SectionTitle eyebrow="Risques & questions" title="Ce qu’il faut savoir avant de toucher à LiaWeb">
        Problèmes connus, sécurité, secrets (emplacements seulement), dette et limites de 10 ; questions pour l’équipe de 01, 05, 06, 07, 08, 09, 12 et 10 §4. Chacun est relié aux nœuds cités sur sa ligne.
      </SectionTitle>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-line p-1">
          {[
            ['all', `Tout (${all.length})`],
            ['issue', `Problèmes (${nodesOf('issue').length})`],
            ['question', `Questions (${nodesOf('question').length})`],
          ].map(([k, l]) => (
            <button key={k} onClick={() => (setKind(k), setCat(null))} className={cx('rounded-lg px-3 py-1.5 text-[12px] font-medium', kind === k ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:text-fg')}>
              {l}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer (ex. MD5, décompte, Pastell…)" className="h-8 w-[240px] rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-muted" />
        </div>
        {kind !== 'question' && (
          <div className="flex items-center gap-1">
            {STATUTS.map(([k, v]) => (
              <Pill key={k} active={sev === k} onClick={() => setSev(sev === k ? null : k)} title={v}>
                {k}
              </Pill>
            ))}
          </div>
        )}
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        <Pill active={!cat} onClick={() => setCat(null)}>
          Toutes catégories
        </Pill>
        {cats.map((c) => (
          <Pill key={c} active={cat === c} onClick={() => setCat(cat === c ? null : c)}>
            {c}
          </Pill>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty icon={<Search size={18} />} title="Aucun élément ne correspond aux filtres" />
      ) : (
        <motion.div layout className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence>
            {list.map((n) => (
              <RiskCard key={n.id} n={n} active={selected === n.id} onOpen={() => inspect(n.id, 'explain')} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function targets(n: GNode): GNode[] {
  return (outEdges.get(n.id) ?? []).filter((e) => e.relation === 'affects').map((e) => nodeById.get(e.target)!).filter(Boolean);
}

function RiskCard({ n, active, onOpen }: { n: GNode; active: boolean; onOpen: () => void }) {
  const p = n.provenance.find((x) => x.kind === 'doc' && x.line);
  const [id, ...rest] = n.label.split(' · ');
  const text = (n.description ?? n.label).replace(/^[A-Z]?\d+ · /, '').replace(new RegExp(`^${id} · `), '');
  const sevColor = n.type === 'issue' ? ISSUE_CAT[String(n.subtype)]?.color : undefined;
  return (
    <motion.div layout className="min-w-0" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.2 }}>
      <Card className={cx('relative flex h-full flex-col gap-3 overflow-hidden p-4', active && 'ring-1 ring-[var(--ring)]')}>
        {sevColor && <span className="absolute inset-y-0 left-0 w-[3px]" style={{ background: sevColor }} />}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {n.type === 'issue' ? <ShieldAlert size={15} className="text-[var(--t-risk)]" /> : <CircleHelp size={15} className="text-[var(--t-risk)]" />}
          <span className="shrink-0 font-mono text-[12px] font-semibold text-fg">{id}</span>
          {n.type === 'question' && <span className="min-w-0 truncate text-[11px] text-muted">{String(n.props.categorie ?? '')}</span>}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {n.type === 'issue' && <CategoryBadge cat={n.subtype} statut={String(n.props.statut ?? '')} />}
            <ConfidenceBadge c={n.confidence} compact from={n.provenance[0]?.confidenceFrom} />
          </span>
        </div>
        <button onClick={onOpen} className="text-left text-[13px] leading-relaxed text-fg [overflow-wrap:anywhere] hover:text-accent-2">
          {rest.length ? text : text}
        </button>
        {typeof n.props.emplacement === 'string' && n.props.emplacement && <div className="font-mono text-[11px] leading-snug text-muted [overflow-wrap:anywhere]">{n.props.emplacement}</div>}
        <div className="mt-auto flex flex-wrap gap-1">
          {targets(n).map((t) => (
            <NodeChip key={t.id} id={t.id} compact />
          ))}
        </div>
        {p && (
          <Link to={`/docs/${docIdFromFile(p.file)}?line=${p.line}`} className="font-mono text-[10.5px] text-muted hover:text-accent">
            {p.file.split('/').pop()}:{p.line}
          </Link>
        )}
      </Card>
    </motion.div>
  );
}
