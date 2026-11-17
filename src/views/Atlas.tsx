import { motion } from 'framer-motion';
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, CircleDashed, CircleHelp, Database, Globe, Layers, RefreshCcw, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, ConfidenceBadge, Meter, SectionTitle, TypeGlyph, cx } from '../components/ui';
import { graph, inEdges, nodeById, nodesOf, outEdges, sourceLoaded, stats } from '../lib/data';
import { CONF, CONF_KEYS, REL, SYSTEM_CAT } from '../lib/meta';
import { useInspect } from '../lib/store';
import type { GEdge, GNode } from '../types/graph';

// ------------------------------------------------------------------ hero map model
interface Box {
  key: string;
  /** node opened on click */
  node?: string;
  /** nodes standing for the box when looking for supporting edges */
  members: () => string[];
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  color: string;
  href?: string;
}
interface Link {
  key: string;
  from: string;
  to: string;
  d: string;
  label?: string;
  lx?: number;
  ly?: number;
}

const has = (id: string) => nodeById.has(id);
const ofType = (t: string, f: (n: GNode) => boolean = () => true) => graph.nodes.filter((n) => n.type === t && f(n)).map((n) => n.id);
const children = (id: string, rels = ['contains']) => (outEdges.get(id) ?? []).filter((e) => rels.includes(e.relation)).map((e) => e.target);
const partsOf = (id: string) => (inEdges.get(id) ?? []).filter((e) => e.relation === 'part-of').map((e) => e.source);
const filterClasses = () => [...new Set(partsOf('wf:filtres').flatMap((s) => (inEdges.get(s) ?? []).filter((e) => e.relation === 'implements').map((e) => e.source)))];
const pkgTree = (prefix: string) => graph.nodes.filter((n) => n.type === 'package' && (n.label === prefix || n.label.startsWith(prefix + '.'))).flatMap((n) => [n.id, ...children(n.id)]);
const sysOf = (cat: string) => ofType('system', (n) => n.subtype === cat);

const C_ENTRY = 'var(--t-system)';
const C_APP = 'var(--t-code)';
const C_BIZ = 'var(--t-structure)';
const C_DATA = 'var(--t-store)';

