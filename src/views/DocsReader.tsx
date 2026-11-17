import { motion } from 'framer-motion';
import { FileText } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import { NodeChip } from '../components/NodeChip';
import { TypeGlyph, cx } from '../components/ui';
import { docById, docsBundle, nodeById, termByAlias, terms } from '../lib/data';
import { TYPE, TYPE_ORDER } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import type { DocFile, NodeType } from '../types/graph';

// ------------------------------------------------------------------ remark plugin: glossary terms → <abbr data-term>
const termRegex = (() => {
  const aliases = [...termByAlias.keys()]
    .map((a) => terms.find((t) => [t.label, ...t.aliases].some((x) => x.toLowerCase() === a))!)
    .filter(Boolean)
    .flatMap((t) => [t.label, ...t.aliases])
    .filter((a) => a.length >= 3 && !/[()]/.test(a))
    .sort((a, b) => b.length - a.length);
  const esc = [...new Set(aliases)].map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return esc.length ? new RegExp(`(?<![\\p{L}\\p{N}_/])(${esc.join('|')})(?![\\p{L}\\p{N}_])`, 'gu') : null;
})();

type MdNode = { type: string; value?: string; depth?: number; children?: MdNode[]; data?: Record<string, unknown> };
function remarkGlossary() {
  return (tree: MdNode) => {
    if (!termRegex) return;
    let seen = new Set<string>();
    visit(tree as never, (node: MdNode, index: number | undefined, parent: MdNode | undefined) => {
      if (node.type === 'heading' && (node.depth ?? 3) <= 2) seen = new Set();
      if (node.type !== 'text' || !parent || index === undefined || parent.type === 'link' || parent.type === 'heading') return;
      const value = node.value ?? '';
      const parts: MdNode[] = [];
      let last = 0;
      termRegex.lastIndex = 0;
      for (const m of value.matchAll(termRegex)) {
        const t = termByAlias.get(m[1].toLowerCase());
        if (!t || seen.has(t.id)) continue;
        seen.add(t.id);
        if (m.index! > last) parts.push({ type: 'text', value: value.slice(last, m.index) });
        parts.push({ type: 'glossTerm', data: { hName: 'abbr', hProperties: { 'data-term': t.id } }, children: [{ type: 'text', value: m[1] }] });
        last = m.index! + m[1].length;
      }
      if (!parts.length) return;
      if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
      parent.children!.splice(index, 1, ...parts);
      return index + parts.length;
    });
  };
}

// ------------------------------------------------------------------ inline identifiers → node links
const InPre = createContext(false);
const DocCtx = createContext<DocFile | null>(null);

