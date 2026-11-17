import { AnimatePresence, motion } from 'framer-motion';
import { toPng, toSvg } from 'html-to-image';
import {
  AlertTriangle, BookMarked, ChevronRight, DatabaseZap, Download, FileJson, Filter, Image, Info, Keyboard, LayoutDashboard, Moon, Network,
  LayoutGrid, Palette, PanelLeftClose, Shapes, PanelLeftOpen, Plug, RefreshCcw, ScrollText, Search, Sparkles, Sun, Workflow, X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { docById, domains, graph, nodeById, sourceLoaded, stats } from '../lib/data';
import { CONF, CONF_KEYS } from '../lib/meta';
import { download, useInspect, useStore } from '../lib/store';
import type { Confidence } from '../types/graph';
import { CommandPalette } from './CommandPalette';
import { GlobalHoverCard } from './NodeChip';
import { InspectorDrawer } from './Inspector';
import { ConfidenceBadge, IconButton, Kbd, cx } from './ui';

export const NAV = [
  { to: '/', label: 'Atlas', icon: LayoutDashboard, key: 'a', hint: 'Vue d’ensemble' },
  { to: '/graph', label: 'Graphe', icon: Network, key: 'g', hint: 'Explorateur' },
  { to: '/modules', label: 'Modules', icon: LayoutGrid, key: 'm', hint: 'Modules et nœuds en cartes' },
  { to: '/diagrams', label: 'Diagrammes', icon: Shapes, key: 'i', hint: 'Diagrammes techniques' },
  { to: '/lifecycles', label: 'Cycles de vie', icon: RefreshCcw, key: 'c', hint: 'États et transitions (07)' },
  { to: '/data', label: 'Intégrations', icon: Plug, key: 'd', hint: 'Systèmes, API REST, configuration' },
  { to: '/database', label: 'Base de données', icon: DatabaseZap, key: 'b', hint: 'Tables, vues, migrations (05)' },
  { to: '/workflows', label: 'Workflows', icon: Workflow, key: 'w', hint: 'Enchaînements métier (07)' },
  { to: '/risks', label: 'Risques', icon: AlertTriangle, key: 'r', hint: 'Problèmes & questions' },
  { to: '/docs/00', match: '/docs', label: 'Documentation', icon: ScrollText, key: 'o', hint: '13 documents' },
  { to: '/glossary', label: 'Glossaire', icon: BookMarked, key: 'l', hint: 'Termes' },
  { to: '/ui', label: 'Conventions UI', icon: Palette, key: 'u', hint: 'Wicket, i18n, code (12, 09)' },
];

/** Segment-aware prefix match: '/database' must not activate '/data'. */
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');

export function Shell({ children }: { children: ReactNode }) {
  const store = useStore();
  const nav = useNavigate();
  const [inspected, inspect] = useInspect();
  const loc = useLocation();
  const gPending = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        store.setPaletteOpen(!store.paletteOpen);
        return;
      }
      if (e.key === 'Escape') {
        if (store.paletteOpen) store.setPaletteOpen(false);
        else if (store.helpOpen) store.setHelpOpen(false);
        else if (store.explainOpen) store.setExplainOpen(false);
        else if (inspected) inspect(null);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        store.setPaletteOpen(true);
      } else if (e.key === '?') store.setHelpOpen(!store.helpOpen);
      else if (e.key === '[') store.toggleSidebar();
      else if (e.key === 't') store.toggleTheme();
      else if (e.key === 'e') {
        if (inspected) inspect(inspected, 'explain');
        else store.setExplainOpen(!store.explainOpen);
      } else if (e.key === 'g') {
        gPending.current = Date.now();
      } else if (Date.now() - gPending.current < 900) {
        const item = NAV.find((n) => n.key === e.key);
        if (item) {
          nav(item.to);
          gPending.current = 0;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, nav, inspected, inspect]);

  useEffect(() => store.setHover(null), [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="app-bg flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {!sourceLoaded && !store.bannerDismissed && <SourceBanner />}
        <main id="view-root" className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
      <InspectorDrawer />
      <GlobalHoverCard />
      <CommandPalette />
      <ShortcutsHelp />
      <ViewExplain />
    </div>
  );
}

function Sidebar() {
  const loc = useLocation();
  const { sidebarCollapsed: c } = useStore();
  return (
    <nav
      className={cx(
        'hidden shrink-0 flex-col overflow-hidden border-r border-line bg-surface pb-4 pt-4 transition-[width,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] md:flex',
        c ? 'w-[64px] px-2' : 'w-[232px] px-3',
      )}
      aria-label="Navigation principale"
    >
      <div className={cx('mb-6 flex items-center gap-2.5', c ? 'justify-center px-0' : 'px-2')}>
        <div className="relative grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink" title={c ? `Code Cartography · ${graph.meta.projectLabel}` : undefined}>
          <Sparkles size={16} strokeWidth={2.4} />
        </div>
        {!c && (
          <div className="min-w-0">
            <div className="truncate whitespace-nowrap text-[13.5px] font-semibold tracking-tight text-fg">Code Cartography</div>
            <div className="truncate font-mono text-[10.5px] text-muted">{graph.meta.projectLabel}</div>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.match ? under(loc.pathname, item.match) : item.to === '/' ? loc.pathname === '/' : under(loc.pathname, item.to);
          const Icon = item.icon;
          return (
            <NavLink
              key={item.label}
              to={item.to}
              title={c ? `${item.label} (g ${item.key})` : undefined}
              aria-label={c ? item.label : undefined}
              className={cx(
                'group relative flex h-9 items-center gap-2.5 rounded-lg text-[13px] font-medium transition-colors',
                c ? 'justify-center px-0' : 'px-2.5',
                active ? 'text-fg' : 'text-fg-2 hover:bg-surface-2 hover:text-fg',
              )}
            >
              {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-lg bg-accent-soft" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
              <Icon size={c ? 17 : 15} className={cx('relative shrink-0', active ? 'text-accent' : 'text-muted group-hover:text-fg-2')} />
              {!c && <span className="relative min-w-0 flex-1 truncate whitespace-nowrap">{item.label}</span>}
              {!c && (
                <span className="relative hidden shrink-0 whitespace-nowrap text-[10px] text-muted group-hover:inline">
                  g {item.key}
                </span>
              )}
            </NavLink>
          );
        })}
      </div>
      {c ? (
        <div className="mt-auto flex justify-center pt-6" title={`${sourceLoaded ? 'Source + docs' : 'Docs uniquement'} · ${stats.nodes} nœuds · ${stats.edges} arêtes · LiaWeb 8.4.0 · 100 % local`}>
          <span className={cx('h-2 w-2 rounded-full', sourceLoaded ? 'bg-good' : 'bg-warning')} />
        </div>
      ) : (
      <div className="mt-auto flex flex-col gap-2 px-2 pt-6">
        <div className="rounded-xl border border-line bg-surface-2/50 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-fg">
            <span className={cx('h-1.5 w-1.5 rounded-full', sourceLoaded ? 'bg-good' : 'bg-warning')} />
            {sourceLoaded ? 'Source + docs' : 'Docs uniquement'}
          </div>
          <div className="text-[11px] leading-snug text-muted tnum">
            {stats.nodes} nœuds · {stats.edges} arêtes
            <br />
            LiaWeb 8.4.0 · docs du 12/11/2026
          </div>
        </div>
        <div className="whitespace-nowrap text-[10.5px] text-muted">100 % local · aucun appel réseau</div>
      </div>
      )}
    </nav>
  );
}

function useCrumbs(): { label: string; to?: string }[] {
  const loc = useLocation();
  const [n] = useInspect();
  const parts: { label: string; to?: string }[] = [{ label: 'Cartographie', to: '/' }];
  const p = loc.pathname;
  const item = NAV.find((x) => (x.match ? under(p, x.match) : x.to === '/' ? p === '/' : under(p, x.to)));
  if (item && item.to !== '/') parts.push({ label: item.label, to: item.to });
  if (p.startsWith('/docs/')) {
    const d = docById.get(p.split('/')[2] ?? '');
    if (d) parts.push({ label: d.file });
  }
  const node = n ? nodeById.get(n) : undefined;
  if (node) parts.push({ label: node.label });
  return parts;
}

function Topbar() {
  const store = useStore();
  const crumbs = useCrumbs();
  const [inspected, inspect] = useInspect();
  return (
    <header className="relative z-30 flex h-[52px] shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
      <IconButton title={store.sidebarCollapsed ? 'Déplier le menu ([)' : 'Replier le menu ([)'} onClick={store.toggleSidebar} className="shrink-0 max-md:hidden">
        {store.sidebarCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </IconButton>
      <ol className="flex min-w-0 flex-1 items-center gap-1 text-[12.5px]" aria-label="Fil d’Ariane">
        {crumbs.map((c, i) => (
          <li key={i} className="flex min-w-0 items-center gap-1">
            {i > 0 && <ChevronRight size={13} className="shrink-0 text-muted" />}
            {c.to && i < crumbs.length - 1 ? (
              <NavLink to={c.to} className="truncate text-muted hover:text-fg">
                {c.label}
              </NavLink>
            ) : (
              <span className={cx('truncate', i === crumbs.length - 1 ? 'font-medium text-fg' : 'text-muted', i > 1 && 'font-mono text-[12px]')}>{c.label}</span>
            )}
          </li>
        ))}
      </ol>
      <button
        onClick={() => store.setPaletteOpen(true)}
        className="hidden h-8 w-[280px] shrink-0 items-center gap-2 rounded-lg border border-line bg-surface-2/60 px-2.5 text-[12.5px] text-muted transition-colors hover:border-line-strong hover:text-fg-2 lg:flex"
      >
        <Search size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-left">Rechercher classes, tables, états, docs…</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <IconButton title="Rechercher (Ctrl K)" onClick={() => store.setPaletteOpen(true)} className="lg:hidden">
        <Search size={15} />
      </IconButton>
      <FiltersMenu />
      <IconButton title="Expliquer cette vue / ce nœud (E)" active={store.explainOpen} onClick={() => (inspected ? inspect(inspected, 'explain') : store.setExplainOpen(!store.explainOpen))}>
        <Info size={15} />
      </IconButton>
      <ExportMenu />
      <IconButton title="Raccourcis clavier (?)" onClick={() => store.setHelpOpen(true)}>
        <Keyboard size={15} />
      </IconButton>
      <IconButton title={`Thème ${store.theme === 'dark' ? 'clair' : 'sombre'} (T)`} onClick={store.toggleTheme}>
        {store.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </IconButton>
    </header>
  );
}

function Popover({ open, onClose, children, width = 300 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-popover]')) onClose();
    };
    setTimeout(() => window.addEventListener('mousedown', h), 0);
    return () => window.removeEventListener('mousedown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-popover
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.98 }}
          transition={{ duration: 0.14 }}
          className="glass absolute right-0 top-10 z-50 rounded-xl p-2"
          style={{ width }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function FiltersMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const active = s.confidence.size < CONF_KEYS.length || !!s.domainFilter;
  return (
    <div className="relative" data-popover>
      <IconButton title="Filtres globaux (confiance, domaine)" active={open || active} onClick={() => setOpen(!open)}>
        <Filter size={15} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} width={300}>
        <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Confiance</div>
        <div className="flex flex-col gap-1 p-1">
          {(CONF_KEYS as Confidence[]).map((c) => (
            <label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <input type="checkbox" className="accent-[var(--accent)]" checked={s.confidence.has(c)} onChange={() => s.toggleConfidence(c)} />
              <ConfidenceBadge c={c} compact />
              <span className="text-[12.5px] text-fg-2">{CONF[c].long}</span>
            </label>
          ))}
        </div>
        <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Domaine (04)</div>
        <div className="flex flex-col gap-1 p-1">
          {[null, ...domains].map((j) => (
            <label key={j ?? 'all'} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12.5px] text-fg-2 hover:bg-surface-2">
              <input type="radio" name="domf" className="accent-[var(--accent)]" checked={s.domainFilter === j} onChange={() => s.setDomainFilter(j)} />
              <span>{j ?? 'Tous les domaines'}</span>
            </label>
          ))}
        </div>
        <div className="px-3 pb-2 pt-1 text-[11px] leading-snug text-muted">Le domaine d’un nœud est celui du module de 04 qui le cite ; les nœuds rattachés à aucun module restent visibles. S’applique au graphe, aux intégrations, à la base de données et aux risques.</div>
      </Popover>
    </div>
  );
}

function ExportMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const bg = () => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#fafafa';
  const run = async (kind: 'png' | 'svg') => {
    setBusy(true);
    try {
      const ex = s.exporter.current;
      if (ex?.[kind]) await ex[kind]!();
      else {
        const el = document.getElementById('view-root')!;
        const fn = kind === 'png' ? toPng : toSvg;
        const url = await fn(el, { backgroundColor: bg(), pixelRatio: 2, cacheBust: false, filter: (n) => !(n as HTMLElement).dataset?.noexport });
        const a = document.createElement('a');
        a.href = url;
        a.download = `cartographie-${location.hash.replace(/[#/?=&:]+/g, '-').replace(/^-|-$/g, '') || 'atlas'}.${kind}`;
        a.click();
      }
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  const Item = ({ icon, label, onClick, hint }: { icon: ReactNode; label: string; onClick: () => void; hint?: string }) => (
    <button onClick={onClick} disabled={busy} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-fg-2 hover:bg-surface-2 hover:text-fg disabled:opacity-50">
      <span className="text-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </button>
  );
  return (
    <div className="relative" data-popover>
      <IconButton title="Exporter" active={open} onClick={() => setOpen(!open)}>
        <Download size={15} />
      </IconButton>
      <Popover open={open} onClose={() => setOpen(false)} width={270}>
        <Item icon={<Image size={14} />} label="Vue courante en PNG" onClick={() => run('png')} />
        <Item icon={<Image size={14} />} label="Vue courante en SVG" onClick={() => run('svg')} />
        {s.exporter.current?.json && <Item icon={<FileJson size={14} />} label="Graphe visible (JSON)" onClick={() => (s.exporter.current!.json!(), setOpen(false))} />}
        <Item
          icon={<FileJson size={14} />}
          label="Graphe complet (JSON)"
          hint={`${stats.nodes} n.`}
          onClick={() => {
            download(`graph-${graph.meta.projectLabel}.json`, JSON.stringify(graph, null, 1));
            setOpen(false);
          }}
        />
      </Popover>
    </div>
  );
}

function SourceBanner() {
  const s = useStore();
  return (
    <div className="flex items-center gap-3 border-b border-line bg-[color-mix(in_oklab,var(--warning)_12%,var(--surface))] px-5 py-2 text-[12.5px] text-fg-2" data-noexport="1">
      <AlertTriangle size={14} className="shrink-0 text-warning" />
      <span className="flex-1">
        <b className="font-semibold text-fg">Code source non chargé.</b> Le dépôt SVN de LiaWeb n’est pas disponible : la carte est construite à partir des 13 documents de la base de connaissances uniquement (nœuds « doc-only »). Un [V] est une affirmation de la doc, pas une vérification de cet outil.
      </span>
      <button onClick={s.dismissBanner} className="rounded-md p-1 text-muted hover:bg-surface-3 hover:text-fg" aria-label="Masquer le bandeau">
        <X size={14} />
      </button>
    </div>
  );
}

function Modal({ open, onClose, children, width = 560 }: { open: boolean; onClose: () => void; children: ReactNode; width?: number }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/25 px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="glass max-h-[76vh] w-full overflow-y-auto rounded-2xl"
            style={{ maxWidth: width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ShortcutsHelp() {
  const s = useStore();
  const rows: [string, string][] = [
    ['Ctrl K  ou  /', 'Palette de commandes et recherche'],
    ['g puis a · g · m · i · c · d · b · w · r · o · l · u', 'Aller à Atlas · Graphe · Modules · Diagrammes · Cycles de vie · Intégrations · Base de données · Workflows · Risques · Docs · Glossaire · Conventions UI'],
    ['e', 'Expliquer (provenance du nœud ou de la vue)'],
    ['t', 'Basculer thème clair / sombre'],
    ['[', 'Replier / déplier le menu de gauche'],
    ['f  (graphe)', 'Mode focus (voisinage 1–2 sauts)'],
    ['Échap', 'Fermer le panneau / la fenêtre'],
    ['?', 'Afficher cette aide'],
  ];
  return (
    <Modal open={s.helpOpen} onClose={() => s.setHelpOpen(false)} width={560}>
      <div className="p-6">
        <div className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-fg">
          <Keyboard size={16} /> Raccourcis clavier
        </div>
        <div className="flex flex-col divide-y divide-[var(--border)]">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-6 py-2.5">
              <span className="text-[13px] text-fg-2">{v}</span>
              <span className="shrink-0 font-mono text-[11.5px] text-fg">{k}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const VIEW_EXPLAIN: Record<string, { title: string; body: string }> = {
  '/': { title: 'Atlas', body: 'La carte héro suit l’architecture décrite en 02 et 05 : requête → chaîne de filtres (02 §3) → Wicket / REST / JSP → modules (04) et moteur LIA → trois chemins de persistance → une seule source de données JNDI (05 §1), plus intégrations (06) et tâches de fond. Chaque boîte est un nœud du graphe ; au survol, une liaison affiche les arêtes du graphe qui la justifient (pointillé = aucune arête directe). Les indicateurs comptent les nœuds de data/graph.json ; les valeurs « déclarées » (351 tables, ≈ 250 pages…) sont lues dans la doc.' },
  '/graph': { title: 'Explorateur de graphe', body: 'Tous les nœuds et arêtes extraits. Taille = degré (hors liens « documenté dans »), couleur = famille de type, forme = type exact, style de trait = relation. Par défaut, documents, termes, conventions, questions, problèmes, licences et fichiers sont masqués (cochez-les dans « Types »). Les communautés sont calculées par propagation de labels (déterministe).' },
  '/modules': { title: 'Modules et nœuds en cartes', body: 'Une carte par nœud, sans canevas. Les modules (titres de niveau 3 des parties A et B de 04) montrent ce que leur section cite : paquets, pages, services, classes, tables, avec la ligne de doc. Les autres onglets listent chaque type, triés par nombre de relations. Le filtre de domaine et le filtre de confiance s’appliquent.' },
  '/diagrams': { title: 'Diagrammes techniques', body: 'Diagrammes dessinés en colonnes de boîtes de taille fixe : aucun chevauchement. Chaque boîte est un nœud (clic = provenance), chaque trait une arête du graphe (pointillé = [H] ou relation faible). Les liens entre tables viennent de la « Chaîne principale » de 05 : aucune colonne n’est reliée, la doc ne les nomme pas.' },
  '/lifecycles': { title: 'Cycles de vie', body: 'États et statuts listés dans 07 (§2, §6, §8) et 04 (actes, besoins, issues de lot, consultation simplifiée). Trait plein = transition écrite « A → B » dans la doc ; trait pointillé = ordre du tableau lu comme transition, toujours [H] ; à gauche, les classes et codes d’actes qui positionnent un état (« passe l’état à 5 », « → Soldé », titre de section). Aucun état ni transition n’est ajouté au-delà de la doc.' },
  '/data': { title: 'Intégrations', body: 'Systèmes externes du dictionnaire (gardés seulement si un alias est cité), regroupés par catégorie de 06 ; paquets et classes qui les appellent (ligne de tableau ou même phrase) ; API REST de 06 §5.2 (ressource → chemin) ; points d’entrée URL ; propriétés de configuration (noms seulement, jamais de valeur) ; pile technique de 02 §1 avec les versions citées.' },
  '/database': { title: 'Base de données', body: 'Une seule source de données JNDI (05 §1) ; tables rangées par préfixe de 05 §3.1. Colonnes : uniquement celles qu’un document cite (clé et colonnes de liaison de 05 §3.2, TABLE.COLONNE, UPDATE … SET/WHERE), chacune avec sa ligne ; les colonnes rattachées par la seule convention de préfixe (FPRJ_ → PRJ_PROJET) sont marquées [H]. PK seulement dans la colonne « Clé » ; aucune clé étrangère entre colonnes : les liens de table viennent de la « Chaîne principale » (05:138). Accès = arêtes du graphe (correspond à, lit, crée, même phrase).' },
  '/workflows': { title: 'Workflows métier', body: 'Enchaînements de 07 (listes numérotées, tableau des 16 algorithmes, diagramme ASCII du §1 lu avec ses flèches ──►, ◄── et ▼), séquence de démarrage et chaîne de filtres (02), ajout d’une migration (05), règles de 01 §6 et 07 §4. Chaque étape est reliée aux nœuds cités sur sa ligne.' },
  '/risks': { title: 'Risques & questions', body: 'Problèmes de 10 : bugs et sécurité confirmés (B1–B9, S1–S23, lus [V] par la légende « Confirmé = constaté à la lecture du code » de 10:3), potentiels, secrets dans des fichiers suivis (emplacement et nature seulement), dette, dépendances, limites ; questions de toutes les sections « Questions pour l’équipe » (01, 05–09, 12) et de 10 §4. Les nœuds concernés sont ceux cités sur la même ligne.' },
  '/docs': { title: 'Documentation', body: 'Les 13 documents rendus tels quels ; chaque identifiant reconnu devient un lien vers son nœud, chaque terme du glossaire a sa définition au survol.' },
  '/glossary': { title: 'Glossaire', body: 'Entrées de 11-glossary (codes d’objets du moteur LIA, vocabulaire technique, briques, passation, exécution, réglementaire) ; « définit » pointe vers l’entité citée dans la colonne du terme, « mentionne » vers celles de la colonne « Où ».' },
  '/ui': { title: 'Conventions UI et code', body: 'Conventions de 12 (navigation et droits, composants de référence, fichiers Wicket, internationalisation) et de 09 §2 (code Java). Chaque convention renvoie à sa ligne ; « recommande » pointe vers les classes de la colonne « Composant de référence » ou citées dans l’item.' },
};

function ViewExplain() {
  const s = useStore();
  const loc = useLocation();
  const key = Object.keys(VIEW_EXPLAIN).filter((k) => (k === '/' ? loc.pathname === '/' : under(loc.pathname, k)))[0] ?? '/';
  const v = VIEW_EXPLAIN[key];
  const fallback = graph.nodes.filter((n) => n.provenance.every((p) => p.confidenceFrom === 'fallback')).length;
  return (
    <Modal open={s.explainOpen} onClose={() => s.setExplainOpen(false)} width={640}>
      <div className="p-6">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Expliquer cette vue</div>
        <div className="mb-3 text-[17px] font-semibold text-fg">{v.title}</div>
        <p className="mb-4 text-[13.5px] leading-relaxed text-fg-2">{v.body}</p>
        <div className="grid grid-cols-2 gap-2 text-[12.5px]">
          <Fact k="Mode" v="Documentation uniquement (SVN non disponible)" />
          <Fact k="Généré le" v={new Date(graph.meta.generatedAt).toLocaleString('fr-FR')} />
          <Fact k="Nœuds / arêtes" v={`${stats.nodes} / ${stats.edges}`} />
          <Fact k="Confiance des nœuds" v={`${stats.byConfidence.V} V · ${stats.byConfidence.H} H`} />
          <Fact k="Nœuds sans tag dans la doc" v={`${fallback} (traités [H])`} />
          <Fact k="Périmètre" v={graph.meta.scopeNote} />
        </div>
        <div className="mt-4 text-[12px] leading-relaxed text-muted">Cliquez un nœud puis l’onglet « Expliquer » pour voir la provenance de chaque affirmation (fichier, ligne, extrait, règle d’extraction).</div>
      </div>
    </Modal>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-muted">{k}</div>
      <div className="mt-0.5 text-fg">{v}</div>
    </div>
  );
}

export { Modal };
