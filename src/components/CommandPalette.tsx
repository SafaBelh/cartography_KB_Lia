import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, FileJson, Moon, Network, ScrollText, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PATH_EXAMPLE, fuse, graph, nodeById, searchItems, type SearchItem } from '../lib/data';
import { TYPE } from '../lib/meta';
import { download, useStore } from '../lib/store';
import { NAV } from './Shell';
import { Kbd, TypeGlyph, cx } from './ui';

interface Row {
  key: string;
  group: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  run: (shift: boolean) => void;
}

export function CommandPalette() {
  const s = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (s.paletteOpen) {
      setQ('');
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [s.paletteOpen]);

  const close = () => s.setPaletteOpen(false);
  const openNode = (id: string, inGraph: boolean) => {
    const path = inGraph || loc.pathname === '/' ? '/graph' : loc.pathname;
    nav(`${path}?n=${encodeURIComponent(id)}${inGraph || path === '/graph' ? '&focus=1' : ''}`);
    close();
  };

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const ql = q.trim();
    const views = NAV.filter((v) => !ql || v.label.toLowerCase().includes(ql.toLowerCase()) || v.hint.toLowerCase().includes(ql.toLowerCase()));
    const results: SearchItem[] = ql ? fuse.search(ql, { limit: 40 }).map((r) => r.item) : searchItems.filter((i) => i.kind === 'node' && ['module', 'lifecycle', 'workflow'].includes(i.nodeType!)).slice(0, 14);
    for (const it of results) {
      if (it.kind === 'node') {
        out.push({
          key: it.id,
          group: ql ? 'Nœuds' : 'Points d’entrée',
          title: it.title,
          subtitle: it.subtitle,
          icon: <TypeGlyph type={it.nodeType!} size={10} />,
          run: (shift) => openNode(it.id, shift),
        });
      } else if (it.kind === 'section') {
        out.push({ key: it.id, group: 'Sections de documentation', title: it.title, subtitle: it.subtitle, icon: <ScrollText size={13} className="text-muted" />, run: () => (nav(it.href!), close()) });
      }
    }
    for (const v of views.slice(0, ql ? 3 : 8)) {
      const Icon = v.icon;
      out.push({ key: `view:${v.label}`, group: 'Vues', title: v.label, subtitle: v.hint, icon: <Icon size={13} className="text-muted" />, run: () => (nav(v.to), close()) });
    }
    const actions: Row[] = [
      { key: 'a:theme', group: 'Actions', title: 'Basculer le thème', icon: <Moon size={13} className="text-muted" />, run: () => (s.toggleTheme(), close()) },
      { key: 'a:json', group: 'Actions', title: 'Exporter le graphe complet (JSON)', icon: <FileJson size={13} className="text-muted" />, run: () => (download(`graph-${graph.meta.projectLabel}.json`, JSON.stringify(graph, null, 1)), close()) },
      { key: 'a:path', group: 'Actions', title: `Trouver un chemin : ${nodeById.get(PATH_EXAMPLE.from)?.label} → ${nodeById.get(PATH_EXAMPLE.to)?.label}`, icon: <Network size={13} className="text-muted" />, run: () => (nav(`/graph?from=${encodeURIComponent(PATH_EXAMPLE.from)}&to=${encodeURIComponent(PATH_EXAMPLE.to)}`), close()) },
    ].filter((a) => !ql || a.title.toLowerCase().includes(ql.toLowerCase()));
    return [...out, ...actions];
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((x) => Math.min(rows.length - 1, x + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((x) => Math.max(0, x - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[sel]?.run(e.shiftKey);
    }
  };

  let lastGroup = '';
  return (
    <AnimatePresence>
      {s.paletteOpen && (
        <motion.div className="fixed inset-0 z-[75] flex items-start justify-center bg-black/25 px-4 pt-[11vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={close}>
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 36 }}
            className="glass w-full max-w-[640px] overflow-hidden rounded-2xl"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Palette de commandes"
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search size={16} className="text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Rechercher une classe, une page, une table, un état, une section…"
                className="h-[52px] flex-1 bg-transparent text-[14.5px] text-fg outline-none placeholder:text-muted"
                aria-label="Recherche"
              />
              <Kbd>Échap</Kbd>
            </div>
            <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-2">
              {rows.length === 0 && <div className="px-3 py-10 text-center text-[13px] text-muted">Aucun résultat pour « {q} »</div>}
              {rows.map((r, i) => {
                const header = r.group !== lastGroup;
                lastGroup = r.group;
                return (
                  <div key={r.key}>
                    {header && <div className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{r.group}</div>}
                    <button
                      data-idx={i}
                      onMouseMove={() => setSel(i)}
                      onClick={(e) => r.run(e.shiftKey)}
                      className={cx('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left', sel === i ? 'bg-accent-soft' : '')}
                    >
                      <span className="grid w-4 place-items-center">{r.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-[13px] text-fg">{r.title}</span>
                        {r.subtitle && <span className="block truncate text-[11.5px] text-muted">{r.subtitle}</span>}
                      </span>
                      {sel === i && <CornerDownLeft size={13} className="text-muted" />}
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5">
                <Kbd>↑↓</Kbd> naviguer
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd> inspecter
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>⇧ ↵</Kbd> ouvrir dans le graphe
              </span>
              <span className="ml-auto">{searchItems.length} éléments indexés · {Object.keys(TYPE).length} types</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
