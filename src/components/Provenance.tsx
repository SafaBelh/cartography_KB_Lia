import { FileText, Settings2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { docById, docIdFromFile } from '../lib/data';
import { methodLabel } from '../lib/meta';
import type { Provenance } from '../types/graph';
import { ConfidenceBadge } from './ui';

export function sectionTitleFor(file: string, line?: number): string | undefined {
  if (!line) return undefined;
  const d = docById.get(docIdFromFile(file));
  const secs = d?.sections.filter((s) => s.startLine <= line && line <= s.endLine) ?? [];
  return secs.sort((a, b) => b.level - a.level)[0]?.title;
}

export function ProvenanceItem({ p }: { p: Provenance }) {
  const isDoc = p.kind === 'doc';
  const Icon = p.kind === 'config' ? Settings2 : FileText;
  const md = p.metadata ?? {};
  const extra = [md.cue && `indice « ${md.cue} »`, md.via && md.via !== p.snippet && `écrit « ${md.via} »`, md.inference && `déduction : ${md.inference}`, md.tag && `tag : [${md.tag}]`, md.methode && `méthode ${md.methode}`, md.note].filter(Boolean) as string[];
  const sec = isDoc ? sectionTitleFor(p.file, p.line) : undefined;
  const fileName = p.file.split('/').pop();
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <Icon size={13} className="text-muted" />
        {isDoc ? (
          <Link to={`/docs/${docIdFromFile(p.file)}?line=${p.line ?? 1}`} className="font-mono text-[11.5px] text-accent hover:underline">
            {fileName}:{p.line}
          </Link>
        ) : (
          <span className="font-mono text-[11.5px] text-fg">
            {p.file}
            {p.line ? `:${p.line}` : ''}
          </span>
        )}
        <ConfidenceBadge c={p.confidence} compact from={p.confidenceFrom} />
        {p.confidenceFrom === 'fallback' && <span className="text-[10.5px] text-muted">non étiqueté → [H]</span>}
        {p.confidenceFrom === 'section' && <span className="text-[10.5px] text-muted">tag de section</span>}
        {p.confidenceFrom === 'legend' && <span className="text-[10.5px] text-muted">légende du document</span>}
      </div>
      {sec && <div className="mb-1 text-[11px] text-muted">§ {sec}</div>}
      {p.snippet && <blockquote className="border-l-2 border-line-strong pl-2.5 text-[12px] leading-relaxed text-fg-2">{p.snippet}</blockquote>}
      <div className="mt-1.5 text-[10.5px] uppercase tracking-wide text-muted">{methodLabel(p.method)}</div>
      {extra.length > 0 && <div className="mt-1 break-words text-[11px] leading-snug text-muted [overflow-wrap:anywhere]">{extra.join(' · ')}</div>}
    </div>
  );
}

export function ProvenanceList({ items, limit = 50 }: { items: Provenance[]; limit?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {items.slice(0, limit).map((p, i) => (
        <ProvenanceItem key={`${p.file}:${p.line}:${p.method}:${i}`} p={p} />
      ))}
      {items.length > limit && <div className="text-[11px] text-muted">+ {items.length - limit} autres références</div>}
    </div>
  );
}