function resolveToken(doc: DocFile, line: number, t: string): string[] {
  const ids = doc.lineNodes[String(line)] ?? [];
  const out = ids.filter((id) => {
    const n = nodeById.get(id);
    if (!n || n.type === 'doc') return false;
    if (t === n.label || n.aliases.includes(t)) return true;
    // `src/…/X.java:45-60`, `Classe.methode()`, `REC_CUMUL_ARN/OPE`: the identifier is inside the span
    return n.label.length >= 4 && n.type !== 'project' && new RegExp(`(?<![A-Za-z0-9_])${n.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(t);
  });
  return out;
}

function InlineCode({ children, line }: { children: ReactNode; line?: number }) {
  const doc = useContext(DocCtx);
  const [, inspect] = useInspect();
  const { setHover } = useStore();
  const text = String(children ?? '');
  const ids = doc && line ? resolveToken(doc, line, text) : [];
  if (!ids.length) return <code>{children}</code>;
  const first = ids[0];
  return (
    <button
      type="button"
      className="link-node"
      title={ids.length > 1 ? ids.map((i) => nodeById.get(i)?.label).join(', ') : undefined}
      onClick={() => {
        setHover(null);
        inspect(first);
      }}
      onMouseEnter={(e) => setHover({ id: first, rect: e.currentTarget.getBoundingClientRect() })}
      onMouseLeave={() => setHover(null)}
    >
      {text}
      {ids.length > 1 && <sup className="ml-0.5 text-[9px] opacity-70">×{ids.length}</sup>}
    </button>
  );
}

function Term({ id, children }: { id: string; children: ReactNode }) {
  const { setHover } = useStore();
  const [, inspect] = useInspect();
  return (
    <abbr className="term no-underline" onMouseEnter={(e) => setHover({ id, rect: e.currentTarget.getBoundingClientRect() })} onMouseLeave={() => setHover(null)} onClick={() => inspect(id)}>
      {children}
    </abbr>
  );
}

type WithNode = { node?: { position?: { start: { line: number } } }; children?: ReactNode };
const ln = (p: WithNode) => p.node?.position?.start.line;

function buildComponents(doc: DocFile): Components {
  const headingId = (line?: number) => doc.sections.find((s) => s.startLine === line)?.id;
  return {
    pre: ({ children, node }: WithNode) => (
      <InPre.Provider value={true}>
        <pre data-line={ln({ node })}>{children}</pre>
      </InPre.Provider>
    ),
    code: function Code({ children, node }: WithNode) {
      const inPre = useContext(InPre);
      if (inPre) return <code>{children}</code>;
      return <InlineCode line={ln({ node })}>{children}</InlineCode>;
    },
    abbr: (props: WithNode & { 'data-term'?: string }) => <Term id={props['data-term']!}>{props.children}</Term>,
    h1: ({ children, node }: WithNode) => <h1 data-line={ln({ node })} id={headingId(ln({ node }))}>{children}</h1>,
    h2: ({ children, node }: WithNode) => <h2 data-line={ln({ node })} id={headingId(ln({ node }))} className="scroll-mt-6">{children}</h2>,
    h3: ({ children, node }: WithNode) => <h3 data-line={ln({ node })} id={headingId(ln({ node }))} className="scroll-mt-6">{children}</h3>,
    p: ({ children, node }: WithNode) => <p data-line={ln({ node })}>{children}</p>,
    li: ({ children, node }: WithNode) => <li data-line={ln({ node })}>{children}</li>,
    tr: ({ children, node }: WithNode) => <tr data-line={ln({ node })}>{children}</tr>,
    blockquote: ({ children, node }: WithNode) => <blockquote data-line={ln({ node })}>{children}</blockquote>,
    a: ({ children, href }: WithNode & { href?: string }) => {
      const m = href?.match(/^(\d{2})-[\w-]+\.md$/);
      if (m) return <Link to={`/docs/${m[1]}`}>{children}</Link>;
      return <span className="text-accent-2">{children}</span>; // no external navigation
    },
  } as Components;
}

export default function DocsReader() {
  const { docId = '00' } = useParams();
  const [params] = useSearchParams();
  const line = Number(params.get('line') ?? 0);
  const doc = docById.get(docId) ?? docsBundle.docs[0];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSec, setActiveSec] = useState<string | null>(null);
  const components = useMemo(() => buildComponents(doc), [doc]);

  // deep link to a line: scroll + flash
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const t = setTimeout(() => {
      if (!line) {
        document.getElementById('view-root')?.scrollTo({ top: 0 });
        return;
      }
      const els = [...root.querySelectorAll<HTMLElement>('[data-line]')];
      const target = els.filter((e) => Number(e.dataset.line) <= line).sort((a, b) => Number(b.dataset.line) - Number(a.dataset.line))[0];
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('flash-line');
        void target.offsetWidth;
        target.classList.add('flash-line');
      }
    }, 60);
    return () => clearTimeout(t);
  }, [doc, line]);

  // TOC scroll spy
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const hs = [...root.querySelectorAll('h2[id], h3[id]')];
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActiveSec(vis.target.id);
    }, { rootMargin: '0px 0px -70% 0px' });
    hs.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [doc]);

  const docNodes = useMemo(() => {
    const ids = new Set(Object.values(doc.lineNodes).flat());
    const byType = new Map<NodeType, string[]>();
    for (const id of ids) {
      const n = nodeById.get(id);
      if (!n || n.type === 'doc') continue;
      byType.set(n.type, [...(byType.get(n.type) ?? []), id]);
    }
    return TYPE_ORDER.filter((t) => byType.has(t)).map((t) => [t, byType.get(t)!] as const);
  }, [doc]);

  return (
    <div className="flex w-full gap-8 px-6 pb-20 pt-8 lg:gap-12 xl:gap-16">
      <nav className="sticky top-6 hidden h-[calc(100vh-110px)] w-[240px] shrink-0 overflow-y-auto border-r border-line pr-5 lg:block" aria-label="Documents">
        <div className="mb-2 px-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">Base de connaissances</div>
        {docsBundle.docs.map((d) => (
          <Link key={d.id} to={`/docs/${d.id}`} className={cx('flex items-start gap-2 rounded-lg px-2 py-1.5 text-[12.5px] transition-colors', d.id === doc.id ? 'bg-accent-soft text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg')}>
            <span className="mt-px font-mono text-[11px] text-muted">{d.id}</span>
            <span className="leading-snug">{d.title.replace(/^\d+\s*—\s*/, '')}</span>
          </Link>
        ))}
      </nav>

      <motion.article key={doc.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="min-w-0 flex-1" ref={scrollRef}>
        <div className="mb-4 flex items-center gap-2 font-mono text-[11.5px] text-muted">
          <FileText size={13} className="shrink-0" /> <span className="min-w-0 [overflow-wrap:anywhere]">LIAWEB_knowledge_base/docs/project-knowledge/{doc.file}</span>
        </div>
        <DocCtx.Provider value={doc}>
          <div className="prose-carto">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkGlossary]} components={components}>
              {doc.markdown}
            </ReactMarkdown>
          </div>
        </DocCtx.Provider>
        <div className="mt-12 flex items-center justify-between border-t border-line pt-5 text-[12.5px]">
          {(() => {
            const i = docsBundle.docs.findIndex((d) => d.id === doc.id);
            const prev = docsBundle.docs[i - 1];
            const next = docsBundle.docs[i + 1];
            return (
              <>
                {prev ? <Link to={`/docs/${prev.id}`} title={prev.title} className="min-w-0 max-w-[48%] truncate text-fg-2 hover:text-fg">← {prev.title}</Link> : <span />}
                {next ? <Link to={`/docs/${next.id}`} title={next.title} className="min-w-0 max-w-[48%] truncate text-right text-fg-2 hover:text-fg">{next.title} →</Link> : <span />}
              </>
            );
          })()}
        </div>
      </motion.article>

      <aside className="sticky top-6 hidden h-[calc(100vh-110px)] w-[280px] shrink-0 overflow-y-auto border-l border-line pl-6 xl:block">
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">Sur cette page</div>
        <div className="mb-6 flex flex-col border-l border-line">
          {doc.sections
            .filter((s) => s.level >= 2 && s.level <= 3)
            .map((s) => (
              <a
                key={s.id}
                href={`#/docs/${doc.id}?line=${s.startLine}`}
                className={cx('-ml-px border-l py-1 text-[12px] leading-snug transition-colors', s.level === 3 ? 'pl-6' : 'pl-3', activeSec === s.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg-2')}
              >
                {s.title}
                {s.nodeIds.length > 0 && <span className="ml-1 text-[10.5px] text-muted tnum">· {s.nodeIds.length}</span>}
              </a>
            ))}
        </div>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted">Nœuds cités</div>
        <div className="flex flex-col gap-3">
          {docNodes.map(([t, ids]) => (
            <div key={t}>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-fg-2">
                <TypeGlyph type={t} size={9} /> {TYPE[t].plural} <span className="text-muted">{ids.length}</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {ids.slice(0, 14).map((id) => (
                  <NodeChip key={id} id={id} compact />
                ))}
                {ids.length > 14 && <span className="self-center text-[10.5px] text-muted">+{ids.length - 14}</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
