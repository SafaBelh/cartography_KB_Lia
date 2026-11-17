/**
 * LiaWeb database view, derived from data/graph.json (tables, views, who reads / writes / maps them)
 * and data/docs.json (columns, keys, documented links). Pure: no DOM, no import of the bundled data → testable.
 *
 * Nothing is invented:
 *  - the database is the `system` node of category « database » (05:10: one single JNDI datasource);
 *    a table belongs to it only through a `part-of` edge of the graph;
 *  - columns are taken only from explicit doc statements (rules below), each with its line;
 *  - a column is a primary key only when it sits in the « Clé » column of 05 §3.2;
 *  - « Colonnes de liaison » are shown as such: no foreign key is drawn between columns;
 *  - table-level links come only from the « Chaîne principale » sentence of 05 (cardinality as written);
 *  - columns attached through the prefix convention of 05 §3.1 (`PRJ_PROJET` → `FPRJ_`) are flagged [H].
 */
import type { DocFile, DocsBundle, GEdge, GNode, Graph, Relation } from '../types/graph';

export type ColumnRule = 'entity-key' | 'entity-link' | 'dotted-ref' | 'sql-update' | 'table-parenthesis' | 'column-prefix';

export interface DocRef {
  doc: string;
  file: string;
  line: number;
  snippet: string;
}
export interface ColumnSource extends DocRef {
  rule: ColumnRule;
}
export interface Column {
  name: string;
  pk: boolean;
  /** Listed in « Colonnes de liaison » (05 §3.2) — a link column, not a declared foreign key. */
  link: boolean;
  /** Attached only through the prefix convention of 05 §3.1: hypothesis. */
  inferred: boolean;
  notes: string[];
  sql: ('SET' | 'WHERE')[];
  sources: ColumnSource[];
}
export interface Access {
  /** node on the code / data side (class, page, service, object, migration) */
  other: string;
  kind: Relation;
  edge: GEdge;
}
export interface DbTable {
  node: GNode;
  columns: Column[];
  /** Key written without column names (« composite (lot, candidat, type, numéro) »). */
  keyNote?: { text: string; source: DocRef };
  storeEdge?: GEdge;
  access: Access[];
  issues: string[];
  modules: string[];
}
export interface DbGroup {
  prefix: string;
  domain: string;
  tables: DbTable[];
}
export interface DbLink {
  from: string; // entity name as written
  to: string;
  card: string; // "1-1", "1-n"
  fromTable?: string; // table node id
  toTable?: string;
  source: DocRef;
}
export interface DbSchema {
  database?: GNode;
  engines: GNode[];
  groups: DbGroup[];
  views: DbTable[];
  links: DbLink[];
  declaredTables?: { count: number; source: DocRef };
  stats: { tables: number; views: number; tablesWithColumns: number; columns: number; pks: number; fks: 0; links: number; accessEdges: number; inferredColumns: number };
}

