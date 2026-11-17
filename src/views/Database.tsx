import { motion } from 'framer-motion';
import { ArrowRight, Database as DbIcon, Eye, FolderTree, KeyRound, Link2, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { NodeChip } from '../components/NodeChip';
import { Card, ConfidenceBadge, Empty, Pill, SectionTitle, cx } from '../components/ui';
import { docsBundle, graph, nodeById, nodesOf, outEdges, passesDomain } from '../lib/data';
import { REL } from '../lib/meta';
import { buildSchema, type Column, type DbTable } from '../lib/schema';
import { useInspect, useStore } from '../lib/store';
import { DocRef } from './Workflows';

const schema = buildSchema(graph, docsBundle);
const RULE_LABEL: Record<string, string> = {
  'entity-key': 'colonne « Clé » de 05 §3.2',
  'entity-link': 'colonne « Colonnes de liaison » de 05 §3.2',
  'dotted-ref': 'TABLE.COLONNE',
  'sql-update': 'UPDATE … SET / WHERE',
  'table-parenthesis': 'liste entre parenthèses après la table',
  'column-prefix': 'convention de préfixe (05 §3.1) — hypothèse',
};

function ColumnRow({ c }: { c: Column }) {
  const s = c.sources[0];
  return (
    <li className="flex min-w-0 items-center gap-2 py-1 text-[12px]">
      <span className="grid w-3 shrink-0 place-items-center">{c.pk && <KeyRound size={11} className="text-[var(--t-config)]" aria-label="clé (colonne « Clé » de 05)" />}</span>
      <span className={cx('min-w-0 truncate font-mono text-[11.5px]', c.inferred ? 'text-muted' : 'text-fg')} title={c.name}>
        {c.name}
      </span>
      {c.link && <span className="shrink-0 rounded px-1 text-[10px] text-fg-2 ring-1 ring-[var(--border)]">liaison</span>}
      {c.sql.map((x) => (
        <span key={x} className="shrink-0 rounded px-1 font-mono text-[10px] text-fg-2 ring-1 ring-[var(--border)]">
          {x}
        </span>
      ))}
      {c.inferred && <span className="shrink-0 font-mono text-[10px] text-warning">[H]</span>}
      {c.notes.length > 0 && <span className="min-w-0 truncate text-[10.5px] text-muted" title={c.notes.join(' · ')}>{c.notes.join(' · ')}</span>}
      <Link to={`/docs/${s.doc}?line=${s.line}`} title={`${RULE_LABEL[s.rule]} — ${s.snippet}`} className="ml-auto shrink-0 font-mono text-[10.5px] text-muted hover:text-accent">
        {s.doc}:{s.line}
        {c.sources.length > 1 ? ` +${c.sources.length - 1}` : ''}
      </Link>
    </li>
  );
}

function TableCard({ t, open }: { t: DbTable; open: boolean }) {
  const [, inspect] = useInspect();
  return (
    <Card id={t.node.id} className={cx('flex h-full min-w-0 flex-col gap-2 p-4', open && 'ring-1 ring-[var(--ring)]')}>
      <div className="flex items-center gap-2">
        {t.node.type === 'view' ? <Eye size={13} className="shrink-0 text-[var(--t-store)]" /> : <DbIcon size={13} className="shrink-0 text-[var(--t-store)]" />}
        <button onClick={() => inspect(t.node.id)} className="min-w-0 flex-1 truncate text-left font-mono text-[13px] font-semibold text-fg hover:text-accent-2" title={t.node.label}>
          {t.node.label}
        </button>
        <ConfidenceBadge c={t.node.confidence} compact from={t.node.provenance[0]?.confidenceFrom} />
      </div>
      {t.columns.length > 0 ? (
        <ul className="divide-y divide-[var(--border)]">
          {t.columns.map((c) => (
            <ColumnRow key={c.name} c={c} />
          ))}
        </ul>
      ) : (
        <div className="text-[11.5px] text-muted">Colonnes : non documenté</div>
      )}
      {t.keyNote && (
        <div className="text-[11.5px] text-fg-2">
          Clé : <span className="text-muted">{t.keyNote.text}</span> <span className="text-muted">(colonnes non nommées, {t.keyNote.source.doc}:{t.keyNote.source.line})</span>
        </div>
      )}
      {t.access.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-line pt-2">
          {t.access.slice(0, 10).map((a) => (
            <span key={a.edge.id} className="inline-flex max-w-full items-center gap-1 text-[10.5px] text-muted">
              <NodeChip id={a.other} compact /> {REL[a.kind].label}
              {a.edge.confidence === 'H' && <span className="font-mono">[H]</span>}
            </span>
          ))}
          {t.access.length > 10 && <span className="text-[10.5px] text-muted">+{t.access.length - 10}</span>}
        </div>
      )}
      {(t.modules.length > 0 || t.issues.length > 0) && (
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {t.modules.map((m) => (
            <NodeChip key={m} id={m} compact />
          ))}
          {t.issues.map((i) => (
            <NodeChip key={i} id={i} compact label={nodeById.get(i)!.label.split(' · ')[0]} />
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Database() {
  const store = useStore();
  const [params] = useSearchParams();
  const focusT = params.get('t');
  const [q, setQ] = useState('');
  const [onlyCols, setOnlyCols] = useState(false);
  const [prefix, setPrefix] = useState<string | null>(null);
  const keep = (t: DbTable) =>
    (!onlyCols || t.columns.length > 0) &&
    (!q || t.node.label.toLowerCase().includes(q.toLowerCase()) || t.columns.some((c) => c.name.toLowerCase().includes(q.toLowerCase()))) &&
    store.confidence.has(t.node.confidence) &&
    passesDomain(t.node, store.domainFilter);
  const groups = useMemo(() => schema.groups.map((g) => ({ ...g, tables: g.tables.filter(keep) })).filter((g) => g.tables.length && (!prefix || g.prefix === prefix)), [q, onlyCols, prefix, store.confidence, store.domainFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const views = schema.views.filter(keep);
  const migrations = nodesOf('migration');
  const st = schema.stats;

  useEffect(() => {
    if (focusT) setTimeout(() => document.getElementById(focusT)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  }, [focusT]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 pb-16 pt-8">
      <SectionTitle eyebrow="Base de données" title="Schéma documenté de LiaWeb (05)">
        Une seule source de données JNDI, trois chemins d’accès (JPA EclipseLink, moteur LIA, JDBC brut). Ne figure ici que ce qu’un document écrit : colonnes citées (chacune liée à sa ligne), clé seulement dans la colonne « Clé » de 05 §3.2, aucune clé étrangère entre colonnes. Le reste est « non documenté ».
      </SectionTitle>

      <div className="mb-6 grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2">
            <DbIcon size={16} className="text-[var(--t-store)]" />
            {schema.database ? <NodeChip id={schema.database.id} /> : <span className="text-muted">source de données non nommée</span>}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-1 text-[12px] text-fg-2">
            SGBD reconnus :
            {schema.engines.map((e) => (
              <NodeChip key={e.id} id={e.id} compact />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-4">
            {[
              ['Tables nommées', `${st.tables}${schema.declaredTables ? ` / ${schema.declaredTables.count}` : ''}`],
              ['Vues', String(st.views)],
              ['Colonnes citées', `${st.columns} (${st.tablesWithColumns} tables)`],
              ['Clés (« Clé »)', String(st.pks)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-line bg-surface-2/50 px-2.5 py-2">
                <div className="text-[10.5px] uppercase tracking-wide text-muted">{k}</div>
                <div className="tnum text-[15px] font-semibold text-fg">{v}</div>
              </div>
            ))}
          </div>
          {schema.declaredTables && (
            <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
              « {schema.declaredTables.source.snippet} » ({schema.declaredTables.source.doc}:{schema.declaredTables.source.line}) — le DDL (WebContent/dbupdate/init/) n’est pas dans la base de connaissances : {st.inferredColumns} colonne(s) sont rattachées par la seule convention de préfixe et marquées [H] ; 0 clé étrangère est dessinée.
            </p>
          )}
        </Card>
        <Card className="p-5">
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-fg">
            <Link2 size={14} className="text-[var(--t-store)]" /> Liens documentés entre tables
          </div>
          <p className="mb-2 text-[11.5px] leading-relaxed text-muted">Phrase « Chaîne principale » de 05 : cardinalités telles qu’écrites, « garantis par les scripts de clés étrangères » mais sans nom de colonne.</p>
          <ul className="flex flex-col gap-1.5">
            {schema.links.map((l, i) => (
              <li key={i} className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-fg-2">
                {l.fromTable ? <NodeChip id={l.fromTable} compact /> : <span className="text-muted">{l.from} (table non résolue)</span>}
                <span className="font-mono text-[11px] text-muted">{l.card}</span>
                <ArrowRight size={11} className="text-muted" />
                {l.toTable ? <NodeChip id={l.toTable} compact /> : <span className="text-muted">{l.to} (table non résolue)</span>}
              </li>
            ))}
          </ul>
          {schema.links[0] && (
            <Link to={`/docs/${schema.links[0].source.doc}?line=${schema.links[0].source.line}`} className="mt-2 inline-block font-mono text-[11px] text-muted hover:text-accent">
              {schema.links[0].source.doc}:{schema.links[0].source.line}
            </Link>
          )}
        </Card>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-2.5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Table ou colonne…" className="h-8 w-[220px] rounded-lg border border-line bg-surface-2/60 pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-muted" />
        </div>
        <Pill active={onlyCols} onClick={() => setOnlyCols(!onlyCols)}>
          Avec colonnes citées
        </Pill>
        <Pill active={!prefix} onClick={() => setPrefix(null)}>
          Tous préfixes
        </Pill>
        {schema.groups.map((g) => (
          <Pill key={g.prefix} active={prefix === g.prefix} onClick={() => setPrefix(prefix === g.prefix ? null : g.prefix)} title={g.domain}>
            <span className="font-mono">{g.prefix}</span>
          </Pill>
        ))}
      </div>

      {groups.length === 0 && views.length === 0 && <Empty icon={<Search size={18} />} title="Aucune table ne correspond aux filtres" />}
      {groups.map((g) => (
        <section key={g.prefix} className="mb-8">
          <h3 className="mb-3 flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold text-fg">
            <span className="font-mono">{g.prefix}_</span>
            <span className="font-normal text-fg-2">{g.domain}</span>
            <span className="text-[12px] font-normal text-muted">{g.tables.length}</span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {g.tables.map((t) => (
              <motion.div key={t.node.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <TableCard t={t} open={focusT === t.node.id} />
              </motion.div>
            ))}
          </div>
        </section>
      ))}
      {views.length > 0 && !prefix && (
        <section className="mb-10">
          <h3 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold text-fg">
            Vues <span className="text-[12px] font-normal text-muted">(re)créées par maj99/maj0001.sql à chaque démarrage (05 §3.3)</span>
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {views.map((t) => (
              <TableCard key={t.node.id} t={t} open={focusT === t.node.id} />
            ))}
          </div>
        </section>
      )}

      <SectionTitle eyebrow="Migrations" title="WebContent/dbupdate (05 §4)">
        Exécutées au démarrage par DatabaseUpdater ; une erreur verrouille l’application sur /applocked. Dossiers, scripts et tâches Java nommés par la doc.
      </SectionTitle>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {migrations.map((m) => {
          const parent = (outEdges.get(m.id) ?? []).find((e) => e.relation === 'part-of');
          const creates = (outEdges.get(m.id) ?? []).filter((e) => e.relation === 'creates');
          return (
            <Card key={m.id} className="flex min-w-0 flex-col gap-1.5 p-4">
              <div className="flex items-center gap-2">
                <FolderTree size={13} className="shrink-0 text-[var(--t-store)]" />
                <NodeChip id={m.id} compact />
                <span className="ml-auto shrink-0 text-[10.5px] text-muted">{m.subtype}</span>
              </div>
              {(m.props.version || m.props.plageNumver) && (
                <div className="text-[11.5px] text-fg-2">
                  version {String(m.props.version)} · plage numver {String(m.props.plageNumver)}
                </div>
              )}
              {parent && (
                <div className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
                  dans <NodeChip id={parent.target} compact />
                </div>
              )}
              {creates.length > 0 && <div className="text-[11px] text-muted">crée {creates.length} vue(s)</div>}
              <DocRef n={m} />
            </Card>
          );
        })}
      </div>
    </div>
  );
}
