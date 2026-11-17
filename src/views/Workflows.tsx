import { motion } from 'framer-motion';
import { ArrowRight, GitMerge, ScrollText } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, SectionTitle, cx } from '../components/ui';
import { docIdFromFile, inEdges, nodeById, nodesOf, outEdges } from '../lib/data';
import { TYPE } from '../lib/meta';
import type { GNode, NodeType } from '../types/graph';

const GROUP_ORDER: NodeType[] = ['module', 'package', 'page', 'service', 'class', 'object', 'table', 'view', 'migration', 'state', 'actCode', 'system', 'endpoint', 'config', 'tech', 'file', 'resource', 'licence', 'rule'];

const implementers = (id: string): GNode[] =>
  (inEdges.get(id) ?? [])
    .filter((e) => e.relation === 'implements')
    .map((e) => nodeById.get(e.source)!)
    .filter(Boolean);

export function DocRef({ n }: { n: GNode }) {
  const p = n.provenance.find((x) => x.kind === 'doc' && x.line);
  if (!p) return null;
  return (
    <Link to={`/docs/${docIdFromFile(p.file)}?line=${p.line}`} className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap font-mono text-[11px] text-muted hover:text-accent">
      <ScrollText size={11} />
      {p.file.split('/').pop()?.slice(0, 2)}:{p.line}
    </Link>
  );
}

export function Grouped({ nodes }: { nodes: GNode[] }) {
  const groups = GROUP_ORDER.map((t) => [t, nodes.filter((n) => n.type === t)] as const).filter(([, l]) => l.length);
  if (!groups.length) return <div className="text-[11.5px] text-muted">Aucun nœud technique cité sur cette ligne.</div>;
  return (
    <div className="flex flex-col gap-2">
      {groups.map(([t, list]) => (
        <div key={t} className="flex min-w-0 flex-wrap items-center gap-1">
          <span className="mr-1 w-[104px] shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted">{TYPE[t].plural}</span>
          {list.map((n) => (
            <NodeChip key={n.id} id={n.id} compact />
          ))}
        </div>
      ))}
    </div>
  );
}

const workflows = nodesOf('workflow');
const stepsOf = (wf: string) => nodesOf('step').filter((s) => s.props.workflow === wf).sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre));