const BOXES: Box[] = [
  { key: 'app', node: 'ep:/app/*', members: () => ['ep:/app/*', ...partsOf('ep:/app/*')], x: 24, y: 70, w: 186, h: 56, title: '/app/*', sub: 'Wicket · ≈ 250 pages', color: C_ENTRY },
  { key: 'rest', node: 'ep:/rest/*', members: () => ['ep:/rest/*', ...partsOf('ep:/rest/*')], x: 24, y: 142, w: 186, h: 56, title: '/rest/*', sub: 'API Jersey · Basic par méthode', color: C_ENTRY },
  { key: 'login', node: 'ep:/j_security_check', members: () => ['ep:/login/*', 'ep:/login/*.jsp', 'ep:/j_security_check', 'ep:/connect/*', 'ep:/login/login.jsp'].filter(has), x: 24, y: 214, w: 186, h: 56, title: 'Connexion', sub: 'FORM · BASIC · OAUTH · OIDC', color: C_ENTRY },
  { key: 'jobs', node: 'cls:InitSchedulerJob', members: () => ['cls:InitSchedulerJob', 'cls:AlerteJob', 'cls:ParapheurJob', 'tech:quartz'].filter(has), x: 24, y: 330, w: 186, h: 56, title: 'Tâches de fond', sub: 'Quartz · AlerteJob · ParapheurJob', color: C_APP },
  { key: 'filters', node: 'wf:filtres', members: filterClasses, x: 240, y: 70, w: 214, h: 200, title: 'Chaîne de filtres (web.xml)', color: C_APP, href: '/workflows?wf=wf:filtres' },
  { key: 'wicket', node: 'cls:BaseWebApplication', members: () => ['cls:BaseWebApplication', 'cls:MountPage', ...ofType('page')].filter(has), x: 240, y: 290, w: 214, h: 50, title: 'BaseWebApplication', sub: 'pages Wicket + JSP historiques', color: C_APP },
  { key: 'restcls', node: 'pkg:com.ordiges.rest', members: () => ofType('class', (n) => n.subtype === 'ressource REST'), x: 240, y: 352, w: 214, h: 50, title: 'Ressources REST', sub: 'com.ordiges.rest · 06 §5.2', color: C_APP },
  { key: 'moteur', node: 'tech:lia-moteur', members: () => ['tech:lia-moteur', 'res:dd_lia', ...ofType('object')].filter(has), x: 484, y: 430, w: 300, h: 50, title: 'Moteur LIA · dictionnaire dd_lia', sub: 'objets fprj, fcns… · règles dans ce_*', color: C_BIZ },
  { key: 'jpa', node: 'tech:eclipselink', members: () => ['tech:eclipselink', 'pkg:com.ordiges.dataobjects', 'cls:DataObjectsUtil', ...ofType('class', (n) => n.subtype === 'entité JPA')].filter(has), x: 814, y: 70, w: 140, h: 56, title: 'JPA EclipseLink', sub: 'DataObjectsUtil', color: C_DATA },
  { key: 'engine', node: 'tech:lia-moteur', members: () => ['tech:lia-moteur', ...ofType('object')].filter(has), x: 814, y: 138, w: 140, h: 56, title: 'Moteur LIA', sub: 'InstanceMetier', color: C_DATA },
  { key: 'jdbc', node: 'svc:PrtDevisService', members: () => ['svc:PrtDevisService', 'svc:SeanceService', 'cls:ServiceUtilisateur'].filter(has), x: 814, y: 206, w: 140, h: 56, title: 'JDBC brut', sub: 'écrans historiques', color: C_DATA },
  { key: 'db', node: 'sys:db', members: () => ['sys:db', ...ofType('table'), ...ofType('view')], x: 814, y: 300, w: 140, h: 70, title: 'jdbc/liaweb', sub: 'une seule source de données', color: C_DATA, href: '/database' },
  { key: 'mig', node: 'mig:dbupdate', members: () => ['cls:DatabaseUpdater', ...ofType('migration')].filter(has), x: 814, y: 400, w: 140, h: 56, title: 'dbupdate', sub: 'migrations au démarrage', color: C_DATA, href: '/database' },
  ...(['demat', 'publicite', 'reglementaire', 'signature', 'ged', 'ia', 'externe'] as const).map((cat, i): Box => ({
    key: `sys-${cat}`,
    members: () => sysOf(cat),
    x: 984,
    y: 70 + i * 58,
    w: 172,
    h: 48,
    title: SYSTEM_CAT[cat],
    sub: '',
    color: C_ENTRY,
    href: '/data',
  })),
];

const integrationCode = () => [...pkgTree('com.ordiges.interfaces'), ...pkgTree('com.ordiges.parapheur'), ...pkgTree('com.ordiges.ged'), ...pkgTree('com.ordiges.ia'), ...pkgTree('com.ordiges.projet.ia'), ...pkgTree('com.ordiges.signature'), ...pkgTree('com.ordiges.messaging'), ...pkgTree('com.ordiges.p2p'), ...pkgTree('com.ordiges.sourcing'), ...pkgTree('com.ordiges.admin'), ...pkgTree('com.ordiges.mail'), ...pkgTree('com.ordiges.langchain'), ...ofType('page'), ...ofType('class'), ...ofType('service')];
const MODULE_MEMBERS = () => nodesOf('module').flatMap((m) => [m.id, ...children(m.id)]);

