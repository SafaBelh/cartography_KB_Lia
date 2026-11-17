import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, BookOpen, ChevronDown, DatabaseZap, FileWarning, GitBranch, Network, RefreshCcw, ScrollText, Workflow, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { definitionOf, docIdFromFile, inEdges, nodeById, outEdges, sourceLoaded } from '../lib/data';
import { REL, TYPE } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import type { GEdge, GNode } from '../types/graph';
import { NodeChip } from './NodeChip';
import { ProvenanceList, sectionTitleFor } from './Provenance';
import { CategoryBadge, ConfidenceBadge, TypeGlyph, cx } from './ui';

const TABS = [
  { id: 'overview', label: 'Aperçu' },
  { id: 'relations', label: 'Relations' },
  { id: 'explain', label: 'Expliquer' },
] as const;

export function InspectorDrawer() {
  const [id, inspect, tab] = useInspect();
  const n = id ? nodeById.get(id) : undefined;
  const { bannerDismissed } = useStore();
  const top = !sourceLoaded && !bannerDismissed ? 'top-[118px]' : 'top-[60px]';
  return (
    <AnimatePresence>
      {n && (
        <motion.aside
          key="inspector"
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          className={cx('glass glass-solid fixed bottom-3 right-3 z-40', top, ' flex w-[440px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-2xl')}
          aria-label="Inspecteur de nœud"
        >
          <InspectorBody n={n} tab={tab} onTab={(t) => inspect(n.id, t)} onClose={() => inspect(null)} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function InspectorBody({ n, tab, onTab, onClose }: { n: GNode; tab: string; onTab: (t: string) => void; onClose: () => void }) {
  const nav = useNavigate();
  const outs = outEdges.get(n.id) ?? [];
  const ins = inEdges.get(n.id) ?? [];
  const rels = [...outs, ...ins].filter((e) => e.relation !== 'documented-in');
  const def = n.type === 'term' ? undefined : definitionOf.get(n.id);
  const firstDoc = n.provenance.find((p) => p.kind === 'doc' && p.line);
  const lifecycle = n.type === 'lifecycle' ? n.id : n.type === 'state' ? String(n.props.cycle ?? '') : '';
  const workflow = n.type === 'workflow' ? n.id : n.type === 'step' ? String(n.props.workflow ?? '') : '';
  const isData = n.type === 'table' || n.type === 'view';
  const moduleNode = n.module ? nodeById.get(n.module) : undefined;

  return (
    <>
      <div className="border-b border-line px-5 pb-3 pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-[11.5px] text-muted">
            <TypeGlyph type={n.type} />
            <span>{TYPE[n.type].label}</span>
            {n.subtype && n.subtype.toLowerCase() !== TYPE[n.type].label.toLowerCase() && <span className="truncate">· {n.subtype}</span>}
            {moduleNode && <span className="truncate">· {moduleNode.label}</span>}
          </div>
          <button onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-fg-2 hover:bg-surface-3 hover:text-fg" aria-label="Fermer (Échap)" title="Fermer (Échap)">
            <X size={15} />
          </button>
        </div>
        <h3 className="break-words font-mono text-[18px] font-semibold leading-tight text-fg">{n.label}</h3>
        {typeof n.props.paquet === 'string' && <div className="mt-0.5 break-words font-mono text-[12px] text-muted">{n.props.paquet}</div>}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <ConfidenceBadge c={n.confidence} />
          {n.docOnly && n.type !== 'doc' && (
            <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-2" title="Aucun fichier source ne confirme ce nœud : il provient uniquement de la documentation">
              <FileWarning size={11} /> doc-only
            </span>
          )}
          {n.type === 'issue' && <CategoryBadge cat={n.subtype} statut={String(n.props.statut ?? '')} />}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <ActionBtn icon={<Network size={13} />} onClick={() => nav(`/graph?n=${encodeURIComponent(n.id)}&focus=1`)}>
            Graphe
          </ActionBtn>
          {lifecycle && (
            <ActionBtn icon={<RefreshCcw size={13} />} onClick={() => nav(`/lifecycles?lc=${encodeURIComponent(lifecycle)}&n=${encodeURIComponent(n.id)}`)}>
              Cycle de vie
            </ActionBtn>
          )}
          {workflow && (
            <ActionBtn icon={<Workflow size={13} />} onClick={() => nav(`/workflows?wf=${encodeURIComponent(workflow)}&n=${encodeURIComponent(n.id)}`)}>
              Enchaînement
            </ActionBtn>
          )}
          {isData && (
            <ActionBtn icon={<DatabaseZap size={13} />} onClick={() => nav(`/database?t=${encodeURIComponent(n.id)}&n=${encodeURIComponent(n.id)}`)}>
              Base de données
            </ActionBtn>
          )}
          {firstDoc && (
            <ActionBtn icon={<ScrollText size={13} />} onClick={() => nav(`/docs/${docIdFromFile(firstDoc.file)}?line=${firstDoc.line}&n=${encodeURIComponent(n.id)}`)}>
              Doc
            </ActionBtn>
          )}
        </div>
      </div>
      <div className="flex gap-1 border-b border-line px-4" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={cx('relative px-2.5 py-2.5 text-[12.5px] font-medium transition-colors', tab === t.id ? 'text-fg' : 'text-muted hover:text-fg-2')}
          >
            {t.label}
            {t.id === 'relations' && <span className="ml-1 text-muted tnum">{rels.length}</span>}
            {t.id === 'explain' && <span className="ml-1 text-muted tnum">{n.provenance.length}</span>}
            {tab === t.id && <motion.span layoutId="insp-tab" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === 'overview' && <Overview n={n} def={def} />}
        {tab === 'relations' && <Relations n={n} outs={outs} ins={ins} />}
        {tab === 'explain' && <Explain n={n} rels={rels} />}
      </div>
    </>
  );
}

function ActionBtn({ icon, children, onClick }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-fg-2 transition-colors hover:border-line-strong hover:bg-surface-3 hover:text-fg">
      {icon}
      {children}
    </button>
  );
}

function Overview({ n, def }: { n: GNode; def?: GNode }) {
  const props = Object.entries(n.props).filter(([k]) => k !== 'glossaire' && k !== 'cycle' && k !== 'workflow');
  const affects = (inEdges.get(n.id) ?? []).filter((e) => e.relation === 'affects').map((e) => nodeById.get(e.source)!).filter(Boolean);
  const docRefs = useMemo(() => {
    const m = new Map<string, { file: string; line: number; section?: string }>();
    for (const p of n.provenance) if (p.kind === 'doc' && p.line) {
      const sec = sectionTitleFor(p.file, p.line);
      const k = `${p.file}#${sec}`;
      if (!m.has(k)) m.set(k, { file: p.file, line: p.line, section: sec });
    }
    return [...m.values()];
  }, [n]);
  const nav = useNavigate();
  return (
    <div className="flex flex-col gap-5">
      {n.description && <p className="text-[13.5px] leading-relaxed text-fg-2">{n.description}</p>}
      {def && (
        <div className="rounded-xl bg-accent-soft px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-accent">
            <BookOpen size={12} /> Glossaire · {def.label}
          </div>
          {def.description}
        </div>
      )}
      {props.length > 0 && (
        <div>
          <H>Propriétés</H>
          <dl className="grid grid-cols-[minmax(110px,auto)_1fr] gap-x-3 gap-y-1.5 text-[12.5px]">
            {props.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[11.5px] text-muted">{k}</dt>
                <dd className="break-words text-fg">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {affects.length > 0 && (
        <div>
          <H>Problèmes & questions liés</H>
          <div className="flex flex-col gap-2">
            {affects.map((a) => (
              <button key={a.id} onClick={() => nav(`/risks?n=${encodeURIComponent(a.id)}`)} className="rounded-xl border border-line p-2.5 text-left text-[12.5px] leading-snug text-fg-2 hover:border-line-strong hover:bg-surface-2">
                <div className="mb-1 flex items-center gap-2">
                  <TypeGlyph type={a.type} />
                  <CategoryBadge cat={a.type === 'issue' ? a.subtype : undefined} statut={String(a.props.statut ?? '')} />
                </div>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {docRefs.length > 0 && (
        <div>
          <H>Sections de doc liées</H>
          <div className="flex flex-col gap-1">
            {docRefs.slice(0, 12).map((r) => (
              <button key={`${r.file}${r.section}`} onClick={() => nav(`/docs/${docIdFromFile(r.file)}?line=${r.line}`)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                <ScrollText size={12} className="shrink-0 text-muted" />
                <span className="font-mono text-[11px] text-muted">{r.file.split('/').pop()?.slice(0, 2)}</span>
                <span className="truncate">{r.section ?? r.file}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function H({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{children}</div>;
}

function Relations({ n, outs, ins }: { n: GNode; outs: GEdge[]; ins: GEdge[] }) {
  const group = (edges: GEdge[]) => {
    const m = new Map<string, GEdge[]>();
    for (const e of edges) if (e.relation !== 'documented-in') m.set(e.relation, [...(m.get(e.relation) ?? []), e]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  };
  return (
    <div className="flex flex-col gap-5">
      <EdgeGroup title="Sortantes" icon={<ArrowUpRight size={12} />} groups={group(outs)} other={(e) => e.target} />
      <EdgeGroup title="Entrantes" icon={<ArrowDownLeft size={12} />} groups={group(ins)} other={(e) => e.source} />
      {outs.length + ins.length === 0 && <div className="text-[13px] text-muted">Aucune relation pour {n.label}.</div>}
    </div>
  );
}

function EdgeGroup({ title, icon, groups, other }: { title: string; icon: React.ReactNode; groups: [string, GEdge[]][]; other: (e: GEdge) => string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!groups.length) return null;
  return (
    <div>
      <H>
        <span className="inline-flex items-center gap-1">
          {icon} {title}
        </span>
      </H>
      <div className="flex flex-col gap-3">
        {groups.map(([rel, edges]) => (
          <div key={rel}>
            <div className="mb-1.5 text-[12px] text-fg-2">
              {REL[rel as keyof typeof REL]?.label ?? rel} <span className="text-muted tnum">({edges.length})</span>
            </div>
            <div className="flex flex-col gap-1">
              {edges.slice(0, 60).map((e) => (
                <div key={e.id}>
                  <div className="flex items-center gap-2">
                    <NodeChip id={other(e)} compact />
                    <ConfidenceBadge c={e.confidence} compact />
                    <button onClick={() => setOpen(open === e.id ? null : e.id)} className="ml-auto inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-fg" aria-expanded={open === e.id}>
                      preuve <ChevronDown size={12} className={cx('transition-transform', open === e.id && 'rotate-180')} />
                    </button>
                  </div>
                  {open === e.id && (
                    <div className="mt-2">
                      <ProvenanceList items={e.provenance} limit={6} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Explain({ n, rels }: { n: GNode; rels: GEdge[] }) {
  const counts = { V: 0, H: 0 };
  for (const p of n.provenance) counts[p.confidence]++;
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-line bg-surface-2/50 p-3.5 text-[12.5px] leading-relaxed text-fg-2">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-fg">
          <GitBranch size={13} /> Pourquoi ce nœud existe
        </div>
        Ce nœud provient uniquement de la documentation (le code source SVN de LiaWeb n’est pas chargé). Il est cité {n.provenance.length} fois. Sa confiance est la plus forte de ses références : {counts.V} [V], {counts.H} [H]. Une ligne sans tag est traitée [H].
      </div>
      <div>
        <H>Existence de « {n.label} »</H>
        <ProvenanceList items={n.provenance} limit={20} />
      </div>
      <div>
        <H>Relations ({rels.length})</H>
        <div className="flex flex-col gap-3">
          {rels.slice(0, 40).map((e) => (
            <div key={e.id} className="rounded-xl border border-line p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                <NodeChip id={e.source} compact />
                <span className="text-muted">{REL[e.relation].label} →</span>
                <NodeChip id={e.target} compact />
              </div>
              <ProvenanceList items={e.provenance} limit={2} />
            </div>
          ))}
          {rels.length > 40 && <div className="text-[11px] text-muted">+ {rels.length - 40} relations (voir l’onglet Relations)</div>}
        </div>
      </div>
    </div>
  );
}