export default function Workflows() {
  const [params, setParams] = useSearchParams();
  const wfId = params.get('wf') ?? 'wf:cycle-global';
  const focusStep = params.get('step');
  const wf = nodeById.get(wfId) ?? workflows[0];
  const steps = useMemo(() => stepsOf(wf.id), [wf.id]);
  const rules = nodesOf('rule').filter((r) => r.subtype !== 'expertise');
  const expertises = nodesOf('rule').filter((r) => r.subtype === 'expertise');
  const isDiagram = wf.props.forme === 'diagramme ASCII';

  useEffect(() => {
    if (focusStep) document.getElementById(focusStep)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusStep]);

  const pick = (id: string) =>
    setParams((p) => {
      p.set('wf', id);
      p.delete('step');
      return p;
    });

  return (
    <div className="mx-auto max-w-[1300px] px-6 pb-16 pt-8">
      <SectionTitle eyebrow="Workflows métier" title="Enchaînements décrits par la documentation">
        Listes numérotées de 07 (validation du projet, suivi de consultation, transformation en marché, exécution, décompte), diagramme du §1 lu avec ses flèches, et enchaînements techniques de 02 et 05. Chaque étape est reliée aux nœuds cités sur sa ligne.
      </SectionTitle>
      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <nav className="flex flex-col gap-1" aria-label="Enchaînements">
          {workflows.map((w) => (
            <button key={w.id} onClick={() => pick(w.id)} className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-[12.5px] transition-colors', w.id === wf.id ? 'border-transparent bg-accent-soft text-fg' : 'border-line text-fg-2 hover:border-line-strong hover:text-fg')}>
              <GitMerge size={13} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{w.label}</span>
              <span className="shrink-0 text-[11px] text-muted tnum">{String(w.props.etapes ?? '')}</span>
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <h3 className="text-[17px] font-semibold text-fg">{wf.label}</h3>
            <ConfidenceBadge c={wf.confidence} compact from={wf.provenance[0]?.confidenceFrom} />
            <span className="text-[12px] text-muted">{String(wf.props.forme ?? '')}</span>
            <span className="ml-auto">
              <DocRef n={wf} />
            </span>
          </div>
          {isDiagram && <p className="mb-4 text-[12.5px] leading-relaxed text-muted">Diagramme ASCII de 07 §1 : chaque flèche (──►, ◄──, ▼) devient une arête « puis ». La flèche verticale part de « Validation » vers « Suivi de consultation », comme dessinée ; « Rédaction (DCE) » n’a pas de successeur dans le dessin.</p>}
          <ol className="relative ml-4 border-l border-line-strong pl-8">
            {steps.map((s, i) => {
              const next = (outEdges.get(s.id) ?? []).filter((e) => e.relation === 'sequence').map((e) => nodeById.get(e.target)!).filter(Boolean);
              return (
                <motion.li id={s.id} key={s.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.03 }} className="relative mb-4 last:mb-0">
                  <span className={cx('absolute -left-[49px] grid h-8 w-8 place-items-center rounded-xl border text-[12px] font-semibold', focusStep === s.id ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-fg')}>{String(s.props.ordre)}</span>
                  <Card className={cx('p-4', focusStep === s.id && 'ring-1 ring-[var(--ring)]')}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2">
                      <h4 className="min-w-0 text-[14px] font-semibold text-fg [overflow-wrap:anywhere]">{s.label.replace(/^\d+\.\s*/, '')}</h4>
                      <ConfidenceBadge c={s.confidence} compact from={s.provenance[0]?.confidenceFrom} />
                      <span className="ml-auto">
                        <DocRef n={s} />
                      </span>
                    </div>
                    {s.description && s.description !== s.label.replace(/^\d+\.\s*/, '') && <p className="mb-3 text-[12.5px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{s.description}</p>}
                    <Grouped nodes={implementers(s.id)} />
                    {isDiagram && next.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                        <ArrowRight size={12} /> puis
                        {next.map((x) => (
                          <NodeChip key={x.id} id={x.id} compact />
                        ))}
                      </div>
                    )}
                  </Card>
                </motion.li>
              );
            })}
          </ol>
        </div>
      </div>

      <div className="mt-12">
        <SectionTitle eyebrow="Règles" title="Règles structurantes et règles du suivi">
          Listes de 01 §6 et 07 §4 ; les classes citées sur la même ligne « mettent en œuvre » la règle. Beaucoup de règles vivent hors du Java, dans le dictionnaire dd_lia et les catalogues ce_* (01 §5).
        </SectionTitle>
        <Card className="mb-8 divide-y divide-[var(--border)]">
          {rules.map((r) => (
            <div key={r.id} className="grid gap-3 px-4 py-3.5 md:grid-cols-[1.3fr_1fr]">
              <div className="min-w-0">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{r.subtype}</div>
                <p className="text-[13px] leading-relaxed text-fg [overflow-wrap:anywhere]">{r.description}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <ConfidenceBadge c={r.confidence} compact from={r.provenance[0]?.confidenceFrom} />
                  <DocRef n={r} />
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap content-start gap-1">
                {implementers(r.id).map((n) => (
                  <NodeChip key={n.id} id={n.id} compact />
                ))}
                {(outEdges.get(r.id) ?? [])
                  .filter((e) => e.relation === 'mentions')
                  .map((e) => (
                    <NodeChip key={e.target} id={e.target} compact />
                  ))}
              </div>
            </div>
          ))}
        </Card>
        <SectionTitle eyebrow="Catalogues ce_*" title="Expertises citées">
          Contrôles et calculs portés par les catalogues d’expertise, appelés par chaîne de caractères depuis le Java (01 §5).
        </SectionTitle>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {expertises.map((x) => (
            <Card key={x.id} className="flex flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-semibold text-fg" title={x.label}>
                  {x.label}
                </span>
                <ConfidenceBadge c={x.confidence} compact />
              </div>
              <p className="text-[12px] leading-relaxed text-fg-2 [overflow-wrap:anywhere]">{x.description}</p>
              <DocRef n={x} />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