const LINKS: Link[] = [
  { key: 'app-filters', from: 'app', to: 'filters', d: 'M210 98 L 240 98' },
  { key: 'rest-filters', from: 'rest', to: 'filters', d: 'M210 170 L 240 170' },
  { key: 'login-filters', from: 'login', to: 'filters', d: 'M210 242 L 240 242' },
  { key: 'app-wicket', from: 'app', to: 'wicket', d: 'M117 126 C 117 300, 200 315, 240 315' },
  { key: 'rest-restcls', from: 'rest', to: 'restcls', d: 'M150 198 C 150 377, 200 377, 240 377' },
  { key: 'wicket-modules', from: 'wicket', to: 'modules', d: 'M454 315 L 484 315' },
  { key: 'restcls-modules', from: 'restcls', to: 'modules', d: 'M454 377 C 470 377, 470 350, 484 350' },
  { key: 'jobs-sig', from: 'jobs', to: 'sys-signature', d: 'M210 358 C 400 520, 900 520, 984 279' },
  { key: 'modules-jpa', from: 'modules', to: 'jpa', d: 'M784 120 L 814 98' },
  { key: 'moteur-engine', from: 'moteur', to: 'engine', d: 'M784 445 C 800 445, 795 166, 814 166' },
  { key: 'jpa-db', from: 'jpa', to: 'db', d: 'M884 126 C 884 130, 905 130, 905 300' },
  { key: 'engine-db', from: 'engine', to: 'db', d: 'M884 194 L 884 300' },
  { key: 'jdbc-db', from: 'jdbc', to: 'db', d: 'M865 262 L 865 300' },
  { key: 'mig-db', from: 'mig', to: 'db', d: 'M884 400 L 884 370' },
  ...(['demat', 'publicite', 'reglementaire', 'signature', 'ged', 'ia', 'externe'] as const).map((cat, i): Link => ({ key: `int-${cat}`, from: 'integ', to: `sys-${cat}`, d: `M784 ${84 + i * 6} C 900 30, 962 30, 984 ${94 + i * 58}` })),
];

const boxByKey = new Map(BOXES.map((b) => [b.key, b]));
const membersOf = (key: string): Set<string> => {
  if (key === 'modules') return new Set(MODULE_MEMBERS());
  if (key === 'integ') return new Set(integrationCode());
  return new Set(boxByKey.get(key)?.members() ?? []);
};

function support(link: Link): { edges: GEdge[] } {
  const A = membersOf(link.from);
  const B = membersOf(link.to);
  const edges = graph.edges.filter((e) => e.relation !== 'documented-in' && e.relation !== 'mentions' && ((A.has(e.source) && B.has(e.target)) || (B.has(e.source) && A.has(e.target))) && !(A.has(e.source) && A.has(e.target) && B.has(e.source) && B.has(e.target)));
  return { edges };
}

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    setR(m.matches);
    const h = () => setR(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return r;
}