const ACCESS: Relation[] = ['reads', 'writes', 'creates', 'maps-to', 'uses'];
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const snip = (s: string) => {
  const t = s.trim();
  return t.length > 240 ? t.slice(0, 238) + '…' : t;
};
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const ticks = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
function splitCells(line: string): string[] {
  const t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cur = '';
  let inTick = false;
  for (const ch of t) {
    if (ch === '`') inTick = !inTick;
    if (ch === '|' && !inTick) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}
const isTableLine = (l: string) => l.trim().startsWith('|');
const isSepLine = (l: string) => /^[\s|:-]+$/.test(l) && l.includes('---');

export function buildSchema(graph: Graph, docs: DocsBundle): DbSchema {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  const tableNodes = graph.nodes.filter((n) => n.type === 'table' || n.type === 'view');
  const tableByLabel = new Map(tableNodes.map((n) => [n.label, n]));
  // identifiers known to be something else (classes, codes, tables…): never read as columns
  const otherAlias = new Set<string>();
  for (const n of graph.nodes) for (const a of [n.label, ...n.aliases]) otherAlias.add(a);

  const columns = new Map<string, Map<string, Column>>();
  const keyNotes = new Map<string, { text: string; source: DocRef }>();
  const ref = (d: DocFile, i: number, line: string): DocRef => ({ doc: d.id, file: d.file, line: i + 1, snippet: snip(line) });
  const addCol = (tbl: GNode, name: string, src: ColumnSource, opt: { pk?: boolean; link?: boolean; inferred?: boolean; note?: string; sql?: 'SET' | 'WHERE' } = {}) => {
    const m = columns.get(tbl.id) ?? columns.set(tbl.id, new Map()).get(tbl.id)!;
    let c = m.get(name);
    if (!c) {
      c = { name, pk: false, link: false, inferred: !!opt.inferred, notes: [], sql: [], sources: [] };
      m.set(name, c);
    }
    if (!opt.inferred) c.inferred = false;
    if (opt.pk) c.pk = true;
    if (opt.link) c.link = true;
    if (opt.note && !c.notes.includes(opt.note)) c.notes.push(opt.note);
    if (opt.sql && !c.sql.includes(opt.sql)) c.sql.push(opt.sql);
    if (!c.sources.some((s) => s.doc === src.doc && s.line === src.line && s.rule === src.rule)) c.sources.push(src);
  };

  const prefixToTable = new Map<string, GNode>(); // FPRJ_ → PRJ_PROJET (05 §3.1)
  const links: DbLink[] = [];
  let declaredTables: DbSchema['declaredTables'];
  const chainLines: { d: DocFile; i: number; line: string }[] = [];

  for (const d of docs.docs) {
    const lines = d.markdown.split('\n');
    let header: string[] | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!declaredTables && d.id === '05') {
        const m = line.match(/Schéma initial\s*:\s*(\d+)\s+tables/);
        if (m) declaredTables = { count: Number(m[1]), source: ref(d, i, line) };
      }
      if (/^Chaîne principale/.test(line.replace(/\*\*/g, ''))) chainLines.push({ d, i, line });
      for (const m of line.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]+)`\s*→\s*`([A-Z][A-Z0-9]*_)`/g)) {
        const t = tableByLabel.get(m[1]);
        if (t) prefixToTable.set(m[2], t);
      }

      // rule 1 — entity table of 05 §3.2: | Entité | Table | Clé | Colonnes de liaison |
      if (isTableLine(line)) {
        if (i + 1 < lines.length && isSepLine(lines[i + 1])) {
          header = splitCells(line);
          continue;
        }
        if (isSepLine(line)) continue;
        if (header) {
          const cells = splitCells(line);
          const ti = header.findIndex((h) => /^Table$/i.test(h));
          const ki = header.findIndex((h) => /^Clé$/i.test(h));
          const li = header.findIndex((h) => /liaison/i.test(h));
          if (ti >= 0 && ki >= 0) {
            const tbls = ticks(cells[ti] ?? '').map((t) => tableByLabel.get(t)).filter(Boolean) as GNode[];
            const keyCell = cells[ki] ?? '';
            const keys = ticks(keyCell).filter((k) => IDENT.test(k));
            tbls.forEach((tbl, idx) => {
              const src = ref(d, i, line);
              // "EXC_ID/BES_ID/OPE_ID" pairs with "REC_EXERCICE/REC_BESOIN/REC_OPERATION"
              const own = tbls.length > 1 && keys.length === tbls.length ? [keys[idx]] : keys;
              for (const k of own) addCol(tbl, k, { ...src, rule: 'entity-key' }, { pk: true, note: /\(/.test(keyCell) && own.length > 1 ? 'clé composite' : /1-1/.test(keyCell) ? keyCell.match(/\(([^)]*1-1[^)]*)\)/)?.[1] : undefined });
              if (!keys.length && keyCell.trim()) keyNotes.set(tbl.id, { text: keyCell.replace(/`/g, '').trim(), source: src });
              if (li >= 0) {
                const linkCell = cells[li] ?? '';
                for (const m of linkCell.matchAll(/`([^`]+)`(?:\s*\(([^)]*)\))?/g)) if (IDENT.test(m[1]) && !tableByLabel.has(m[1])) addCol(tbl, m[1], { ...src, rule: 'entity-link' }, { link: !/porte/i.test(linkCell), note: m[2] });
              }
            });
          }
        }
      } else header = null;

      // rule 2 — `TABLE.COLUMN`
      for (const m of line.matchAll(/`([A-Z][A-Z0-9_]+)\.([A-Z][A-Z0-9_]+)`/g)) {
        const tbl = tableByLabel.get(m[1]);
        if (tbl) addCol(tbl, m[2], { ...ref(d, i, line), rule: 'dotted-ref' });
      }
      // rule 3 — UPDATE table SET a = … WHERE b = …  (code blocks included)
      for (const m of line.matchAll(/UPDATE\s+`?([A-Za-z_]\w*)`?\s+SET\s+(.+?)\s+WHERE\s+([^;]+)/gi)) {
        const tbl = tableByLabel.get(m[1]);
        if (!tbl) continue;
        const src: ColumnSource = { ...ref(d, i, line), rule: 'sql-update' };
        for (const c of m[2].matchAll(/([A-Za-z_]\w*)\s*=/g)) addCol(tbl, c[1], src, { sql: 'SET' });
        for (const c of m[3].matchAll(/([A-Za-z_]\w*)\s*=/g)) addCol(tbl, c[1], src, { sql: 'WHERE' });
      }
      // rule 4 — "`TABLE` (`col1`, `col2`)": only plain identifiers that are not known entities
      // (a list of tables, classes or act codes in parentheses is NOT a column list)
      for (const m of line.matchAll(/`([^`]+)`\s*\(([^()]*)\)/g)) {
        const tbl = tableByLabel.get(m[1]);
        if (!tbl) continue;
        const items = m[2].split(',').map((s) => s.trim()).filter(Boolean);
        if (!items.length || !items.every((s) => /^`[^`]+`$/.test(s))) continue;
        const names = items.map((s) => s.slice(1, -1));
        if (names.every((n) => IDENT.test(n) && !otherAlias.has(n))) for (const n of names) addCol(tbl, n, { ...ref(d, i, line), rule: 'table-parenthesis' });
      }
    }
  }
  // rule 5 — columns cited anywhere whose prefix is tied to a table by 05 §3.1 (hypothesis)
  if (prefixToTable.size) {
    for (const d of docs.docs) {
      const lines = d.markdown.split('\n');
      lines.forEach((line, i) => {
        for (const t of ticks(line)) {
          const p = [...prefixToTable.keys()].find((k) => t.startsWith(k) && t !== k && IDENT.test(t) && /^[A-Z0-9_]+$/.test(t));
          if (p) addCol(prefixToTable.get(p)!, t, { ...ref(d, i, line), rule: 'column-prefix' }, { inferred: true });
        }
      });
    }
  }
  // documented table-level links: « Projet 1-1 Consultation · Projet 1-n Lot · Lot/Projet 1-n Marché … »
  // entity / engine-object name → table (maps-to edges); a name that points to two tables stays unresolved
  const cand = new Map<string, Set<string>>();
  const addCand = (k: string, t: string) => k && (cand.get(norm(k)) ?? cand.set(norm(k), new Set()).get(norm(k))!).add(t);
  for (const e of graph.edges) {
    if (e.relation !== 'maps-to') continue;
    const s = nodeById.get(e.source);
    if (!s) continue;
    if (s.type === 'object') {
      const label = String(s.props.objet ?? '');
      addCand(label, e.target);
      addCand(label.split(' ')[0], e.target);
    } else addCand(s.label, e.target);
  }
  const entityTable = new Map<string, string>();
  for (const [k, set] of cand) if (set.size === 1) entityTable.set(k, [...set][0]);
  for (const { d, i, line } of chainLines) {
    const body = line.replace(/\*\*/g, '').replace(/^Chaîne principale\s*:\s*/, '').split('.')[0];
    for (const part of body.split('·')) {
      const m = part.trim().match(/^(.+?)\s+(1-1|1-n|n-n|n-1)\s+(.+)$/);
      if (!m) continue;
      const froms = m[1].split('/').map((x) => x.trim());
      const tos = m[3].split('/').map((x) => x.trim());
      for (const f of froms) for (const t of tos) links.push({ from: f, to: t, card: m[2], fromTable: entityTable.get(norm(f)), toTable: entityTable.get(norm(t)), source: ref(d, i, line) });
    }
  }

  // ------------------------------------------------------------------ graph side
  const tables = new Map<string, DbTable>();
  for (const n of tableNodes) tables.set(n.id, { node: n, columns: [...(columns.get(n.id)?.values() ?? [])].sort((a, b) => Number(b.pk) - Number(a.pk) || Number(b.link) - Number(a.link) || Number(a.inferred) - Number(b.inferred) || a.name.localeCompare(b.name)), keyNote: keyNotes.get(n.id), access: [], issues: [], modules: [] });
  const database = graph.nodes.find((n) => n.type === 'system' && n.subtype === 'database');
  let accessEdges = 0;
  for (const e of graph.edges) {
    const s = nodeById.get(e.source);
    const t = nodeById.get(e.target);
    if (!s || !t) continue;
    const tb = tables.get(t.id) ?? (e.relation === 'part-of' ? tables.get(s.id) : undefined);
    if (e.relation === 'part-of' && tables.has(s.id) && t.id === database?.id) {
      tables.get(s.id)!.storeEdge = e;
      continue;
    }
    if (!tb) continue;
    if ((e.relation === 'affects' || e.relation === 'mentions') && (s.type === 'issue' || s.type === 'question')) {
      if (!tb.issues.includes(s.id)) tb.issues.push(s.id);
      continue;
    }
    if (e.relation === 'contains' && s.type === 'module') {
      if (!tb.modules.includes(s.id)) tb.modules.push(s.id);
      continue;
    }
    if (ACCESS.includes(e.relation) && e.target === tb.node.id) {
      tb.access.push({ other: s.id, kind: e.relation, edge: e });
      accessEdges++;
    }
  }

  const groupMap = new Map<string, DbGroup>();
  const views: DbTable[] = [];
  for (const tb of tables.values()) {
    if (tb.node.type === 'view') {
      views.push(tb);
      continue;
    }
    const prefix = String(tb.node.props.prefixe ?? tb.node.label.split('_')[0]);
    const g = groupMap.get(prefix) ?? groupMap.set(prefix, { prefix, domain: String(tb.node.props.domaine ?? 'préfixe absent de 05 §3.1'), tables: [] }).get(prefix)!;
    g.tables.push(tb);
  }
  const order = (a: DbTable, b: DbTable) => b.columns.length - a.columns.length || b.access.length - a.access.length || a.node.label.localeCompare(b.node.label);
  const groups = [...groupMap.values()].map((g) => ({ ...g, tables: g.tables.sort(order) })).sort((a, b) => b.tables.length - a.tables.length || a.prefix.localeCompare(b.prefix));
  views.sort((a, b) => a.node.label.localeCompare(b.node.label));
  const all = [...tables.values()];
  return {
    database,
    engines: graph.nodes.filter((n) => n.type === 'tech' && n.subtype === 'sgbd').sort((a, b) => a.label.localeCompare(b.label)),
    groups,
    views,
    links,
    declaredTables,
    stats: {
      tables: all.filter((t) => t.node.type === 'table').length,
      views: views.length,
      tablesWithColumns: all.filter((t) => t.columns.length).length,
      columns: all.reduce((n, t) => n + t.columns.length, 0),
      pks: all.reduce((n, t) => n + t.columns.filter((c) => c.pk).length, 0),
      fks: 0,
      links: links.length,
      accessEdges,
      inferredColumns: all.reduce((n, t) => n + t.columns.filter((c) => c.inferred).length, 0),
    },
  };
}
