import { motion } from 'framer-motion';
import { Cog, Globe, Layers, Plug, Server } from 'lucide-react';
import { useMemo } from 'react';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, SectionTitle, cx } from '../components/ui';
import { inEdges, nodeById, nodesOf, outEdges, passesDomain } from '../lib/data';
import { REL, SYSTEM_CAT } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import type { GEdge, GNode } from '../types/graph';
import { DocRef } from './Workflows';

const linked = (id: string, rels: string[], dir: 'in' | 'out'): GEdge[] => ((dir === 'in' ? inEdges : outEdges).get(id) ?? []).filter((e) => rels.includes(e.relation));
const TECH_CAT: Record<string, string> = {
  langage: 'Langage & build', build: 'Langage & build', serveur: 'Serveur & interface', interface: 'Serveur & interface', api: 'API, SOAP, GED', persistance: 'Persistance & moteur interne', interne: 'Persistance & moteur interne',
  workflow: 'Workflow, planification, cache', planification: 'Workflow, planification, cache', cache: 'Workflow, planification, cache', script: 'Scripts & documents', document: 'Scripts & documents',
  securite: 'Sécurité & journalisation', journal: 'Sécurité & journalisation', sgbd: 'SGBD reconnus', frontend: 'Frontend', test: 'Outils & tests', outil: 'Outils & tests',
};