function HeroMap() {
  const [, inspect] = useInspect();
  const nav = useNavigate();
  const reduced = useReducedMotion();
  const [hover, setHover] = useState<string | null>(null);
  const supports = useMemo(() => Object.fromEntries(LINKS.map((l) => [l.key, support(l)])), []);
  const modules = nodesOf('module');
  const partA = modules.filter((m) => /passation/i.test(String(m.props.domaine)));
  const partB = modules.filter((m) => !partA.includes(m));
  const filters = useMemo(
    () =>
      partsOf('wf:filtres')
        .map((s) => nodeById.get(s)!)
        .sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre)),
    [],
  );
  const hl = hover ? LINKS.find((l) => l.key === hover) : null;
  const hs = hover ? supports[hover] : null;
  const sysCount = (cat: string) => sysOf(cat).length;
  // tables in place only (05 §3.5): dropped tables, names never created and `X_*` families are not counted
  const tables = nodesOf('table').filter((n) => n.subtype === 'table').length;
  const declaredTables = graph.meta.declared.find((d) => d.id === 'tables')?.count;

  const modBox = (m: GNode, x: number, y: number) => (
    <g key={m.id} className="cursor-pointer" onClick={() => inspect(m.id)}>
      <rect x={x} y={y} width={92} height={34} rx={9} fill="var(--surface-2)" stroke="var(--border-strong)" className="transition-colors hover:fill-[var(--surface-3)]" />
      <title>{m.label}</title>
      <foreignObject x={x + 6} y={y + 3} width={80} height={28}>
        <div className="flex h-full items-center">
          <div className="line-clamp-2 text-[9.5px] font-medium leading-[1.15] text-fg-2">{m.label}</div>
        </div>
      </foreignObject>
    </g>
  );

  return (
    <div className="relative">
      <svg viewBox="0 0 1180 540" className="h-auto w-full select-none" role="img" aria-label="Architecture de LiaWeb : entrées, filtres, application Wicket et REST, modules, persistance, base de données et intégrations">
        <defs>
          <linearGradient id="biz" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.14" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0.03" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <ZoneLabel x={24} y={40} text="ENTRÉES" color={C_ENTRY} />
        <ZoneLabel x={240} y={40} text="WAR · TOMCAT 9" color={C_APP} />
        <ZoneLabel x={484} y={40} text="MODULES MÉTIER (04)" color="var(--accent)" />
        <ZoneLabel x={814} y={40} text="PERSISTANCE" color={C_DATA} />
        <ZoneLabel x={984} y={40} text="INTÉGRATIONS (06)" color={C_ENTRY} />

        {LINKS.map((l) => {
          const s = supports[l.key];
          const ok = s.edges.length > 0;
          const active = hover === l.key;
          return (
            <g key={l.key} onMouseEnter={() => setHover(l.key)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
              <path d={l.d} fill="none" stroke="transparent" strokeWidth={14} />
              <path d={l.d} fill="none" stroke={active ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={active ? 2.2 : 1.3} strokeDasharray={ok ? undefined : '3 4'} />
              {ok && !reduced && (
                <circle r={2.4} fill="var(--accent)" filter="url(#glow)" opacity={0.85}>
                  <animateMotion dur={`${2.6 + (l.key.length % 4) * 0.35}s`} repeatCount="indefinite" path={l.d} />
                </circle>
              )}
            </g>
          );
        })}

        {/* business zone */}
        <rect x={484} y={58} width={300} height={360} rx={16} fill="url(#biz)" stroke="var(--accent)" strokeOpacity={0.35} />
        <text x={498} y={80} fontSize={10.5} fontWeight={650} fill="var(--muted)">
          Préparation et passation ({partA.length})
        </text>
        {partA.map((m, i) => modBox(m, 496 + (i % 3) * 96, 88 + Math.floor(i / 3) * 40))}
        <text x={498} y={88 + Math.ceil(partA.length / 3) * 40 + 14} fontSize={10.5} fontWeight={650} fill="var(--muted)">
          Exécution ({partB.length})
        </text>
        {partB.map((m, i) => modBox(m, 496 + (i % 3) * 96, 88 + Math.ceil(partA.length / 3) * 40 + 22 + Math.floor(i / 3) * 40))}

        {BOXES.map((b) => {
          const isFilters = b.key === 'filters';
          const sys = b.key.startsWith('sys-') ? b.key.slice(4) : '';
          const sub = sys ? `${sysCount(sys)} système(s)` : b.key === 'db' ? `${tables} tables en place${declaredTables ? ` / ${declaredTables}` : ''}` : b.sub;
          return (
            <g key={b.key} className="cursor-pointer" onClick={() => (b.href ? nav(b.href) : b.node && has(b.node) ? inspect(b.node) : undefined)}>
              <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} fill="var(--surface)" stroke="var(--border-strong)" />
              <rect x={b.x} y={b.y + 10} width={3} height={b.h - 20} rx={1.5} fill={b.color} />
              <title>{b.title}</title>
              <foreignObject x={b.x + 12} y={b.y + 6} width={b.w - 18} height={b.h - 10}>
                <div className={cx('flex h-full flex-col gap-[3px] leading-tight', isFilters ? 'justify-start pt-1' : 'justify-center')}>
                  <div className={cx('truncate text-[12px] font-semibold text-fg', b.title.startsWith('/') && 'font-mono text-[11.5px]')}>{b.title}</div>
                  {sub && <div className="truncate text-[10px] text-muted">{sub}</div>}
                  {isFilters &&
                    filters.map((f) => (
                      <div key={f.id} className="truncate font-mono text-[9.5px] leading-[1.45] text-fg-2" title={f.label}>
                        {f.label.replace(/^(\d+\.)\s*(?:[a-z0-9]+\.)+/, '$1 ')}
                      </div>
                    ))}
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
      {hl && hs && (
        <div className="glass pointer-events-none absolute right-4 top-4 w-[360px] max-w-[calc(100%-32px)] rounded-xl p-3.5 text-[12px]">
          <div className="mb-2 text-[12px] font-medium text-fg">
            {boxByKey.get(hl.from)?.title ?? (hl.from === 'modules' ? 'Modules (04)' : 'Code d’intégration')} → {boxByKey.get(hl.to)?.title ?? 'Modules (04)'}
          </div>
          {hs.edges.length > 0 ? (
            <>
              <div className="mb-1.5 text-muted">{hs.edges.length} arête(s) du graphe étayent cette liaison :</div>
              <ul className="flex flex-col gap-1">
                {hs.edges.slice(0, 5).map((e) => (
                  <li key={e.id} className="flex min-w-0 items-center gap-1.5 text-fg-2">
                    <ConfidenceBadge c={e.confidence} compact />
                    <span className="truncate font-mono text-[11px]">
                      {nodeById.get(e.source)?.label} {REL[e.relation].label} {nodeById.get(e.target)?.label}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-fg-2">Aucune arête du graphe ne relie directement ces deux blocs : liaison décrite par la doc en prose (02, 05), non structurée. Trait pointillé.</div>
          )}
        </div>
      )}
    </div>
  );
}

function ZoneLabel({ x, y, text, color }: { x: number; y: number; text: string; color: string }) {
  return (
    <g>
      <circle cx={x + 3} cy={y - 4} r={3} fill={color} />
      <text x={x + 12} y={y} fontSize={10} fontWeight={650} letterSpacing="0.14em" fill="var(--muted)">
        {text}
      </text>
    </g>
  );
}

// ------------------------------------------------------------------ KPI
function Kpi({ icon, label, value, sub, meter, onClick, delay }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; meter?: [number, number]; onClick?: () => void; delay: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      onClick={onClick}
      className="panel group flex min-w-0 flex-col gap-2 rounded-2xl p-4 text-left transition-colors hover:border-line-strong"
    >
      <div className="flex min-h-[30px] items-start gap-2 text-[11.5px] font-medium leading-tight text-muted">
        <span className="mt-px shrink-0 text-fg-2">{icon}</span>
        <span className="min-w-0 flex-1">{label}</span>
        <ArrowRight size={12} className="mt-px shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="text-[28px] font-semibold leading-none tracking-tight text-fg">{value}</div>
      {meter && <Meter value={meter[0]} max={meter[1]} />}
      {sub && <div className="min-w-0 text-[11.5px] leading-snug text-fg-2 [overflow-wrap:break-word]">{sub}</div>}
    </motion.button>
  );
}

function OneSentence() {
  const nav = useNavigate();
  const steps = nodesOf('step')
    .filter((s) => s.props.workflow === 'wf:cycle-global')
    .sort((a, b) => Number(a.props.ordre) - Number(b.props.ordre));
  const [active, setActive] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced || !steps.length) return;
    const t = setInterval(() => setActive((a) => (a + 1) % steps.length), 1500);
    return () => clearInterval(t);
  }, [steps.length, reduced]);
  const project = nodesOf('project')[0];
  const objet = project ? String(project.props.objet ?? '') : '';
  const pv = project?.provenance[0];
  return (
    <Card className="p-6">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Fonctionnement en une phrase</div>
      <p className="mb-5 max-w-5xl text-[14.5px] leading-relaxed text-fg">
        {objet ? `${objet}.` : ''} Application web Java monolithique, multi-tenant, livrée en WAR (00 §1) ; enchaînement global tel que dessiné en 07 §1 :{' '}
        {pv && (
          <button onClick={() => nav(`/docs/00?line=${pv.line}`)} className="ml-1 align-middle">
            <ConfidenceBadge c={pv.confidence} compact from={pv.confidenceFrom} />
          </button>
        )}
      </p>
      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {steps.map((s, i) => (
          <li key={s.id} className="min-w-0">
            <button onClick={() => nav(`/workflows?wf=wf:cycle-global&step=${encodeURIComponent(s.id)}`)} className="group flex w-full min-w-0 items-center gap-2 text-left" onMouseEnter={() => setActive(i)}>
              <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-lg border text-[12px] font-semibold transition-all', i === active ? 'border-transparent bg-accent text-accent-ink' : 'border-line-strong bg-surface text-fg-2')}>{i + 1}</span>
              <span className={cx('min-w-0 text-[12px] font-medium leading-snug transition-colors [overflow-wrap:anywhere]', i === active ? 'text-fg' : 'text-fg-2')}>{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function Quality() {
  const total = stats.byConfidence.V + stats.byConfidence.H;
  const icon = (s: string) => (s === 'pass' ? <CheckCircle2 size={14} className="text-good" /> : s === 'fail' ? <XCircle size={14} className="text-critical" /> : <CircleDashed size={14} className="text-warning" />);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      <Card className="p-5">
        <div className="mb-3 text-[13px] font-semibold text-fg">Contrôles de l’extraction</div>
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {stats.checks.map((c) => (
            <li key={c.id} className="flex items-start gap-3 py-2.5">
              <span className="mt-0.5">{icon(c.status)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-fg">{c.label}</div>
                <div className="text-[11.5px] text-muted [overflow-wrap:anywhere]">
                  attendu {c.expected} · obtenu {c.actual}
                  {c.note ? ` — ${c.note}` : ''}
                </div>
              </div>
              <span className={cx('shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase', c.status === 'pass' ? 'text-good-ink' : c.status === 'fail' ? 'text-critical' : 'text-fg-2')}>{c.status === 'n/a' ? 'n/a' : c.status === 'pass' ? 'ok' : 'échec'}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="flex flex-col gap-4 p-5">
        <div>
          <div className="mb-3 text-[13px] font-semibold text-fg">Confiance des nœuds</div>
          <div className="flex h-3 overflow-hidden rounded-full">
            {CONF_KEYS.map((c) => (
              <motion.div key={c} initial={{ width: 0 }} animate={{ width: `${(stats.byConfidence[c] / total) * 100}%` }} transition={{ duration: 0.9 }} style={{ background: CONF[c].color }} className="h-full border-r-2 border-[var(--surface)] last:border-r-0" title={`${CONF[c].long} : ${stats.byConfidence[c]}`} />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
            {CONF_KEYS.map((c) => (
              <span key={c} className="flex items-center gap-1.5 text-[12px] text-fg-2">
                <ConfidenceBadge c={c} compact />
                <span className="tnum text-fg">{stats.byConfidence[c]}</span> {CONF[c].long.toLowerCase()}
              </span>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted">Un nœud prend la confiance la plus forte de ses citations ; une citation prend le tag de sa ligne (le plus faible s’ils sont mêlés), sinon celui de sa section, sinon la légende du document (10 : « Confirmé »), sinon [H]. Arêtes : {stats.edgesByConfidence.V} [V] · {stats.edgesByConfidence.H} [H].</p>
        </div>
        <div className="border-t border-line pt-4">
          <div className="mb-2 text-[13px] font-semibold text-fg">Non cartographié</div>
          <ul className="flex flex-col gap-1.5 text-[12px] text-fg-2">
            {stats.unmapped.slice(0, 6).map((u) => (
              <li key={u.item} className="flex min-w-0 gap-2">
                <CircleHelp size={13} className="mt-0.5 shrink-0 text-warning" />
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-mono text-fg">{u.item}</span> — {u.reason}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-muted">{stats.unmapped.length} éléments au total dans data/stats.json</div>
        </div>
      </Card>
    </div>
  );
}

export default function Atlas() {
  const nav = useNavigate();
  const decl = (id: string) => graph.meta.declared.find((d) => d.id === id)?.count;
  const liveTables = nodesOf('table').filter((n) => n.subtype === 'table').length; // in place (05 §3.5)
  const issues = nodesOf('issue');
  const confirmed = issues.filter((i) => i.props.statut === 'confirmé').length;
  const code = nodesOf('page').length + nodesOf('service').length + nodesOf('class').length;
  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-8">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-muted">
            <span className={cx('h-1.5 w-1.5 shrink-0 rounded-full', sourceLoaded ? 'bg-good' : 'bg-warning')} />
            <span className="min-w-0">Construit depuis la documentation · {graph.meta.scopeNote}</span>
          </div>
          <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-fg">LiaWeb</h1>
          <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-fg-2">
            Progiciel Ordiges de gestion des marchés publics : Java 21, Wicket 9, Jersey, JPA EclipseLink et moteur LIA piloté par dictionnaire XML, une seule base JNDI, des dizaines d’intégrations. Cliquez n’importe quel élément pour voir d’où il vient.
          </p>
        </div>
        <button onClick={() => nav('/graph')} className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13px] font-semibold text-accent-ink transition-transform hover:-translate-y-0.5">
          <span className="whitespace-nowrap">Explorer le graphe</span> <ArrowRight size={15} className="shrink-0" />
        </button>
      </motion.div>

      <Card className="dot-grid mb-6 overflow-hidden p-4 md:p-6">
        <HeroMap />
      </Card>

      <div className="@container mb-6">
        <div className="grid grid-cols-2 gap-3 @min-[620px]:grid-cols-4 @min-[1120px]:grid-cols-7">
          <Kpi delay={0.02} icon={<Layers size={14} />} label="Modules (04)" value={nodesOf('module').length} sub={`${nodesOf('package').length} paquets · ${nodesOf('brick').length} briques produit`} onClick={() => nav('/graph')} />
          <Kpi delay={0.06} icon={<Boxes size={14} />} label="Classes, pages, services" value={code} sub={<span>{nodesOf('page').length} pages / ≈ {decl('pages') ?? '?'} montées</span>} meter={[nodesOf('page').length, decl('pages') ?? 1]} onClick={() => nav('/graph')} />
          <Kpi delay={0.1} icon={<Database size={14} />} label="Tables en place" value={<span className="tnum">{liveTables}<span className="text-[15px] font-medium text-muted"> / {decl('tables') ?? '?'}</span></span>} meter={[liveTables, decl('tables') ?? 1]} sub={`${nodesOf('view').length} vues · ${nodesOf('migration').length} migrations citées`} onClick={() => nav('/database')} />
          <Kpi delay={0.14} icon={<RefreshCcw size={14} />} label="Cycles de vie" value={nodesOf('lifecycle').length} sub={`${nodesOf('state').length} états · ${nodesOf('workflow').length} enchaînements`} onClick={() => nav('/lifecycles')} />
          <Kpi delay={0.18} icon={<Globe size={14} />} label="Systèmes externes" value={nodesOf('system').length} sub={`${nodesOf('endpoint').length} points d’entrée · ${nodesOf('tech').length} technologies`} onClick={() => nav('/data')} />
          <Kpi delay={0.22} icon={<AlertTriangle size={14} />} label="Problèmes connus" value={issues.length} sub={<span><span className="text-critical">{confirmed} confirmés</span> · bugs, sécurité, secrets, dette</span>} onClick={() => nav('/risks?kind=issue')} />
          <Kpi delay={0.26} icon={<CircleHelp size={14} />} label="Questions ouvertes" value={nodesOf('question').length} sub="« Questions pour l’équipe » de 8 documents" onClick={() => nav('/risks?kind=question')} />
        </div>
      </div>

      <div className="mb-8">
        <OneSentence />
      </div>

      <SectionTitle eyebrow="Fiabilité" title="Qualité de la cartographie">
        Ce que l’extracteur a pu vérifier, et ce qu’il n’a pas pu relier.
      </SectionTitle>
      <Quality />

      <div className="mt-8 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <Database size={13} /> Généré le {new Date(graph.meta.generatedAt).toLocaleString('fr-FR')} · extracteur v{graph.meta.extractorVersion} · <TypeGlyph type="doc" /> 13 documents · {stats.nodes} nœuds · {stats.edges} arêtes
      </div>
    </div>
  );
}
