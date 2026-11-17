import { X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fuse, nodeById } from '../lib/data';
import { TYPE } from '../lib/meta';
import { TypeGlyph, cx } from './ui';

/** Fuzzy node combobox (used by the path finder). */
export function NodePicker({ value, onChange, placeholder }: { value: string | null; onChange: (id: string | null) => void; placeholder: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const results = useMemo(() => (q ? fuse.search(q, { limit: 12 }).map((r) => r.item).filter((i) => i.kind === 'node' && i.nodeType !== 'doc') : []), [q]);
  const n = value ? nodeById.get(value) : undefined;
  if (n)
    return (
      <div className="flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2 text-[12px]">
        <TypeGlyph type={n.type} size={9} />
        <span className="flex-1 truncate font-mono text-fg">{n.label}</span>
        <button onClick={() => onChange(null)} className="text-muted hover:text-fg" aria-label="Effacer">
          <X size={13} />
        </button>
      </div>
    );
  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((s) => Math.min(results.length - 1, s + 1));
          else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
          else if (e.key === 'Enter' && results[sel]) {
            onChange(results[sel].id);
            setQ('');
          }
        }}
        placeholder={placeholder}
        className="h-8 w-full rounded-lg border border-line bg-surface-2/60 px-2.5 text-[12px] text-fg outline-none placeholder:text-muted focus:border-[var(--ring)]"
      />
      {open && results.length > 0 && (
        <div className="glass absolute left-0 right-0 top-9 z-50 max-h-64 overflow-y-auto rounded-lg p-1">
          {results.map((r, i) => (
            <button
              key={r.id}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(r.id);
                setQ('');
              }}
              className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === sel && 'bg-accent-soft')}
            >
              <TypeGlyph type={r.nodeType!} size={9} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px] text-fg">{r.title}</span>
                <span className="block truncate text-[10.5px] text-muted">{TYPE[r.nodeType!].label}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
