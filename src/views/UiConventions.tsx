import { motion } from 'framer-motion';
import { Palette } from 'lucide-react';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, Empty, SectionTitle, cx } from '../components/ui';
import { nodesOf, outEdges } from '../lib/data';
import { useInspect } from '../lib/store';
import { DocRef } from './Workflows';

const ORDER = ['composant de référence', 'navigation et droits', 'fichiers Wicket', 'internationalisation', 'code Java'];
const INTRO: Record<string, string> = {
  'composant de référence': '12 §3 — le composant à réutiliser pour chaque besoin, et où il se trouve.',
  'navigation et droits': '12 §2 — menu, fil d’Ariane, contrôle des droits page par page, montage des pages.',
  'fichiers Wicket': '12 §4 — .java et .html côte à côte, libellés par paquet, Bootstrap 2, icônes.',
  internationalisation: '12 §5 — fichiers de libellés, valeurs « *** » non traduites, repli sur fr_FR.',
  'code Java': '09 §2 — encodage ISO-8859-1, CRLF, tabulations, services statiques, UUID…',
};

export default function UiConventions() {
  const [selected, inspect] = useInspect();
  const conv = nodesOf('convention');
  const groups = ORDER.map((k) => [k, conv.filter((c) => c.subtype === k)] as const).filter(([, l]) => l.length);
  if (!conv.length) return <Empty icon={<Palette size={18} />} title="Aucune convention extraite" />;
  return (
    <div className="mx-auto max-w-[1300px] px-6 pb-16 pt-8">
      <SectionTitle eyebrow="Conventions" title="Interface Wicket et code : ce que la doc demande de suivre">
        Conventions observées dans le code et décrites par 12-frontend-and-ui-conventions et 09-testing-and-quality §2. Elles ne sont pas outillées (aucune porte de qualité, 09 §4) : la doc les présente comme l’état constaté.
      </SectionTitle>
      {groups.map(([k, list]) => (
        <section key={k} className="mb-10">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-[16px] font-semibold capitalize text-fg">{k}</h3>
            <span className="text-[12.5px] text-muted">{INTRO[k]}</span>
          </div>
          <div className={cx('grid gap-3', k === 'composant de référence' ? 'md:grid-cols-2 xl:grid-cols-3' : 'md:grid-cols-2')}>
            {list.map((c, i) => {
              const rec = (outEdges.get(c.id) ?? []).filter((e) => e.relation === 'recommends').map((e) => e.target);
              const men = (outEdges.get(c.id) ?? []).filter((e) => e.relation === 'mentions').map((e) => e.target);
              return (
                <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}>
                  <Card className={cx('flex h-full flex-col gap-2 p-4', selected === c.id && 'ring-1 ring-[var(--ring)]')}>
                    <div className="flex items-start gap-2">
                      <button onClick={() => inspect(c.id)} className="min-w-0 flex-1 text-left text-[13.5px] font-semibold text-fg [overflow-wrap:anywhere] hover:text-accent-2">
                        {c.label}
                      </button>
                      <ConfidenceBadge c={c.confidence} compact from={c.provenance[0]?.confidenceFrom} />
                    </div>
                    {c.description && c.description !== c.label && <p className="text-[12.5px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{c.description}</p>}
                    {rec.length > 0 && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">recommande</span>
                        {rec.map((id) => (
                          <NodeChip key={id} id={id} compact />
                        ))}
                      </div>
                    )}
                    {men.length > 0 && (
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">cite</span>
                        {men.map((id) => (
                          <NodeChip key={id} id={id} compact />
                        ))}
                      </div>
                    )}
                    <div className="mt-auto pt-1">
                      <DocRef n={c} />
                    </div>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