function SysCard({ n, filter }: { n: GNode; filter: string | null }) {
  const [sel, inspect] = useInspect();
  const callers = linked(n.id, ['calls', 'uses'], 'in').filter((e) => passesDomain(nodeById.get(e.source)!, filter));
  const conf = linked(n.id, ['configures'], 'in');
  const risks = linked(n.id, ['affects'], 'in');
  return (
    <Card className={cx('flex h-full min-w-0 flex-col gap-2 p-4', sel === n.id && 'ring-1 ring-[var(--ring)]')}>
      <div className="flex items-start gap-2">
        <button onClick={() => inspect(n.id)} className="min-w-0 flex-1 text-left text-[13.5px] font-semibold text-fg [overflow-wrap:anywhere] hover:text-accent-2">
          {n.label}
        </button>
        <ConfidenceBadge c={n.confidence} compact from={n.provenance[0]?.confidenceFrom} />
      </div>
      {callers.length > 0 ? (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">appelé par</span>
          {callers.map((e) => (
            <span key={e.id} className="inline-flex max-w-full items-center gap-1">
              <NodeChip id={e.source} compact />
              {e.confidence === 'H' && <span className="text-[10px] text-muted">[H]</span>}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-[11.5px] text-muted">Aucun paquet ni classe relié par la doc.</div>
      )}
      {conf.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">configuré par</span>
          {conf.map((e) => (
            <NodeChip key={e.id} id={e.source} compact />
          ))}
        </div>
      )}
      {risks.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 text-[10.5px] uppercase tracking-[0.08em] text-muted">risques</span>
          {risks.map((e) => (
            <NodeChip key={e.id} id={e.source} compact label={nodeById.get(e.source)!.label.split(' · ')[0]} />
          ))}
        </div>
      )}
      <div className="mt-auto pt-1">
        <DocRef n={n} />
      </div>
    </Card>
  );
}

export default function DataIntegrations() {
  const store = useStore();
  const systems = nodesOf('system');
  const cats = Object.keys(SYSTEM_CAT).map((k) => [k, systems.filter((s) => s.subtype === k)] as const).filter(([, l]) => l.length);
  const rest = useMemo(() => nodesOf('endpoint').filter((e) => e.label.startsWith('/rest/api/{version}/') && e.provenance.some((p) => p.method === 'rest-table')), []);
  const otherEps = nodesOf('endpoint').filter((e) => !rest.includes(e));
  const configs = nodesOf('config');
  const tech = nodesOf('tech');
  const techGroups = [...new Set(Object.values(TECH_CAT))].map((g) => [g, tech.filter((t) => TECH_CAT[t.subtype ?? ''] === g)] as const).filter(([, l]) => l.length);

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-8">
      <SectionTitle eyebrow="Intégrations" title="Systèmes externes, API, configuration">
        06-api-and-integrations : presque toutes les URL et identifiants sont en base (table LBT_PREFERENCE), chaque appel sortant est tracé dans INT_HISTORY. Un système n’apparaît que si la doc le nomme ; un lien « appelé par » vient d’une ligne de tableau ou d’une phrase de la doc.
      </SectionTitle>

      {cats.map(([k, list]) => (
        <section key={k} className="mb-9">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Globe size={15} className="text-[var(--t-system)]" /> {SYSTEM_CAT[k]} <span className="text-[12px] font-normal text-muted">{list.length}</span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((n) => (
              <motion.div key={n.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <SysCard n={n} filter={store.domainFilter} />
              </motion.div>
            ))}
          </div>
        </section>
      ))}

      <SectionTitle eyebrow="API exposée" title={`API REST Jersey · ${rest.length} ressources (06 §5.2)`}>
        Servlet Jersey sur /rest/*, chemins de la forme /rest/api/{'{version}'}/… (06:128). Aucune authentification globale : chaque méthode lit l’en-tête Basic (06:129).
      </SectionTitle>
      <Card className="mb-10 overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12.5px]">
          <thead className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Ressource</th>
              <th className="px-4 py-2.5 font-semibold">Chemin</th>
              <th className="px-4 py-2.5 font-semibold">Méthodes</th>
              <th className="px-4 py-2.5 font-semibold">Sous-chemins / ressources</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rest.map((e) => {
              const by = linked(e.id, ['exposes'], 'in');
              return (
                <tr key={e.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {by.map((x) => (
                        <NodeChip key={x.id} id={x.source} compact />
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <NodeChip id={e.id} compact label={e.label.replace('/rest/api/{version}', '…')} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11.5px] text-fg-2">
                    {String(e.props.methodes ?? '')}
                    {e.props.authentification && <div className="font-sans text-[11px] text-muted">{String(e.props.authentification)}</div>}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-muted [overflow-wrap:anywhere]">{[e.props.sousChemins, e.props.sousRessources].filter(Boolean).join(' · ')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <div className="mb-10 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Server size={15} className="text-[var(--t-system)]" /> Points d’entrée URL <span className="text-[12px] font-normal text-muted">{otherEps.length}</span>
          </h3>
          <Card className="divide-y divide-[var(--border)]">
            {otherEps
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((e) => {
                const by = [...linked(e.id, ['exposes', 'applies-to', 'uses'], 'in')];
                return (
                  <div key={e.id} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2">
                    <NodeChip id={e.id} compact />
                    <span className="text-[10.5px] text-muted">{e.subtype}</span>
                    <span className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
                      {by.slice(0, 4).map((x) => (
                        <span key={x.id} className="inline-flex items-center gap-1 text-[10.5px] text-muted">
                          {REL[x.relation].label}
                          <NodeChip id={x.source} compact />
                        </span>
                      ))}
                    </span>
                  </div>
                );
              })}
          </Card>
        </div>
        <div className="min-w-0">
          <h3 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg">
            <Cog size={15} className="text-[var(--t-config)]" /> Configuration <span className="text-[12px] font-normal text-muted">{configs.length}</span>
          </h3>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">Propriétés JVM (-D…) et préférences citées par leur nom. Les valeurs ne sont jamais copiées ; les secrets en dur sont listés par emplacement dans Risques (10 §2).</p>
          <Card className="divide-y divide-[var(--border)]">
            {configs.map((c) => {
              const tg = linked(c.id, ['configures'], 'out');
              return (
                <div key={c.id} className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2">
                  <NodeChip id={c.id} compact />
                  <span className="text-[10.5px] text-muted">{c.subtype}</span>
                  <span className="ml-auto flex min-w-0 flex-wrap justify-end gap-1">
                    {tg.map((x) => (
                      <NodeChip key={x.id} id={x.target} compact />
                    ))}
                  </span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>

      <SectionTitle eyebrow="Pile technique" title="Technologies citées (02 §1, 00 §3)">
        Versions telles qu’écrites à côté du nom dans la doc ; plusieurs versions citées sont toutes affichées (ex. Tomcat 9 pour l’application, Tomcat 6 dans lib/).
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {techGroups.map(([g, list]) => (
          <Card key={g} className="p-4">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-fg">
              <Layers size={13} className="text-[var(--t-structure)]" /> {g}
            </div>
            <div className="flex flex-col gap-1.5">
              {list.map((t) => (
                <div key={t.id} className="flex min-w-0 items-center gap-2">
                  <NodeChip id={t.id} compact />
                  <span className="min-w-0 truncate text-[11px] text-muted" title={String(t.props.versionsCitees ?? '')}>
                    {String(t.props.versionsCitees ?? '')}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <div className="mt-6 flex items-center gap-2 text-[11.5px] text-muted">
        <Plug size={12} /> {systems.length} systèmes cités · {nodesOf('endpoint').length} points d’entrée · {configs.length} propriétés · {tech.length} technologies
      </div>
    </div>
  );
}
