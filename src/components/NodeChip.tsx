import { AnimatePresence, motion } from 'framer-motion';
import { BookOpen, FileWarning } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { definitionOf, nodeById } from '../lib/data';
import { TYPE } from '../lib/meta';
import { useInspect, useStore } from '../lib/store';
import { ConfidenceBadge, TypeGlyph, cx } from './ui';

const TECH = new Set(['package', 'page', 'service', 'class', 'object', 'table', 'view', 'migration', 'file', 'endpoint', 'config', 'actCode', 'resource', 'licence', 'sourceRoot']);

export function NodeChip({ id, className, label }: { id: string; compact?: boolean; className?: string; label?: string }) {
  const n = nodeById.get(id);
  const [, inspect] = useInspect();
  const { setHover } = useStore();
  const timer = useRef<number>();
  if (!n) return <span className="text-muted">{id}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setHover(null);
        inspect(n.id);
      }}
      onMouseEnter={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setHover({ id: n.id, rect: r }), 280);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setHover(null);
      }}
      className={cx(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border border-line bg-surface-2/60 px-1.5 py-[3px] text-left text-[12px] text-fg transition-colors hover:border-line-strong hover:bg-surface-3',
        className,
      )}
    >
      <TypeGlyph type={n.type} size={9} />
      <span className={cx('truncate', TECH.has(n.type) && 'font-mono text-[11.5px]')}>{label ?? n.label}</span>
    </button>
  );
}

/** One hover card for the whole app (cheaper than a portal per chip). */
export function GlobalHoverCard() {
  const { hover, setHover } = useStore();
  useEffect(() => {
    if (!hover) return;
    const off = () => setHover(null);
    window.addEventListener('scroll', off, true);
    return () => window.removeEventListener('scroll', off, true);
  }, [hover, setHover]);
  const n = hover ? nodeById.get(hover.id) : undefined;
  const def = n ? (n.type === 'term' ? n : definitionOf.get(n.id)) : undefined;
  const top = hover ? Math.min(window.innerHeight - 220, hover.rect.bottom + 8) : 0;
  const left = hover ? Math.min(window.innerWidth - 340, Math.max(8, hover.rect.left)) : 0;
  return (
    <AnimatePresence>
      {n && hover && (
        <motion.div
          key={n.id}
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="glass pointer-events-none fixed z-[80] w-[320px] rounded-xl p-3.5"
          style={{ top, left }}
        >
          <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted">
            <TypeGlyph type={n.type} size={9} />
            <span>{TYPE[n.type].label}</span>
            {n.subtype && <span className="truncate">· {n.subtype}</span>}
          </div>
          <div className="mb-2 font-mono text-[13.5px] font-medium text-fg">{n.label}</div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            <ConfidenceBadge c={n.confidence} compact />
            {n.docOnly && (
              <span className="inline-flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[11px] text-fg-2">
                <FileWarning size={11} /> doc-only
              </span>
            )}
          </div>
          {def && def.id !== n.id && (
            <div className="mb-2 rounded-lg bg-accent-soft px-2.5 py-2 text-[12px] leading-snug text-fg-2">
              <span className="mr-1 inline-flex items-center gap-1 font-medium text-fg">
                <BookOpen size={11} /> Glossaire
              </span>
              {def.description}
            </div>
          )}
          {n.description && <p className="line-clamp-4 text-[12px] leading-relaxed text-fg-2">{n.description}</p>}
          <div className="mt-2.5 text-[10.5px] text-muted">Cliquer pour inspecter la provenance</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
