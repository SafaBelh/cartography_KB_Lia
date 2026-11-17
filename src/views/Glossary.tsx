import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { Card, Empty, SectionTitle, cx } from '../components/ui';
import { docIdFromFile, inEdges, nodesOf, outEdges, terms } from '../lib/data';
import { useInspect } from '../lib/store';

export default function Glossary() {
  const [q, setQ] = useState('');
  const [selected, inspect] = useInspect();
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return [...terms]
      .sort((a, b) => a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }))
      .filter((t) => !ql || t.label.toLowerCase().includes(ql) || (t.description ?? '').toLowerCase().includes(ql));
  }, [q]);
  const letters = [...new Set(list.map((t) => t.label[0].toUpperCase()))];
  return (
    <div className="mx-auto max-w-[1100px] px-6 pb-16 pt-8">
      <SectionTitle
        eyebrow="Glossaire"
        title={`${terms.length} termes du projet`}
        right={
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un terme…" className="h-8 w-[260px] rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-muted" />
          </div>
        }
      >
        Source : 11-glossary.md. Les définitions s’affichent au survol partout dans l’application (documentation, puces de nœuds).
      </SectionTitle>
      <Card className="mb-6 p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Codes d’objets du moteur LIA (11 §1)</div>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {nodesOf('object').map((o) => {
            const tbl = (outEdges.get(o.id) ?? []).find((e) => e.relation === 'maps-to');
            return (
              <div key={o.id} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] text-fg-2">
                <NodeChip id={o.id} compact />
                <span className="min-w-0">{String(o.props.objet ?? '')}</span>
                {tbl && <NodeChip id={tbl.target} compact />}
              </div>
            );
          })}
        </div>
      </Card>
      <div className="mb-5 flex flex-wrap gap-1">
        {letters.map((l) => (
          <a key={l} href={`#letter-${l}`} onClick={(e) => (e.preventDefault(), document.getElementById(`letter-${l}`)?.scrollIntoView({ behavior: 'smooth' }))} className="grid h-7 w-7 place-items-center rounded-lg border border-line text-[12px] font-medium text-fg-2 hover:border-line-strong hover:text-fg">
            {l}
          </a>
        ))}
      </div>
      {list.length === 0 && <Empty icon={<Search size={18} />} title={`Aucun terme pour « ${q} »`} />}
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((t, i) => {
          const defines = (outEdges.get(t.id) ?? []).filter((e) => e.relation === 'defines').map((e) => e.target);
          const mentions = (outEdges.get(t.id) ?? []).filter((e) => e.relation === 'mentions').map((e) => e.target);
          const usedIn = (inEdges.get(t.id) ?? []).filter((e) => e.relation === 'documented-in').length;
          const p = t.provenance.find((x) => x.kind === 'doc');
          const first = i === 0 || list[i - 1].label[0].toUpperCase() !== t.label[0].toUpperCase();
          return (
            <motion.div key={t.id} id={first ? `letter-${t.label[0].toUpperCase()}` : undefined} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 20) * 0.015 }} className="scroll-mt-6">
              <Card className={cx('flex h-full flex-col gap-2.5 p-4', selected === t.id && 'ring-1 ring-[var(--ring)]')}>
                <button onClick={() => inspect(t.id)} className="text-left text-[14.5px] font-semibold text-fg hover:text-accent-2">
                  {t.label}
                </button>
                <p className="text-[13px] leading-relaxed text-fg-2">{t.description}</p>
                {defines.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">définit</span>
                    {defines.map((id) => (
                      <NodeChip key={id} id={id} compact />
                    ))}
                  </div>
                )}
                {mentions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">mentionne</span>
                    {mentions.map((id) => (
                      <NodeChip key={id} id={id} compact />
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-3 pt-1 text-[10.5px] text-muted">
                  {p && (
                    <Link to={`/docs/${docIdFromFile(p.file)}?line=${p.line}`} className="font-mono hover:text-accent">
                      11-glossary.md:{p.line}
                    </Link>
                  )}
                  {usedIn > 0 && <span>{usedIn} doc(s)</span>}
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
