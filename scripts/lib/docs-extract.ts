/**
 * LiaWeb knowledge base (13 Markdown docs) → graph.
 *
 * Principles (same as the reference Talend cartography)
 *  - Every node and edge is backed by at least one doc line (file + line + verbatim snippet).
 *  - Entities come from deterministic recognisers (scripts/lib/java.ts) or from names the docs define
 *    themselves (tables of 05, 11, 01, 04 …). Dictionary entries (systems, tech) are kept only if an alias
 *    is really found.
 *  - Relations come only from explicit statements: arrows, same clause (with the verb cue when there is
 *    one), table rows, headings. The rule is in provenance.method and provenance.metadata.rule.
 *    Inferences (relative path → package, table order → transition) are always [H].
 *  - Confidence: line tag → section tag (or a tag alone under the heading) → doc legend → [H].
 *  - Secrets: only names and locations are kept (10 §2 lists files, never values).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Confidence, NodeType, PropValue, Provenance, Relation } from '../../src/types/graph';
import type { GraphBuilder } from './builder';
import type { CartoConfig, DictEntry, LifecycleDef, SectionRef, WorkflowDef } from './config';
import { classKind, classPrefix, expandTableToken, parseEndpoint, parseFile, parseJavaSpan, parseJvmProperty, parseMigration, parseResource, tableMatcher, TABLE_SHAPE, type JavaRef } from './java';
import { backtickSpans, maskSpans, parenDepth, parseMarkdown, plain, resolveConfidence, slugify, snippet, type LegendRule, type MdDoc, type MdLine, type Span } from './markdown';

export interface Hit {
  id: string;
  type: NodeType;
  subtype?: string;
  start: number;
  end: number;
  group: number;
  depth: number;
  /** text of the span (or alias) as written */
  text: string;
  /** cell index for table rows */
  cell: number;
  /** pending Java reference (classes / packages resolved after the scan) */
  ref?: JavaRef;
  /** value written in the doc when the id was expanded (NT_* → NT_MAR, REC_CUMUL_ARN/OPE → REC_CUMUL_OPE) */
  via?: string;
  /** column cited with the table (`LBT_COMPTE.LCMP_NUMVER`) */
  column?: string;
  /** package node created by inference (relative path + doc base, suffix match) */
  inferred?: string;
  /** package of the enclosing section (04 module heading, 06 « `interfaces/` » heading) */
  ctxPkg?: string;
  /** inside a confidence tag « [V `path`] »: evidence for the line, never a party of a relation */
  inTag?: boolean;
  label?: string;
  props?: Record<string, PropValue>;
  aliases?: string[];
}

export interface DocExtraction {
  docs: MdDoc[];
  lineNodes: Map<string, Map<number, Set<string>>>;
  declared: { id: string; label: string; count: number; type: NodeType; provenance: Provenance; subtype?: string; complete?: boolean }[];
  unmapped: { item: string; reason: string; where?: string }[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** plain text without the confidence tags (labels) */
const clean = (s: string) => plain(s).replace(/\s*\[[VH](?![A-Za-zÀ-ÿ])[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
const CODE_TYPES = new Set<NodeType>(['page', 'service', 'class', 'package']);
const SUBJECT_TYPES = new Set<NodeType>(['page', 'service', 'class', 'package', 'object', 'migration', 'brick']);
// JS « \b » ignores accented letters: word edges are written as explicit lookarounds
const W0 = '(?<![A-Za-zÀ-ÿ])';
const W1 = '(?![A-Za-zÀ-ÿ])';
const cue = (body: string) => new RegExp(`${W0}(?:${body})${W1}`, 'i');
const CALL_CUE = cue('appel(?:le|lent|ée?s?)?|délègue|lance|planifie|enchaîne|qui appelle');
const PASSIVE_CUE = cue('appelée?s?\\s+(?:depuis|par)');
const NEGATION = cue('pas|aucune?|jamais');
const READ_CUE = cue('lit|lue?s?|lisent|charg[a-zé]*');
const WRITE_CUE = cue('écri(?:t|vent|ture)|persist[a-zé]*|met à jour|trac[a-zé]*|journalis[a-zé]*|pose[a-z]*');
const CREATE_CUE = /\(re\)créé|(?<![A-Za-zÀ-ÿ])cré(?:e|ée|ées|ent|ation)(?![A-Za-zÀ-ÿ])/i;

export function loadDocs(docsDir: string, cfg: CartoConfig): MdDoc[] {
  const legend = new RegExp(cfg.docs.legendLinePattern);
  // one file per doc number: when several share it (05-…-new.md beside the old 05), cfg.docFiles chooses
  const byNum = new Map<string, string[]>();
  for (const f of readdirSync(docsDir).filter((x) => /^\d\d-.*\.md$/i.test(x)).sort()) {
    const num = f.slice(0, 2);
    byNum.set(num, [...(byNum.get(num) ?? []), f]);
  }
  const chosen: string[] = [];
  for (const [num, files] of byNum) {
    const want = cfg.docFiles?.[num];
    if (want) {
      if (!files.includes(want)) throw new Error(`docFiles.${num} = « ${want} » introuvable dans ${docsDir} (présents : ${files.join(', ')})`);
      chosen.push(want);
    } else if (files.length > 1) throw new Error(`Plusieurs documents ${num} (${files.join(', ')}) : choisir le bon dans « docFiles » de la configuration`);
    else chosen.push(files[0]);
  }
  return chosen.sort().map((f) => parseMarkdown(f, readFileSync(join(docsDir, f), 'utf8'), legend));
}

export function extractFromDocs(cfg: CartoConfig, docsDir: string, b: GraphBuilder, opts: { provenancePrefix: string }): DocExtraction {
  const docs = loadDocs(docsDir, cfg);
  const lineNodes = new Map<string, Map<number, Set<string>>>();
  const unmapped = new Map<string, { item: string; reason: string; where?: string }>();
  const legendRules = new Map<string, LegendRule[]>();
  for (const l of cfg.docs.legendSections) {
    const arr = legendRules.get(l.file) ?? [];
    arr.push({ heading: new RegExp(l.heading), confidence: l.confidence, where: l.where });
    legendRules.set(l.file, arr);
  }
  const legendOf = (doc: MdDoc) => [...legendRules.entries()].filter(([f]) => doc.file.startsWith(f)).flatMap(([, r]) => r);

  // ------------------------------------------------------------------ helpers
  const docByPrefix = (prefix: string) => docs.find((d) => d.file.startsWith(prefix));
  type ConfOverride = { confidence: Confidence; from: Provenance['confidenceFrom'] };
  const prov = (doc: MdDoc, line: MdLine, method: string, override?: ConfOverride, metadata?: Record<string, string>): Provenance => {
    const r = resolveConfidence(doc, line, legendOf(doc));
    const c = override ?? { confidence: r.confidence, from: r.from };
    const md: Record<string, string> = { rule: method, ...(metadata ?? {}) };
    if (!override && r.tagText) md.tag = r.tagText;
    if (override) md.inference = md.inference ?? 'déduction de l’extracteur : toujours [H]';
    return { kind: 'doc', file: `${opts.provenancePrefix}${doc.file}`, line: line.n, section: line.sectionId, snippet: snippet(line.raw), confidence: c.confidence, confidenceFrom: c.from, method, metadata: md };
  };
  const H: ConfOverride = { confidence: 'H', from: 'fallback' };
  const markLine = (doc: MdDoc, n: number, id: string) => {
    let m = lineNodes.get(doc.id);
    if (!m) lineNodes.set(doc.id, (m = new Map()));
    let s = m.get(n);
    if (!s) m.set(n, (s = new Set()));
    s.add(id);
  };
  const sectionMatch = (doc: MdDoc, ref: SectionRef) => doc.file.startsWith(ref.file);
  const inSection = (l: MdLine, re: RegExp) => l.headingPath.some((h) => re.test(h));
  const sectionLines = (doc: MdDoc, heading: string) => {
    const re = new RegExp(heading);
    return doc.lines.filter((l) => l.kind !== 'heading' && inSection(l, re));
  };
  const headingLine = (doc: MdDoc, heading: string) => doc.lines.find((l) => l.kind === 'heading' && new RegExp(heading).test(l.raw.replace(/^#+\s*/, '')));
  const isHeaderRow = (doc: MdDoc, l: MdLine) => doc.lines[l.n]?.kind === 'table-sep';
  const headerCache = new Map<string, string[] | undefined>();
  /** Header cells of the Markdown table holding this row. */
  const tableHeader = (doc: MdDoc, l: MdLine): string[] | undefined => {
    if (l.kind !== 'table-row') return undefined;
    let i = l.n - 1;
    while (i > 0 && (doc.lines[i - 1].kind === 'table-row' || doc.lines[i - 1].kind === 'table-sep')) i--;
    const key = `${doc.id}:${i}`;
    if (!headerCache.has(key)) {
      const first = doc.lines[i];
      headerCache.set(key, first?.kind === 'table-row' && doc.lines[i + 1]?.kind === 'table-sep' ? first.cells : undefined);
    }
    return headerCache.get(key);
  };
  const cellAt = (l: MdLine, pos: number) => {
    if (l.kind !== 'table-row' || !l.cellOffsets) return 0;
    let c = 0;
    l.cellOffsets.forEach((o, i) => {
      if (pos >= o) c = i;
    });
    return c;
  };
  const rowsOf = (doc: MdDoc, heading: string) => sectionLines(doc, heading).filter((l) => l.kind === 'table-row' && !isHeaderRow(doc, l) && l.cells);
  const spansIn = (s: string) => backtickSpans(s).map((x) => x.text.trim());

  // doc base statement ("Sauf mention contraire, les paquets sont sous `src/com/ordiges/`")
  const docBase = new Map<string, { pkg: string; line: number; raw: string }>();
  for (const d of docs) {
    for (const l of d.lines) {
      const m = l.raw.match(new RegExp(cfg.docs.docBasePattern));
      if (m) {
        const pkg = m[1].replace(/^src\//, '').replace(/\/+$/, '').replace(/\//g, '.');
        docBase.set(d.id, { pkg, line: l.n, raw: m[1] });
        break;
      }
    }
  }
  const isPackageRoot = (dotted: string) => cfg.java.packageRoots.some((r) => dotted === r || dotted.startsWith(r + '.'));
  /** first-level packages named in a « Paquet(s) » column whose prefix is a root (03 §3.4 `com.ordiges`, 03 §4 `com.ordiges.`) */
  const topLevel = new Set<string>();
  for (const d of docs) for (const l of d.lines) {
    if (l.kind !== 'table-row' || !l.cells) continue;
    let i = l.n - 1;
    while (i > 0 && (d.lines[i - 1].kind === 'table-row' || d.lines[i - 1].kind === 'table-sep')) i--;
    const hdr = d.lines[i + 1]?.kind === 'table-sep' && i + 1 !== l.n ? d.lines[i].cells : undefined;
    if (!hdr) continue;
    hdr.forEach((h, ci) => {
      if (!/^Paquets?\b/.test(h)) return;
      const hp = backtickSpans(h)[0]?.text;
      const hd = [...l.headingPath].reverse().map((x) => backtickSpans(x).map((y) => y.text).find((y) => cfg.java.packageRoots.includes(y))).find(Boolean);
      const prefix = hp && hp.endsWith('.') ? hp.slice(0, -1) : hd;
      if (!prefix || !cfg.java.packageRoots.includes(prefix)) return;
      for (const sp of backtickSpans(l.cells![ci] ?? '')) if (/^[a-z][a-z0-9]*$/.test(sp.text)) topLevel.add(`${prefix}.${sp.text}`);
    });
  }

  // ------------------------------------------------------------------ 0. names the docs define themselves
  // table prefixes (05 §3.1)
  const tablePrefix = new Map<string, { domain: string; doc: MdDoc; line: MdLine }>();
  {
    const d = docByPrefix(cfg.docs.tablePrefixes.file);
    if (d) for (const l of rowsOf(d, cfg.docs.tablePrefixes.heading)) {
      const p = spansIn(l.cells![0])[0];
      if (p && /^[A-Z0-9]+$/.test(p)) tablePrefix.set(p, { domain: plain(l.cells![1] ?? ''), doc: d, line: l });
    }
  }
  const tableRe = tableMatcher([...tablePrefix.keys()]);
  // resource prefixes (12 §6.1)
  const resourcePrefix = new Map<string, string>();
  {
    const d = docByPrefix(cfg.docs.resourcePrefixes.file);
    if (d) for (const l of rowsOf(d, cfg.docs.resourcePrefixes.heading)) for (const s of spansIn(l.cells![0])) if (/^[a-z]+_$/.test(s)) resourcePrefix.set(s, plain(l.cells![1] ?? ''));
  }
  // engine object codes (11 §1)
  const objects = new Map<string, { label: string; table?: string; doc: MdDoc; line: MdLine }>();
  {
    const d = docByPrefix(cfg.docs.objects.file);
    if (d) for (const l of rowsOf(d, cfg.docs.objects.heading)) {
      const code = spansIn(l.cells![0])[0];
      if (code && /^[a-z]{4}$/.test(code)) objects.set(code, { label: plain(l.cells![1] ?? ''), table: spansIn(l.cells![2] ?? '')[0], doc: d, line: l });
    }
  }
  // act codes (04 « Familles »)
  const actCodes = new Map<string, { family: string; doc: MdDoc; line: MdLine }>();
  {
    const d = docByPrefix(cfg.docs.actCodes.file);
    if (d) for (const l of rowsOf(d, cfg.docs.actCodes.heading)) {
      if (!/Codes?/i.test(tableHeader(d, l)?.[1] ?? '')) continue;
      for (const c of spansIn(l.cells![1] ?? '')) if (/^[A-Z][A-Z0-9_]*\*?$/.test(c)) actCodes.set(c, { family: plain(l.cells![0]), doc: d, line: l });
    }
  }
  const actFamily = (t: string): string[] => {
    if (actCodes.has(t)) return [t];
    if (/^[A-Z][A-Z0-9_]*_\*$/.test(t)) {
      const p = t.slice(0, -1);
      return [...actCodes.keys()].filter((k) => k.startsWith(p) && k !== t);
    }
    return [];
  };
  // product bricks (01 §2)
  const bricks = new Map<string, { role: string; doc: MdDoc; line: MdLine }>();
  const licences = new Map<string, { doc: MdDoc; line: MdLine }>();
  {
    const d = docByPrefix(cfg.docs.bricks.file);
    if (d) {
      for (const l of rowsOf(d, cfg.docs.bricks.heading)) {
        const name = plain(l.cells![0]);
        if (name) bricks.set(name, { role: plain(l.cells![1] ?? ''), doc: d, line: l });
        const hdr = tableHeader(d, l) ?? [];
        l.cells!.forEach((c, i) => {
          if (!/Licence/i.test(hdr[i] ?? '')) return;
          for (const s of spansIn(c)) if (!parseResource(s, [...resourcePrefix.keys()])) licences.set(s, { doc: d, line: l });
        });
      }
      for (const l of sectionLines(d, cfg.docs.licences.heading)) {
        const at = l.raw.indexOf(cfg.docs.licences.listPattern);
        if (at < 0) continue;
        for (const sp of backtickSpans(l.raw)) if (sp.start > at && /^[\w.]+$/.test(sp.text)) licences.set(sp.text, { doc: d, line: l });
      }
    }
  }
  // config names: spans right after « préférence / paramètre / clé / propriété »
  const configNames = new Map<string, { doc: MdDoc; line: MdLine }>();
  const expertises = new Map<string, { doc: MdDoc; line: MdLine }>();
  for (const d of docs) for (const l of d.lines) {
    if (l.kind === 'code' || l.kind === 'heading') continue;
    const spans = backtickSpans(l.raw);
    for (const sp of spans) {
      const before = l.raw.slice(Math.max(0, sp.start - 28), sp.start).replace(/\*\*/g, '');
      if (/(?:préférence|paramètre|clé|propriété)\s*$/i.test(before) && /^[a-z][\w.]*$/.test(sp.text) && !isPackageRoot(sp.text)) configNames.set(sp.text, { doc: d, line: l });
      const cellText = l.kind === 'table-row' && l.cells ? l.cells[0] : '';
      const near = l.raw.slice(Math.max(0, sp.start - 18), sp.start);
      if ((/expertises?\s*$/i.test(near) || /expertise/i.test(cellText)) && /^(?:[a-z]+:[A-Z]\w+|[A-Z][A-Za-z]*_[A-Za-z_]+|[A-Z][a-z]+[A-Z]\w+)$/.test(sp.text) && !tableRe.test(sp.text)) expertises.set(sp.text, { doc: d, line: l });
    }
  }
  // source roots (03 §1, 02 §2)
  const roots = new Map<string, { label: string; role: string; build: string; doc: MdDoc; line: MdLine }>();
  for (const ref of cfg.docs.sourceRoots) {
    const d = docByPrefix(ref.file);
    if (!d) continue;
    for (const l of rowsOf(d, ref.heading)) {
      const s = spansIn(l.cells![0])[0];
      if (!s || !(/\/$/.test(s) || /\/src\/(main|test)\/java$/.test(s))) continue;
      const key = s.replace(/\/+$/, '');
      if (!roots.has(key)) roots.set(key, { label: s, role: plain(l.cells![1] ?? ''), build: plain(l.cells![2] ?? ''), doc: d, line: l });
    }
  }
  const rootIdOf = (first: string): string | undefined => {
    if (roots.has(`${first}/src/main/java`)) return `root:${first}/src/main/java`;
    if (first === 'test' && roots.has('test/java')) return 'root:test/java';
    if (roots.has(first)) return `root:${first}`;
    return undefined;
  };
  // lifecycle states (parsed now: their codes are recognised in the other docs)
  const lifecycles = parseLifecycles();
  // entities (05 §3.2) — names whose same-clause link to a table is « correspond à »
  const entityNames = new Set<string>();
  {
    const d = docByPrefix(cfg.docs.entities.file);
    if (d) for (const l of rowsOf(d, cfg.docs.entities.heading)) for (const s of spansIn(l.cells![0])) for (const r of parseJavaSpan(s, cfg.java.packageRoots, cfg.java.sourceRoots)) if (r.simple) entityNames.add(r.simple);
  }
  // dictionary aliases (systems, tech, bricks)
  interface Alias { alias: string; id: string; type: NodeType; subtype?: string; label: string }
  const aliases: Alias[] = [];
  const dictEntries = new Map<string, { entry: DictEntry; type: NodeType }>();
  for (const s of cfg.systems) {
    dictEntries.set(s.id, { entry: s, type: 'system' });
    for (const a of s.aliases) aliases.push({ alias: a, id: s.id, type: 'system', subtype: s.category, label: s.label });
  }
  for (const t of cfg.tech) {
    dictEntries.set(t.id, { entry: t, type: 'tech' });
    for (const a of t.aliases) aliases.push({ alias: a, id: t.id, type: 'tech', subtype: t.category, label: t.label });
  }
  for (const [name] of bricks) if (!cfg.docs.bricks.ambiguous.includes(name)) aliases.push({ alias: name, id: `brick:${slugify(name)}`, type: 'brick', label: name });
  aliases.sort((x, y) => y.alias.length - x.alias.length);

  // ------------------------------------------------------------------ 1. pre-pass: class names proved by a path, an FQCN or a method call
  const strongClass = new Set<string>();
  for (const d of docs) for (const l of d.lines) {
    if (l.kind === 'code') continue;
    for (const sp of backtickSpans(l.raw)) for (const r of parseJavaSpan(sp.text, cfg.java.packageRoots, cfg.java.sourceRoots)) {
      if (r.kind === 'class' && r.simple && (r.path?.includes('/') || r.path?.endsWith('.java') || r.pkg || r.pkgSuffix || r.method)) strongClass.add(r.simple);
    }
  }
  const cueRe = new RegExp(cfg.java.classCues);

  // ------------------------------------------------------------------ 2. scanning
  let groupSeq = 0;
  const migrationCtx = (doc: MdDoc, l: MdLine) => cfg.docs.migrationSections.some((r) => sectionMatch(doc, r) && inSection(l, new RegExp(r.heading))) || /dbupdate/.test(l.raw);
  const moduleHeadingPackages = new Map<string, string>(); // short name → full (04)

  const scanLine = (doc: MdDoc, line: MdLine): Hit[] => {
    const raw = line.raw;
    const spans = backtickSpans(raw);
    const masked = maskSpans(raw, spans);
    const depth = parenDepth(raw, spans);
    const header = tableHeader(doc, line);
    const hits: Hit[] = [];
    const tagRanges = [...raw.matchAll(/\[[VH](?![A-Za-zÀ-ÿ])[^\[\]]*\]/g)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
    const push = (h: Omit<Hit, 'depth' | 'cell' | 'group'> & { group?: number }) => {
      const inTag = tagRanges.some(([a, z]) => h.start >= a && h.start < z);
      hits.push({ ...h, group: h.group ?? ++groupSeq, depth: depth[h.start] ?? 0, cell: cellAt(line, h.start), inTag });
    };
    const base = docBase.get(doc.id);
    const isModuleHeading = line.kind === 'heading' && line.level === 3 && doc.file.startsWith(cfg.docs.modules.file) && cfg.docs.modules.parts.some((p) => inSection(line, new RegExp(p)));

    /** prefix for a short package name written in this context, or null when the context does not allow one */
    const shortPackagePrefix = (sp: Span): { prefix: string; from: string } | null => {
      const colHeader = header?.[cellAt(line, sp.start)] ?? '';
      if (line.kind === 'table-row' && /^(?:Sous-)?[Pp]aquets?\b/.test(colHeader)) {
        const hp = spansIn(colHeader)[0];
        if (hp && hp.endsWith('.')) return { prefix: hp, from: 'en-tête de colonne' };
        if (/^Sous-paquet/i.test(colHeader)) {
          for (const h of [...line.headingPath].reverse()) {
            const short = spansIn(h).find((x) => moduleHeadingPackages.has(x));
            if (short) return { prefix: moduleHeadingPackages.get(short)! + '.', from: 'paquet du titre de section' };
          }
        }
        for (const h of [...line.headingPath].reverse()) {
          const full = spansIn(h).find((x) => isPackageRoot(x) && /^[a-z.]+$/.test(x));
          if (full) return { prefix: full + '.', from: 'titre de section' };
          const dir = spansIn(h).find((x) => /^[a-z]+\/$/.test(x));
          if (dir && base) return { prefix: `${base.pkg}.${dir.replace(/\/$/, '')}.`, from: `titre de section + base ${doc.id}:${base.line}` };
        }
        if (base) return { prefix: base.pkg + '.', from: `base déclarée ${doc.id}:${base.line}` };
      }
      if (isModuleHeading && base && sp.start > raw.indexOf('—')) return { prefix: base.pkg + '.', from: `titre de module + base ${doc.id}:${base.line}` };
      return null;
    };
    const sectionPkg = (() => {
      for (const h of [...line.headingPath].reverse()) {
        const short = spansIn(h).find((x) => moduleHeadingPackages.has(x));
        if (short) return moduleHeadingPackages.get(short);
        const dir = spansIn(h).find((x) => /^[a-z]+\/$/.test(x));
        if (dir && base) return `${base.pkg}.${dir.replace(/\/$/, '')}`;
      }
      return undefined;
    })();

    spans.forEach((sp) => {
      const t = sp.text.trim();
      const before = hits.length;
      const colHeader = header?.[cellAt(line, sp.start)] ?? '';
      const clauseBefore = masked.slice(Math.max(0, sp.start - 40), sp.start);
      const base0 = { start: sp.start, end: sp.end, text: t, ctxPkg: sectionPkg };
      // doc cross-reference
      const dm = t.match(/^(\d\d)-[\w-]+\.md$/);
      if (dm) return void push({ ...base0, id: `doc:${dm[1]}`, type: 'doc' });
      // endpoints
      // URL paths of the REST table are read by its dedicated parser
      if (/^(?:Chemins?|Méthodes)$/.test(colHeader)) return;
      const ep = parseEndpoint(t);
      if (ep) return void push({ ...base0, id: `ep:${ep}`, type: 'endpoint', label: ep, aliases: [t] });
      if (/^Portée$/.test(colHeader)) return;
      // JVM properties
      const jvm = parseJvmProperty(t);
      if (jvm) return void push({ ...base0, id: `cfg:${jvm}`, type: 'config', subtype: 'propriété JVM', label: jvm, aliases: [jvm] });
      // engine objects (fprj, fcns.Etat)
      const objCode = t.match(/^([a-z]{4})(?:\.[A-Z]\w*)?$/)?.[1];
      if (objCode && objects.has(objCode)) return void push({ ...base0, id: `obj:${objCode}`, type: 'object', via: t !== objCode ? t : undefined });
      for (const m of t.matchAll(/["']([a-z]{4})["']/g)) if (objects.has(m[1])) push({ ...base0, id: `obj:${m[1]}`, type: 'object', via: t });
      // act codes
      const acts = actFamily(t);
      if (acts.length) {
        const g = ++groupSeq;
        for (const a of acts) push({ ...base0, group: g, id: `act:${a}`, type: 'actCode', via: a !== t ? t : undefined });
        return;
      }
      // expertises (catalogue rules)
      if (expertises.has(t)) return void push({ ...base0, id: `rule:exp:${t}`, type: 'rule', subtype: 'expertise', label: t, aliases: [t] });
      // licences (only where the doc says « licence »)
      const licCtx = /licences?\s*$/i.test(clauseBefore.replace(/\*\*/g, '')) || (/Licence/i.test(colHeader) && doc.file.startsWith(cfg.docs.bricks.file)) || (raw.includes(cfg.docs.licences.listPattern) && sp.start > raw.indexOf(cfg.docs.licences.listPattern));
      if (licCtx && /^[\w.]+$/.test(t) && !parseResource(t, [...resourcePrefix.keys()])) return void push({ ...base0, id: `lic:${t}`, type: 'licence', label: t, aliases: [t] });
      // configuration names (préférence / paramètre / clé)
      if (configNames.has(t)) return void push({ ...base0, id: `cfg:${t}`, type: 'config', subtype: 'préférence / paramètre', label: t, aliases: [t] });
      // source roots written alone (`lia-core`, `srctest/`)
      const rootKey = t.replace(/\/+$/, '');
      if (roots.has(rootKey) || (/^lia-[a-z]+$/.test(t) && rootIdOf(t))) return void push({ ...base0, id: roots.has(rootKey) ? `root:${rootKey}` : rootIdOf(t)!, type: 'sourceRoot' });
      // short package names in a context that gives their prefix
      if (/^[a-z][a-z0-9]*(?:[./][a-z][a-z0-9]*)*$/.test(t) && !isPackageRoot(t)) {
        const sp0 = shortPackagePrefix(sp);
        if (sp0) {
          // a first segment that 03 lists as a top-level package wins over a section prefix (`signature/aife`)
          const first = t.split(/[./]/)[0];
          const rootTop = [...topLevel].find((x) => x.endsWith('.' + first) && sp0.prefix.startsWith(x.slice(0, x.lastIndexOf('.') + 1)) && sp0.prefix !== x.slice(0, x.lastIndexOf('.') + 1));
          const full = (rootTop ? rootTop.slice(0, rootTop.lastIndexOf('.') + 1) : sp0.prefix) + t.replace(/\//g, '.');
          if (isModuleHeading) moduleHeadingPackages.set(t, full);
          return void push({ ...base0, id: `pkg:${full}`, type: 'package', label: full, aliases: [t], props: { prefixeDe: sp0.from } });
        }
      }
      // migrations
      const migs = parseMigration(t, migrationCtx(doc, line) || (doc.file.startsWith(cfg.docs.migrationTree.file) && inSection(line, new RegExp(cfg.docs.migrationTree.heading)) && cellAt(line, sp.start) === 0) || /^(?:Créée par|Script de suppression)$/.test(colHeader));
      if (migs.length) {
        const g = ++groupSeq;
        for (const m of migs) push({ ...base0, group: g, id: m.id, type: 'migration', subtype: m.subtype, label: m.label, props: m.parent ? { parent: m.parent } : undefined, aliases: [m.label.replace(/\/$/, '')] });
        return;
      }
      // XML resources (dd_lia, ce_*, rt_lia, dl_lia_*)
      const res = parseResource(t, [...resourcePrefix.keys()]);
      if (res) return void push({ ...base0, id: `res:${res}`, type: 'resource', label: res, aliases: [res], subtype: resourcePrefix.get(res.split('_')[0] + '_') });
      // tables, views, columns
      if (!/Clé|Colonne/i.test(colHeader)) {
        const ex = expandTableToken(t);
        const isViewSection = doc.file.startsWith(cfg.docs.views.file) && inSection(line, new RegExp(cfg.docs.views.heading));
        const lead = masked.slice(0, sp.start).split(/\.\s/).pop() ?? '';
        const tableWord = /Table/i.test(colHeader) || (/\btables?\b/i.test(lead) && !/colonne/i.test(lead));
        const g = ++groupSeq;
        for (const name of ex.tables) {
          const ok = tableRe.test(name) || (tableWord && TABLE_SHAPE.test(name) && !actCodes.has(name));
          if (!ok) continue;
          const isView = /^VUE_/.test(name) || isViewSection;
          push({ ...base0, group: g, id: `${isView ? 'view' : 'tbl'}:${name}`, type: isView ? 'view' : 'table', label: name, via: ex.tables.length > 1 ? t : undefined, column: ex.column });
        }
        if (hits.length > before) return;
      }
      // Java (FQCN, paths, Class.method, CamelCase)
      const jrefs = parseJavaSpan(t, cfg.java.packageRoots, cfg.java.sourceRoots);
      if (jrefs.length) {
        const g = ++groupSeq;
        for (const r of jrefs) {
          if (r.kind === 'package') {
            push({ ...base0, group: g, id: r.pkg ? `pkg:${r.pkg}` : 'pkg?', type: 'package', ref: r, label: r.pkg, aliases: [t] });
            continue;
          }
          if (!r.simple) continue;
          if (cfg.java.ignoreClasses.includes(r.simple)) return; // JDK / JPA / library class: not LiaWeb code, not « unmapped » either
          const strong = !!(r.path?.includes('/') || r.path?.endsWith('.java') || r.pkg || r.pkgSuffix || r.method || /^new\s/.test(t));
          const kind = classKind(r.simple, cfg.java.kindOverrides);
          const hasCue = cueRe.test(colHeader) || /(?:classe|entité)s?\s*\**$/i.test(clauseBefore) || (line.kind === 'table-row' && cueRe.test(line.cells?.[cellAt(line, sp.start)] ?? ''));
          if (!(strong || kind.bySuffix || hasCue || strongClass.has(r.simple))) continue;
          push({ ...base0, group: g, id: 'class?', type: kind.type, subtype: kind.subtype, ref: r });
        }
        if (hits.length > before) return;
      }
      // repository files
      const f = parseFile(t, cfg.files.extensions);
      if (f) return void push({ ...base0, id: f.id, type: 'file', label: f.label, subtype: f.ext, aliases: [f.label, t] });
      if (t === cfg.projectLabel) return void push({ ...base0, id: `project:${slugify(cfg.projectLabel)}`, type: 'project' });
      // dictionary aliases inside spans: exact, or contained (long aliases only)
      for (const a of aliases) {
        if (t === a.alias || (a.alias.length >= 8 && new RegExp(`(?<![A-Za-z0-9_])${escapeRe(a.alias)}(?![A-Za-z0-9_])`).test(t))) {
          push({ ...base0, id: a.id, type: a.type, subtype: a.subtype });
          return;
        }
      }
      noteUnmapped(t, doc, line, colHeader);
    });

    // plain text: dictionary aliases (+ the version written right after: « EclipseLink 2.7.15 »)
    let rest = masked;
    for (const a of aliases) {
      const re = new RegExp(`(?<![A-Za-zÀ-ÿ0-9_/.\\-])${escapeRe(a.alias)}${/[A-Za-z0-9_]$/.test(a.alias) ? '(?![A-Za-zÀ-ÿ0-9_\\-])' : ''}`, 'g');
      for (const m of rest.matchAll(re)) {
        const s = m.index ?? 0;
        const ver = a.type === 'tech' ? masked.slice(s + a.alias.length).match(/^\s+(\d+(?:\.\d+)*(?:-?[a-zA-Z]+\d*)?)\b/)?.[1] : undefined;
        push({ start: s, end: s + a.alias.length, text: a.alias, id: a.id, type: a.type, subtype: a.subtype, props: ver ? { version: ver } : undefined });
        rest = rest.slice(0, s) + ' '.repeat(a.alias.length) + rest.slice(s + a.alias.length);
      }
    }
    // lifecycle state mentions (« étape `publicite` », « état à 5 », « → **Soldé** »)
    for (const lc of lifecycles.defs) {
      if (!lc.mention || lc.lines.has(`${doc.id}:${line.n}`)) continue;
      if (!new RegExp(lc.mention.guard).test(raw)) continue;
      for (const m of raw.matchAll(new RegExp(lc.mention.code, 'g'))) {
        for (const v of m.slice(1).filter(Boolean)) {
          const st = lifecycles.find(lc.id, v, !!lc.mention.byLabel);
          if (st) push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: v, id: st, type: 'state' });
        }
      }
    }
    hits.sort((x, y) => x.start - y.start || x.group - y.group);
    return hits;
  };

  function noteUnmapped(t: string, doc: MdDoc, line: MdLine, colHeader: string) {
    if (/Clé|Colonne/i.test(colHeader)) return; // columns: shown by the Base de données view
    let reason: string | null = null;
    if (/^[A-Z][a-z]+[A-Z]\w+$/.test(t)) reason = 'Nom CamelCase cité sans indice de classe (ni chemin, ni suffixe, ni colonne « Classe »)';
    else if (/^[A-Z][A-Z0-9]+_[A-Z0-9_*]+$/.test(t) && !/^[A-Z]{2,5}_[A-Z]+$/.test(t.replace(/_IDENTIFIANT|_ID$/, ''))) reason = 'Nom au format <MODULE>_<NOM> dont le préfixe n’est pas dans 05 §3.1, sans le mot « table »';
    else if (/^[A-Z][A-Z0-9]+_[A-Z0-9_*]+$/.test(t)) reason = 'Code ou nom de colonne non rattaché';
    else if (/^[a-z][\w-]*(?:\/[\w.\-*]+)+\/?$/.test(t)) reason = 'Chemin relatif sans base déclarée dans ce document';
    if (!reason) return;
    if (!unmapped.has(t)) unmapped.set(t, { item: t, reason, where: `${doc.file}:${line.n}` });
  }

  // ------------------------------------------------------------------ 3. pass 1: scan everything
  const scanned: { doc: MdDoc; line: MdLine; hits: Hit[] }[] = [];
  // 04 module headings first, so their packages are known when the tables below them are read
  const ordered = [...docs].sort((a, c) => (a.file.startsWith(cfg.docs.modules.file) ? -1 : c.file.startsWith(cfg.docs.modules.file) ? 1 : 0));
  for (const doc of ordered) {
    for (const line of doc.lines) {
      if (line.kind === 'code' || line.kind === 'blank' || line.kind === 'table-sep' || line.isLegend) continue;
      const hits = scanLine(doc, line);
      if (hits.length) scanned.push({ doc, line, hits });
    }
  }
  scanned.sort((a, c) => a.doc.file.localeCompare(c.doc.file) || a.line.n - c.line.n);

  // ------------------------------------------------------------------ 4. resolve packages and classes
  const knownPackages = new Set<string>();
  for (const s of scanned) for (const h of s.hits) {
    if (h.type === 'package' && h.id.startsWith('pkg:')) knownPackages.add(h.id.slice(4));
    if (h.ref?.pkg) knownPackages.add(h.ref.pkg);
  }
  const resolveSuffix = (doc: MdDoc, r: JavaRef, ctxPkg?: string): { pkg: string; how: string } | null => {
    if (r.pkg) return { pkg: r.pkg, how: '' };
    if (!r.pkgSuffix) return null;
    const base = docBase.get(doc.id);
    if (r.relative && base) {
      const first = r.pkgSuffix.split('.')[0];
      if (topLevel.has(`${base.pkg}.${first}`) || !ctxPkg) return { pkg: `${base.pkg}.${r.pkgSuffix}`, how: `chemin relatif + base « ${base.raw} » (${doc.id}:${base.line})` };
      return { pkg: `${ctxPkg}.${r.pkgSuffix}`, how: `chemin relatif au paquet de la section (${ctxPkg}) ; base « ${base.raw} » (${doc.id}:${base.line})` };
    }
    const cands = [...knownPackages].filter((p) => p === r.pkgSuffix || p.endsWith('.' + r.pkgSuffix));
    if (cands.length === 1) return { pkg: cands[0], how: `suffixe « ${r.pkgSuffix} » d’un seul paquet connu` };
    return null;
  };
  // candidate packages per class simple name
  const classPkgs = new Map<string, { strong: Set<string>; weak: Set<string> }>();
  for (const { doc, hits } of scanned) for (const h of hits) {
    if (h.id !== 'class?' || !h.ref?.simple) continue;
    const e = classPkgs.get(h.ref.simple) ?? { strong: new Set(), weak: new Set() };
    classPkgs.set(h.ref.simple, e);
    if (h.ref.pkg) e.strong.add(h.ref.pkg);
    else {
      const r = resolveSuffix(doc, h.ref, h.ctxPkg);
      if (r) e.weak.add(r.pkg);
    }
  }
  const classIdOf = (simple: string, type: Hit['type'], pkg: string | undefined) => {
    const e = classPkgs.get(simple)!;
    const pfx = classPrefix(type as 'page' | 'service' | 'class');
    // two full paths in two packages = two classes; inferred packages never split a class
    if (e.strong.size > 1 && pkg && e.strong.has(pkg)) return `${pfx}:${pkg}.${simple}`;
    return `${pfx}:${simple}`;
  };
  for (const { doc, hits } of scanned) {
    for (const h of hits) {
      if (h.type === 'package' && h.id === 'pkg?' && h.ref) {
        const r = resolveSuffix(doc, h.ref, h.ctxPkg);
        if (r) {
          h.id = `pkg:${r.pkg}`;
          h.label = r.pkg;
          h.inferred = r.how;
          h.aliases = [h.text, h.ref.pkgSuffix!.replace(/\./g, '/')];
        } else h.id = '';
        continue;
      }
      if (h.id !== 'class?' || !h.ref?.simple) continue;
      const e = classPkgs.get(h.ref.simple)!;
      let pkg = h.ref.pkg;
      let how = '';
      if (!pkg) {
        const r = resolveSuffix(doc, h.ref, h.ctxPkg);
        if (r && (!e.strong.size || e.strong.has(r.pkg)) && e.weak.size <= 1) {
          pkg = r.pkg;
          how = r.how;
        }
      }
      if (!pkg && e.strong.size === 1) pkg = [...e.strong][0];
      if (!pkg && !e.strong.size && e.weak.size === 1) {
        pkg = [...e.weak][0];
        how = 'paquet déduit d’une autre mention';
      }
      h.id = classIdOf(h.ref.simple, h.type, pkg);
      h.label = h.ref.simple;
      if (!pkg && !e.strong.size && e.weak.size > 1) h.props = { ...(h.props ?? {}), paquetsPossibles: [...e.weak].join(' · ') };
      if (pkg) {
        h.props = { ...(h.props ?? {}), paquet: pkg };
        if (how) h.inferred = how;
      }
    }
    for (let i = hits.length - 1; i >= 0; i--) if (!hits[i].id) hits.splice(i, 1);
  }

  // ------------------------------------------------------------------ 5. nodes
  buildLifecycleNodes(); // states must exist before their mentions are attached
  const firstMention = new Map<string, { doc: MdDoc; line: MdLine }>();
  const classPkgEdge = new Map<string, { pkg: string; doc: MdDoc; line: MdLine; how: string; via: string }[]>();
  const rootPkgEdge: { root: string; pkg: string; doc: MdDoc; line: MdLine }[] = [];
  for (const { doc, line, hits } of scanned) {
    for (const h of hits) {
      if (h.type === 'doc') {
        markLine(doc, line.n, h.id);
        continue;
      }
      const meta: Record<string, string> = {};
      if (h.via) meta.via = h.via;
      if (h.inferred) meta.inference = h.inferred;
      const p = prov(doc, line, 'mention', undefined, meta);
      const n = ensureNode(h, p, doc, line);
      if (!n) continue;
      markLine(doc, line.n, h.id);
      if (!firstMention.has(h.id)) firstMention.set(h.id, { doc, line });
      // class → package (and root → package) from the identifier itself
      const pkg = h.props?.paquet as string | undefined;
      if (pkg && CODE_TYPES.has(h.type) && h.type !== 'package') {
        const arr = classPkgEdge.get(h.id) ?? [];
        if (!arr.some((x) => x.pkg === pkg)) arr.push({ pkg, doc, line, how: h.inferred ?? '', via: h.ref?.path ?? h.text });
        classPkgEdge.set(h.id, arr);
      }
      const root = h.ref?.root ? rootIdOf(h.ref.root) : undefined;
      const rpkg = h.type === 'package' ? h.id.slice(4) : pkg;
      if (root && rpkg && h.ref?.pkg) rootPkgEdge.push({ root, pkg: rpkg, doc, line });
    }
  }

  function ensureNode(h: Hit, p: Provenance, doc: MdDoc, line: MdLine) {
    const props: Record<string, PropValue> = { ...(h.props ?? {}) };
    delete props.parent;
    switch (h.type) {
      case 'page':
      case 'service':
      case 'class': {
        const r = h.ref!;
        const n = b.upsertNode(h.id, { type: h.type, label: r.simple!, subtype: entityNames.has(r.simple!) || (props.paquet && String(props.paquet).endsWith('.entity')) ? 'entité JPA' : h.subtype, aliases: [r.simple!, `${r.simple}.java`] }, p);
        if (props.paquet && !n.props.paquet) n.props.paquet = props.paquet;
        if (props.paquetsPossibles) n.props.paquetsPossibles = props.paquetsPossibles;
        if (r.path && (r.path.includes('/') || r.path.endsWith('.java'))) addListProp(n.props, 'fichier', r.path);
        if (r.lines) addListProp(n.props, 'lignes', `${r.lines} (${doc.id}:${line.n})`);
        if (r.method) addListProp(n.props, 'methodes', r.method);
        if (r.path && r.path.includes('/')) n.aliases = [...new Set([...n.aliases, r.path])];
        return n;
      }
      case 'package': {
        const full = h.id.slice(4);
        const n = b.upsertNode(h.id, { type: 'package', label: full, aliases: [full, ...(h.aliases ?? [])] }, h.inferred && !h.ref?.pkg ? { ...p, confidence: 'H', confidenceFrom: 'fallback', metadata: { ...p.metadata, inference: h.inferred } } : p);
        if (h.aliases) n.aliases = [...new Set([...n.aliases, ...h.aliases])];
        if (props.prefixeDe && !n.props.prefixeDe) n.props.prefixeDe = props.prefixeDe;
        return n;
      }
      case 'table':
      case 'view': {
        const name = h.label!;
        const prefix = name.split('_')[0];
        const dom = tablePrefix.get(prefix);
        const n = b.upsertNode(h.id, { type: h.type, label: name, subtype: name.endsWith('*') ? 'famille de tables' : h.type === 'view' ? 'vue' : 'table', aliases: [name], props: { prefixe: prefix, ...(dom ? { domaine: dom.domain } : {}) } }, p);
        if (h.column) addListProp(n.props, 'colonnesCitees', h.column);
        return n;
      }
      case 'migration':
        return b.upsertNode(h.id, { type: 'migration', label: h.label!, subtype: h.subtype, aliases: h.aliases }, p);
      case 'endpoint': {
        const path = h.label!;
        const sub = path.startsWith('/rest') || path.startsWith('/api') ? 'REST' : path.startsWith('/app') ? 'Wicket' : /\.jsp/.test(path) || path.startsWith('/login') ? 'JSP' : 'servlet / autre';
        return b.upsertNode(h.id, { type: 'endpoint', label: path, subtype: sub, aliases: [path, ...(h.aliases ?? [])] }, p);
      }
      case 'config':
      case 'licence':
      case 'file':
      case 'resource':
        return b.upsertNode(h.id, { type: h.type, label: h.label!, subtype: h.subtype, aliases: h.aliases }, p);
      case 'rule':
        return b.upsertNode(h.id, { type: 'rule', label: h.label!, subtype: h.subtype, aliases: h.aliases }, p);
      case 'object': {
        const code = h.id.slice(4);
        const o = objects.get(code)!;
        return b.upsertNode(h.id, { type: 'object', label: code, description: `Objet « ${o.label} » du moteur LIA`, aliases: [code], props: { objet: o.label } }, p);
      }
      case 'actCode': {
        const code = h.id.slice(4);
        const a = actCodes.get(code);
        return b.upsertNode(h.id, { type: 'actCode', label: code, subtype: a?.family, aliases: [code], props: a ? { famille: a.family } : {} }, p);
      }
      case 'sourceRoot': {
        const key = h.id.slice(5);
        const r = roots.get(key);
        return b.upsertNode(h.id, { type: 'sourceRoot', label: r?.label ?? key, aliases: [key, key.split('/')[0]], props: r ? { role: r.role, build: r.build } : {} }, p);
      }
      case 'state':
        return b.has(h.id) ? b.upsertNode(h.id, { type: 'state', label: b.get(h.id)!.label }, p) : null;
      case 'project':
        return b.upsertNode(h.id, { type: 'project', label: cfg.projectLabel, aliases: [cfg.projectLabel] }, p);
      case 'system':
      case 'tech': {
        const d = dictEntries.get(h.id)!;
        const n = b.upsertNode(h.id, { type: d.type, label: d.entry.label, subtype: d.entry.category, aliases: d.entry.aliases, props: { categorie: d.entry.category } }, p);
        if (props.version) addListProp(n.props, 'versionsCitees', String(props.version));
        return n;
      }
      case 'brick': {
        const name = [...bricks.keys()].find((k) => `brick:${slugify(k)}` === h.id)!;
        return b.upsertNode(h.id, { type: 'brick', label: name, description: bricks.get(name)!.role, aliases: [name] }, p);
      }
      default:
        return null;
    }
  }

  // ------------------------------------------------------------------ 6. relations from lines
  const edge = (source: string, target: string, rel: Relation, p: Provenance, label?: string) => (b.has(source) && b.has(target) ? b.addEdge(source, target, rel, p, label) : null);
  const special = new Set<string>(); // "docId:line" rows handled by a dedicated parser
  const inventorySections: SectionRef[] = (cfg.docs.tableInventory?.headings ?? []).map((heading) => ({ file: cfg.docs.tableInventory!.file, heading }));
  const specialSections: SectionRef[] = [cfg.docs.entities, ...inventorySections, cfg.docs.restTable,cfg.docs.objects, cfg.docs.actCodes, cfg.docs.tablePrefixes, cfg.docs.resourcePrefixes, ...cfg.docs.conventions, ...lifecycles.defs];
  for (const d of docs) for (const l of d.lines) {
    if (d.file.startsWith(cfg.docs.glossary.file) || d.file.startsWith(cfg.docs.issues.file)) special.add(`${d.id}:${l.n}`);
    else if (l.kind === 'table-row' && specialSections.some((r) => sectionMatch(d, r) && inSection(l, new RegExp(r.heading)))) special.add(`${d.id}:${l.n}`);
  }

  type Pair = { s: string; t: string; rel: Relation; cue?: string } | null;
  /** Relation between two entities of the same clause / row / arrow. `between`: text between them (spans masked). */
  function pairRelation(a: Hit, c: Hit, between: string, ctx: { header?: string[]; row?: boolean } = {}): Pair {
    if (a.id === c.id || a.type === 'doc' || c.type === 'doc' || a.type === 'state' || c.type === 'state' || a.inTag || c.inTag) return null;
    // « `/rest/*` n'est pas couvert par `SecurityFilter` »: a negated statement is not a relation
    if (NEGATION.test(between)) return null;
    const code = (h: Hit) => CODE_TYPES.has(h.type);
    const isClassLike = (h: Hit) => h.type === 'class' || h.type === 'page' || h.type === 'service';
    for (const [x, y] of [[a, c], [c, a]] as [Hit, Hit][]) {
      const fwd = x === a;
      if (code(x) && code(y) && fwd) {
        if (x.type === 'package' && isClassLike(y) && ctx.row && /Paquet/i.test(ctx.header?.[x.cell] ?? '')) return { s: x.id, t: y.id, rel: 'contains', cue: 'colonne Paquet' };
        if (isClassLike(x) && y.type === 'package' && ctx.row && /Emplacement/i.test(ctx.header?.[y.cell] ?? '')) return { s: y.id, t: x.id, rel: 'contains', cue: 'colonne Emplacement' };
        const m = between.match(CALL_CUE);
        if (m && isClassLike(x) && isClassLike(y)) return PASSIVE_CUE.test(between) ? { s: y.id, t: x.id, rel: 'calls', cue: between.match(PASSIVE_CUE)![0] } : { s: x.id, t: y.id, rel: 'calls', cue: m[0] };
        return null;
      }
      if (code(x) && (y.type === 'table' || y.type === 'view')) {
        const mc = between.match(CREATE_CUE);
        if (mc) return { s: x.id, t: y.id, rel: 'creates', cue: mc[0] };
        const mw = between.match(WRITE_CUE);
        if (mw) return { s: x.id, t: y.id, rel: 'writes', cue: mw[0] };
        const mr = between.match(READ_CUE);
        if (mr) return { s: x.id, t: y.id, rel: 'reads', cue: mr[0] };
        if (isClassLike(x) && (entityNames.has(x.label ?? '') || String(x.props?.paquet ?? '').endsWith('.entity')) && (/\btable\b/i.test(between) || ctx.row)) return { s: x.id, t: y.id, rel: 'maps-to', cue: 'entité ↔ table' };
        return { s: x.id, t: y.id, rel: 'uses' };
      }
      if (x.type === 'object' && y.type === 'table') return { s: x.id, t: y.id, rel: 'maps-to' };
      if (x.type === 'migration' && (y.type === 'table' || y.type === 'view')) return { s: x.id, t: y.id, rel: 'creates', cue: between.match(CREATE_CUE)?.[0] ?? '' };
      if (code(x) && y.type === 'system') return { s: x.id, t: y.id, rel: 'calls' };
      if (code(x) && y.type === 'endpoint') {
        const sub = x.subtype ?? '';
        if (/filtre/.test(sub)) return ctx.row && !/Portée/i.test(ctx.header?.[y.cell] ?? '') ? { s: x.id, t: y.id, rel: 'uses' } : { s: x.id, t: y.id, rel: 'applies-to', cue: 'portée du filtre' };
        if (/ressource REST|servlet/.test(sub) || x.type === 'page') return { s: x.id, t: y.id, rel: 'exposes' };
        return { s: x.id, t: y.id, rel: 'uses' };
      }
      if (y.type === 'config' && x.type !== 'config' && (code(x) || x.type === 'system' || x.type === 'tech')) return { s: y.id, t: x.id, rel: 'configures' };
      if (code(x) && (y.type === 'tech' || y.type === 'file' || y.type === 'resource' || y.type === 'actCode')) return { s: x.id, t: y.id, rel: 'uses' };
      if (x.type === 'brick' && y.type === 'licence') return { s: x.id, t: y.id, rel: 'licensed-by' };
      if (x.type === 'brick' && y.type === 'resource') return { s: x.id, t: y.id, rel: 'uses' };
    }
    return null;
  }

  for (const { doc, line, hits } of scanned) {
    const key = `${doc.id}:${line.n}`;
    const rel = hits.filter((h) => h.type !== 'doc' && b.has(h.id));
    if (rel.length < 2) continue;
    const spans = backtickSpans(line.raw);
    const masked = maskSpans(line.raw, spans);
    const depth = parenDepth(line.raw, spans);
    const header = tableHeader(doc, line);
    const between = (x: Hit, y: Hit) => (x.end <= y.start ? masked.slice(x.end, y.start) : masked.slice(y.end, x.start));
    const mk = (p: NonNullable<Pair>, method: string) => edge(p.s, p.t, p.rel, prov(doc, line, method, undefined, p.cue ? { cue: p.cue } : undefined));
    const isSpecial = special.has(key);

    // units: table cells or the whole line; clauses split on ';' and sentence ends at depth 0
    const units: { start: number; end: number }[] = [];
    if (line.kind === 'table-row' && line.cells && line.cellOffsets) line.cells.forEach((c, i) => units.push({ start: line.cellOffsets![i], end: line.cellOffsets![i] + c.length }));
    else units.push({ start: 0, end: line.raw.length });
    for (const u of units) {
      const cuts = [u.start];
      for (let i = u.start; i < u.end; i++) if (depth[i] === 0 && (masked[i] === ';' || (masked[i] === '.' && masked[i + 1] === ' ' && /[A-ZÀ-Ý]/.test(masked[i + 2] ?? '')))) cuts.push(i + 1);
      cuts.push(u.end);
      for (let k = 0; k < cuts.length - 1; k++) {
        const ch = rel.filter((h) => h.start >= cuts[k] && h.start < cuts[k + 1]);
        if (ch.length < 2) continue;
        const arrows: number[] = [];
        for (let i = cuts[k]; i < cuts[k + 1]; i++) if (masked[i] === '→' || masked[i] === '►') arrows.push(i);
        if (arrows.length) {
          // arrow chain: consecutive segments
          const bounds = [cuts[k], ...arrows, cuts[k + 1]];
          const segs = bounds.slice(0, -1).map((s, i) => ch.filter((h) => h.start >= s && h.start < bounds[i + 1] && !h.inTag));
          const lastGroup = (hs: Hit[]) => (hs.length ? hs.filter((h) => h.group === hs[hs.length - 1].group) : []);
          const firstGroup = (hs: Hit[]) => (hs.length ? hs.filter((h) => h.group === hs[0].group) : []);
          for (let s = 0; s < segs.length - 1; s++) {
            for (const x of lastGroup(segs[s])) for (const y of firstGroup(segs[s + 1])) {
              if (CODE_TYPES.has(x.type) && CODE_TYPES.has(y.type) && x.type !== 'package' && y.type !== 'package') {
                edge(x.id, y.id, 'sequence', prov(doc, line, 'arrow-chain'));
                continue;
              }
              const p = pairRelation(x, y, '→');
              if (p) mk(p, 'arrow-chain');
            }
          }
          continue;
        }
        if (isSpecial) continue;
        // same clause: each target attaches to the nearest preceding subject (else the next one)
        const subjects = ch.filter((h) => SUBJECT_TYPES.has(h.type));
        for (const e of ch) {
          if (SUBJECT_TYPES.has(e.type) && !CODE_TYPES.has(e.type)) continue;
          const prev = subjects.filter((s) => s.start < e.start && s.depth <= e.depth && s !== e && s.group !== e.group);
          // code ↔ code is read in text order only (« A planifie B »), never backwards
          const host = prev.length ? prev[prev.length - 1] : CODE_TYPES.has(e.type) ? undefined : subjects.find((s) => s.start > e.start);
          if (!host || host === e) continue;
          let hosts = subjects.filter((s) => s.group === host.group);
          // a path « dbupdate/maj99/maj0001.sql » names one script: its folders are not parties of the clause
          if (host.type === 'migration') hosts = [hosts[hosts.length - 1]];
          for (const h of hosts) {
            const p = pairRelation(h, e, between(h, e));
            if (p) mk(p, prev.length ? 'same-clause' : 'same-clause:leading');
          }
        }
      }
    }
    // table rows: subject cell ↔ other cells
    if (line.kind === 'table-row' && line.cells && !isSpecial) {
      const byCell = line.cells.map((_, i) => rel.filter((h) => h.cell === i));
      const subjIdx = byCell.findIndex((x) => x.length > 0);
      if (subjIdx >= 0) {
        const subj = byCell[subjIdx].filter((h) => h.depth === 0 || byCell[subjIdx].every((x) => x.depth > 0));
        for (const other of byCell.slice(subjIdx + 1).flat()) for (const s of subj) {
          const p = pairRelation(s, other, '', { header, row: true });
          if (p) mk(p, 'table-row');
        }
      }
    }
  }

  // ------------------------------------------------------------------ 7. structural nodes and relations
  const hitsAt = new Map<string, Hit[]>();
  for (const s of scanned) hitsAt.set(`${s.doc.id}:${s.line.n}`, s.hits.filter((h) => b.has(h.id)));
  const lineHits = (doc: MdDoc, line: MdLine) => hitsAt.get(`${doc.id}:${line.n}`) ?? [];

  // class → package, root → package (from the identifiers)
  for (const [cid, arr] of classPkgEdge) for (const x of arr) {
    if (!b.has(`pkg:${x.pkg}`)) b.upsertNode(`pkg:${x.pkg}`, { type: 'package', label: x.pkg, aliases: [x.pkg] }, prov(x.doc, x.line, 'mention', x.how ? H : undefined, x.how ? { inference: x.how, via: x.via } : { via: x.via }));
    edge(`pkg:${x.pkg}`, cid, 'contains', prov(x.doc, x.line, x.how ? 'path:package-inferred' : 'path:package', x.how ? H : undefined, x.how ? { inference: x.how } : undefined));
  }
  for (const x of rootPkgEdge) if (b.has(x.root)) edge(x.root, `pkg:${x.pkg}`, 'contains', prov(x.doc, x.line, 'path:root'));
  // root named in the section heading (03 §4 « `lia-core` — socle ») contains the packages of that section
  for (const { doc, line, hits } of scanned) {
    if (line.kind !== 'table-row') continue;
    for (const h of [...line.headingPath].reverse()) {
      const r = spansIn(h).map((s) => rootIdOf(s)).find(Boolean);
      if (!r || !b.has(r)) continue;
      for (const p of hits) if (p.type === 'package' && b.has(p.id)) edge(r, p.id, 'contains', prov(doc, line, 'section-heading-root'));
      break;
    }
  }
  // package nesting: nearest existing ancestor
  const pkgIds = [...b.nodes.values()].filter((n) => n.type === 'package').map((n) => n.id.slice(4));
  for (const p of pkgIds) {
    const parts = p.split('.');
    for (let i = parts.length - 1; i >= 2; i--) {
      const anc = parts.slice(0, i).join('.');
      if (pkgIds.includes(anc)) {
        const fm = firstMention.get(`pkg:${p}`) ?? (() => { const pv = b.get(`pkg:${p}`)!.provenance[0]; const d = docs.find((x) => pv.file.endsWith(x.file))!; return { doc: d, line: d.lines[pv.line! - 1] }; })();
        edge(`pkg:${anc}`, `pkg:${p}`, 'contains', prov(fm.doc, fm.line, 'structure:package-parent'));
        break;
      }
    }
  }

  // project (00 §1)
  const projectId = `project:${slugify(cfg.projectLabel)}`;
  {
    const d = docByPrefix(cfg.docs.project.file);
    if (d) {
      const rows = rowsOf(d, cfg.docs.project.heading);
      const nameRow = rows.find((l) => /^Nom$/.test(plain(l.cells![0])));
      if (nameRow) {
        const props: Record<string, string> = {};
        for (const r of rows) if (r !== nameRow) props[slugify(plain(r.cells![0])).replace(/-/g, '_')] = plain(r.cells![1] ?? '');
        b.upsertNode(projectId, { type: 'project', label: plain(nameRow.cells![1]), aliases: [cfg.projectLabel], description: props.objet, props }, prov(d, nameRow, 'project-identity'));
        markLine(d, nameRow.n, projectId);
      }
    }
  }
  // source roots (03 §1, 02 §2) even when never mentioned elsewhere
  for (const [key, r] of roots) {
    const id = `root:${key}`;
    b.upsertNode(id, { type: 'sourceRoot', label: r.label, aliases: [key], props: { role: r.role, build: r.build } }, prov(r.doc, r.line, 'source-root-table'));
    markLine(r.doc, r.line.n, id);
    if (b.has(projectId)) edge(projectId, id, 'contains', prov(r.doc, r.line, 'source-root-table'));
  }

  // modules (04 level-3 headings of parts A and B)
  {
    const d = docByPrefix(cfg.docs.modules.file);
    if (d) for (const sec of d.sections) {
      if (sec.level !== 3) continue;
      const hl = d.lines[sec.startLine - 1];
      const part = cfg.docs.modules.parts.find((p) => inSection(hl, new RegExp(p)));
      if (!part) continue;
      const partTitle = hl.headingPath.find((h) => new RegExp(part).test(h)) ?? '';
      const name = plain(sec.title.split(' — ')[0]);
      const id = `module:${slugify(name)}`;
      const body = d.lines.filter((l) => l.n > sec.startLine && l.n <= sec.endLine);
      const role = body.find((l) => /\*\*Rôle\*\*/.test(l.raw));
      b.upsertNode(id, { type: 'module', label: name, subtype: plain(partTitle.split(' — ')[1] ?? partTitle), aliases: [name], description: role ? plain(role.raw).replace(/^Rôle\s*:\s*/, '') : body.filter((l) => l.kind === 'list').map((l) => plain(l.raw)).slice(0, 1).join(' '), props: { domaine: plain(partTitle.split(' — ')[1] ?? partTitle) } }, prov(d, hl, 'module-heading'));
      markLine(d, hl.n, id);
      if (b.has(projectId)) edge(projectId, id, 'contains', prov(d, hl, 'module-heading'));
      for (const h of lineHits(d, hl)) if (h.type === 'package') edge(id, h.id, 'contains', prov(d, hl, 'module-heading'));
      for (const l of body) for (const h of lineHits(d, l)) {
        if (!['page', 'service', 'class', 'table', 'view', 'package'].includes(h.type)) continue;
        edge(id, h.id, 'contains', prov(d, l, 'module-section'));
        const n = b.get(h.id)!;
        if (!n.module) n.module = id;
      }
    }
  }

  // bricks (01 §2) and licences
  for (const [name, x] of bricks) {
    const id = `brick:${slugify(name)}`;
    b.upsertNode(id, { type: 'brick', label: name, description: x.role, aliases: [name], props: { role: x.role } }, prov(x.doc, x.line, 'brick-table'));
    markLine(x.doc, x.line.n, id);
    for (const h of lineHits(x.doc, x.line)) {
      if (h.type === 'licence') edge(id, h.id, 'licensed-by', prov(x.doc, x.line, 'brick-table'));
      else if (h.type === 'resource') edge(id, h.id, 'uses', prov(x.doc, x.line, 'brick-table'));
    }
  }
  for (const [name, x] of licences) if (!b.has(`lic:${name}`)) b.upsertNode(`lic:${name}`, { type: 'licence', label: name, aliases: [name] }, prov(x.doc, x.line, 'licence-list'));

  // act codes (04): every code of the families table, then the family wildcard
  for (const [code, x] of actCodes) {
    const id = `act:${code}`;
    b.upsertNode(id, { type: 'actCode', label: code, subtype: x.family, aliases: [code], props: { famille: x.family } }, prov(x.doc, x.line, 'act-family-table'));
    markLine(x.doc, x.line.n, id);
  }

  // engine objects (11 §1) → tables
  for (const [code, o] of objects) {
    const id = `obj:${code}`;
    b.upsertNode(id, { type: 'object', label: code, description: `Objet « ${o.label} » du moteur LIA`, aliases: [code], props: { objet: o.label } }, prov(o.doc, o.line, 'object-table'));
    markLine(o.doc, o.line.n, id);
    if (o.table && b.has(`tbl:${o.table}`)) edge(id, `tbl:${o.table}`, 'maps-to', prov(o.doc, o.line, 'object-table'));
  }

  // entities (05 §3.2): entity cell ↔ table cell (pair by index)
  {
    const d = docByPrefix(cfg.docs.entities.file);
    if (d) for (const l of rowsOf(d, cfg.docs.entities.heading)) {
      const hs = lineHits(d, l);
      const ents = hs.filter((h) => h.cell === 0 && (h.type === 'class' || h.type === 'service' || h.type === 'page'));
      const tbls = hs.filter((h) => h.cell === 1 && h.type === 'table');
      ents.forEach((e, i) => {
        const targets = ents.length === tbls.length ? [tbls[i]] : tbls;
        for (const t of targets) edge(e.id, t.id, 'maps-to', prov(d, l, 'entity-table'));
        const n = b.get(e.id);
        if (n) n.subtype = 'entité JPA';
      });
    }
  }

  // full inventory (05 §3.5) and view bindings (05 §3.3): one row = one table or view, columns read by header name
  //   « Entité JPA | Table | Objet moteur LIA | Créée par »   → entity maps-to, objects maps-to, script creates
  //   « Vue | Entité JPA | Objet moteur LIA »                → same for views
  //   « Table supprimée | Script de suppression | Objet … »  → table node with statut « supprimée », script drops
  //   « Noms cités sans script de création » paragraph       → name node with statut « jamais créée »
  const inv = cfg.docs.tableInventory;
  const inventoried = new Set<string>();
  if (inv) {
    const d = docByPrefix(inv.file);
    if (d) {
      const intro = inv.introPattern ? d.lines.find((l) => new RegExp(inv.introPattern!).test(l.raw)) : undefined;
      const introTag = intro?.raw.match(/\[([VH])(?![A-Za-zÀ-ÿ])[^\]]*\]/);
      const introSection = intro?.headingPath[intro.headingPath.length - 1];
      const ip = (l: MdLine, method: string): Provenance => {
        const p = prov(d, l, method);
        // rows carry no tag: the intro line of the inventory (« Relevé … [V] : ») qualifies them
        if (p.confidenceFrom === 'fallback' && introTag && intro && introSection && l.n > intro.n && l.headingPath.includes(introSection)) {
          p.confidence = introTag[1] as Confidence;
          p.confidenceFrom = 'section';
          p.metadata = { ...p.metadata, tag: `${introTag[0]} (${d.id}:${intro.n})` };
        }
        return p;
      };
      const objectNode = (code: string, p: Provenance) => {
        const known = objects.get(code);
        return b.upsertNode(`obj:${code}`, { type: 'object', label: code, subtype: known ? undefined : 'objet du dictionnaire dd_lia', description: known ? `Objet « ${known.label} » du moteur LIA` : 'Objet du dictionnaire dd_lia.xml du moteur LIA (tableStockage)', aliases: [code], props: known ? { objet: known.label } : {} }, p);
      };
      const objectCodes = (cell: string | undefined) => plain(cell ?? '').split(/,\s*/).map((x) => x.trim()).filter((x) => x && x !== '—' && /^[A-Za-z][\w]*$/.test(x));
      for (const heading of inv.headings) for (const l of rowsOf(d, heading)) {
        const hdr = (tableHeader(d, l) ?? []).map((h) => plain(h));
        const col = (re: RegExp) => hdr.findIndex((h) => re.test(h));
        const ti = col(/^(?:Table|Vue)$/), ei = col(/^Entité JPA$/), oi = col(/^Objet moteur/), ci = col(/^Créée par$/), di = col(/^Table supprimée$/), si = col(/^Script de suppression$/);
        const cells = l.cells!;
        const hs = lineHits(d, l);
        const sub = l.headingPath[l.headingPath.length - 1] ?? '';
        if (ti >= 0 && ei >= 0) {
          const name = spansIn(cells[ti] ?? '')[0];
          if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
          const isView = /^Vue$/.test(hdr[ti]);
          const id = `${isView ? 'view' : 'tbl'}:${name}`;
          const p = ip(l, 'table-inventory');
          // « PRJ — Projet (préparation de la consultation) (40) » / « Tables sans préfixe (2) »
          const hm = plain(sub).match(/^([A-Z0-9]+)\s+—\s+(.+?)\s+\(\d+\)$/);
          const prefix = isView ? name.split('_')[0] : hm ? hm[1] : '—';
          const domain = isView ? tablePrefix.get(prefix)?.domain ?? 'Vues' : hm ? hm[2] : plain(sub).replace(/\s*\(\d+\)$/, '');
          const n = b.upsertNode(id, { type: isView ? 'view' : 'table', label: name, subtype: isView ? 'vue' : 'table', aliases: [name] }, p);
          n.props.prefixe = prefix;
          n.props.domaine = domain;
          n.props.statut = 'en place';
          markLine(d, l.n, id);
          const entText = plain(cells[ei] ?? '');
          const ents = hs.filter((h) => h.cell === ei && (h.type === 'class' || h.type === 'service' || h.type === 'page'));
          for (const e of ents) {
            edge(e.id, id, 'maps-to', p);
            const en = b.get(e.id)!;
            en.subtype = 'entité JPA';
            const pk = hs.find((h) => h.cell === ei && h.type === 'package');
            if (pk && !en.props.paquet) {
              en.props.paquet = pk.id.slice(4);
              edge(pk.id, e.id, 'contains', p);
            }
          }
          if (entText && entText !== '—') {
            n.props.entiteJPA = entText;
            if (!ents.length) unmapped.set(`inv:${entText}`, { item: entText, reason: 'Entité JPA de l’inventaire non reconnue comme classe', where: `${d.file}:${l.n}` });
          }
          const codes = objectCodes(cells[oi]);
          for (const c of codes) {
            objectNode(c, p);
            markLine(d, l.n, `obj:${c}`);
            edge(`obj:${c}`, id, 'maps-to', p);
          }
          if (codes.length) n.props.objetsMoteur = codes.join(' · ');
          n.props.rattachement = ents.length || (entText && entText !== '—') ? (codes.length ? 'entité JPA et objet du moteur' : 'entité JPA seulement') : codes.length ? 'objet du moteur seulement' : 'ni entité ni objet';
          if (ci >= 0) {
            n.props.creeePar = plain(cells[ci] ?? '');
            const migs = hs.filter((h) => h.cell === ci && h.type === 'migration');
            const script = migs[migs.length - 1];
            if (script) edge(script.id, id, 'creates', p);
          }
          inventoried.add(id);
        } else if (di >= 0) {
          const name = plain(cells[di] ?? '');
          if (!/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
          const id = `tbl:${name}`;
          const p = ip(l, 'table-inventory:dropped');
          const n = b.upsertNode(id, { type: 'table', label: name, subtype: 'table supprimée', aliases: [name] }, p);
          n.subtype = 'table supprimée';
          n.props.prefixe = name.split('_')[0];
          n.props.statut = 'supprimée';
          markLine(d, l.n, id);
          if (si >= 0) {
            n.props.supprimeePar = plain(cells[si] ?? '');
            const migs = hs.filter((h) => h.cell === si && h.type === 'migration');
            const script = migs[migs.length - 1];
            if (script) edge(script.id, id, 'drops', p);
          }
          const codes = objectCodes(cells[oi]);
          for (const c of codes) {
            objectNode(c, p);
            markLine(d, l.n, `obj:${c}`);
            edge(`obj:${c}`, id, 'maps-to', p, 'table supprimée');
          }
          if (codes.length) n.props.objetsMoteur = codes.join(' · ');
          inventoried.add(id);
        }
      }
      // « ADC_CODEPROG (objet cprg), EDM_MSGEMIS (fmse) … figurent dans dd_lia.xml mais aucun script ne les crée »
      for (const l of sectionLines(d, inv.noScriptHeading)) {
        if (l.kind !== 'para') continue;
        for (const m of l.raw.matchAll(/(?<![A-Za-z0-9_.])([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)?)\s+\((?:objet\s+)?([A-Za-z]\w*)\)/g)) {
          const id = `tbl:${m[1]}`;
          const p = prov(d, l, 'table-inventory:no-script');
          const n = b.upsertNode(id, { type: 'table', label: m[1], subtype: 'nom sans script de création', aliases: [m[1]] }, p);
          n.props.prefixe = m[1].split(/[_.]/)[0];
          n.props.statut = 'jamais créée';
          markLine(d, l.n, id);
          objectNode(m[2], p);
          markLine(d, l.n, `obj:${m[2]}`);
          edge(`obj:${m[2]}`, id, 'maps-to', p, 'aucun script de création');
          n.props.objetsMoteur = m[2];
          inventoried.add(id);
        }
      }
    }
  }

  // REST resources (06 §5.2): class(es) ↔ endpoint(s)
  {
    const d = docByPrefix(cfg.docs.restTable.file);
    if (d) {
      let prefix = '/rest/api/{version}/';
      let prefixLine: MdLine | undefined;
      for (const l of d.lines) {
        const m = l.raw.match(new RegExp(cfg.docs.restTable.prefixPattern));
        if (m) {
          prefix = m[1].endsWith('/') ? m[1] : m[1] + '/';
          prefixLine = l;
          break;
        }
      }
      for (const l of rowsOf(d, cfg.docs.restTable.heading)) {
        const classes = lineHits(d, l).filter((h) => h.cell === 0 && CODE_TYPES.has(h.type));
        const cellOff = l.cellOffsets![1];
        const cell = l.cells![1] ?? '';
        const depth = parenDepth(cell, backtickSpans(cell));
        const primaries: { path: string; subs: string[]; resources: string[] }[] = [];
        for (const sp of backtickSpans(cell)) {
          if (depth[sp.start] > 0) {
            primaries[primaries.length - 1]?.resources.push(sp.text);
            continue;
          }
          if (sp.text.startsWith('/') && primaries.length) primaries[primaries.length - 1].subs.push(sp.text);
          else primaries.push({ path: sp.text, subs: [], resources: [] });
        }
        const methods = plain(l.cells![2] ?? '');
        const eps = primaries.map((p) => {
          const full = prefix + p.path;
          const id = `ep:${full}`;
          const n = b.upsertNode(id, { type: 'endpoint', label: full, subtype: 'REST', aliases: [full, p.path], props: { methodes: methods.replace(/\s*\(.*\)$/, '') } }, prov(d, l, 'rest-table', undefined, { prefixe: prefixLine ? `${prefix} (${d.id}:${prefixLine.n})` : prefix, colonne: String(cellOff) }));
          if (p.subs.length) n.props.sousChemins = p.subs.join(' · ');
          if (p.resources.length) n.props.sousRessources = p.resources.join(' · ');
          if (/\(/.test(methods)) n.props.authentification = methods.match(/\((.*)\)/)?.[1] ?? '';
          markLine(d, l.n, id);
          return id;
        });
        classes.forEach((c, i) => {
          const targets = classes.length === eps.length ? [eps[i]] : eps;
          for (const t of targets) edge(c.id, t, 'exposes', prov(d, l, 'rest-table'));
        });
      }
    }
  }

  // migrations: folder ← script (path) and folder props (« = version 8.4.0 (plage `6108xxx`) »)
  for (const { doc, line, hits } of scanned) for (const h of hits) {
    if (h.type !== 'migration' || !b.has(h.id)) continue;
    const parent = (h.props?.parent as string) ?? undefined;
    if (parent && b.has(parent)) edge(h.id, parent, 'part-of', prov(doc, line, 'migration-path'));
    if (h.subtype === 'dossier de version') {
      const after = line.raw.slice(h.end);
      const m = after.match(/^\s*=\s*version\s+(\d+\.\d+\.\d+)\s*\(plage\s+`(\d+x+)`\)/);
      if (m) {
        const n = b.get(h.id)!;
        n.props.version = m[1];
        n.props.plageNumver = m[2];
      }
    }
  }
  for (const n of b.nodes.values()) if (n.type === 'migration' && n.id !== 'mig:dbupdate' && n.id !== 'mig:dbupdate.xml' && b.has('mig:dbupdate') && !['script', 'tâche Java'].includes(n.subtype ?? '')) {
    const fm = firstMention.get(n.id);
    if (fm && /dbupdate\//.test(fm.line.raw)) edge(n.id, 'mig:dbupdate', 'part-of', prov(fm.doc, fm.line, 'migration-path'));
  }

  // single datasource (05:10): every table and view lives in the JNDI datasource
  {
    const d = docByPrefix(cfg.docs.singleDatasource.file);
    const l = d?.lines.find((x) => new RegExp(cfg.docs.singleDatasource.pattern).test(x.raw));
    if (d && l && b.has('sys:db')) for (const n of b.nodes.values()) if ((n.type === 'table' || n.type === 'view') && (n.props.statut === undefined || n.props.statut === 'en place')) edge(n.id, 'sys:db', 'part-of', prov(d, l, 'single-datasource', undefined, { note: 'la doc déclare une seule source de données JNDI' }));
  }

  // endpoint hierarchy: /app/guest/* is part of /app/*
  {
    const eps = [...b.nodes.values()].filter((n) => n.type === 'endpoint');
    for (const e of eps) {
      const parents = eps.filter((p) => p !== e && p.label.endsWith('/*') && e.label.startsWith(p.label.slice(0, -1)) && e.label !== p.label);
      if (!parents.length) continue;
      const parent = parents.sort((x, y) => y.label.length - x.label.length)[0];
      const pv = e.provenance[0];
      const d = docs.find((x) => pv.file.endsWith(x.file))!;
      edge(e.id, parent.id, 'part-of', prov(d, d.lines[pv.line! - 1], 'structure:url-prefix'));
    }
  }

  // tech table (02 §1): layer of each technology
  {
    const d = docByPrefix(cfg.docs.techTable.file);
    if (d) for (const l of rowsOf(d, cfg.docs.techTable.heading)) for (const h of lineHits(d, l)) if (h.type === 'tech' && h.cell === 1) {
      const n = b.get(h.id)!;
      if (!n.props.couche) n.props.couche = plain(l.cells![0]);
    }
  }

  // workflows
  for (const wf of cfg.docs.workflows) parseWorkflow(wf);

  // lifecycles: transitions and setters
  buildLifecycleEdges();

  // rules (01 §6, 07 §4 « Règles notables »)
  for (const r of cfg.docs.rules) {
    const d = docByPrefix(r.file);
    if (!d) continue;
    let i = 0;
    for (const l of sectionLines(d, r.heading)) {
      if (l.kind !== 'list' || l.ordinal || /^\s{2,}/.test(l.raw)) continue;
      const id = `rule:${d.id}-${++i}`;
      const text = clean(l.raw);
      const bold = l.raw.match(/\*\*(.+?)\*\*/)?.[1];
      const head = text.split(/[:;]/)[0];
      const label = bold ? plain(bold) : head.length > 72 ? head.slice(0, 72).replace(/\s+\S*$/, '') + '…' : head;
      b.upsertNode(id, { type: 'rule', subtype: r.subtype, label, description: text, aliases: [label] }, prov(d, l, 'rule-item'));
      markLine(d, l.n, id);
      for (const h of lineHits(d, l)) if (b.has(h.id)) edge(h.id, id, CODE_TYPES.has(h.type) ? 'implements' : 'mentions', prov(d, l, 'rule-item'));
    }
  }

  // issues (10)
  parseIssues();
  // questions (every « Questions » section)
  parseQuestions();
  // glossary (11)
  parseGlossary();
  // conventions (12, 09)
  parseConventions();

  // ------------------------------------------------------------------ 8. doc nodes + documented-in
  for (const d of docs) {
    const id = `doc:${d.id}`;
    const l1 = d.lines.find((l) => l.kind === 'heading') ?? d.lines[0];
    b.upsertNode(id, { type: 'doc', label: `${d.id} · ${d.title.replace(/^\d+\s*—\s*/, '')}`, props: { fichier: d.file } }, prov(d, l1, 'doc-file', { confidence: 'V', from: 'line' }, { note: 'le fichier existe' }));
    const m = lineNodes.get(d.id);
    if (!m) continue;
    const seen = new Map<string, number>();
    for (const [n, ids] of [...m.entries()].sort((a, c) => a[0] - c[0])) {
      for (const nid of ids) {
        if (nid === id || !b.has(nid) || nid.startsWith('doc:')) continue;
        const count = seen.get(nid) ?? 0;
        if (count >= 3) continue;
        seen.set(nid, count + 1);
        edge(id, nid, 'documented-in', prov(d, d.lines[n - 1], 'mention'));
      }
    }
  }

  // ------------------------------------------------------------------ 9. descriptions
  const priority = ['04', '06', '05', '07', '03', '02', '01', '12', '09', '08', '10', '00', '11'];
  const defines = new Map<string, string>();
  for (const e of b.edges.values()) if (e.relation === 'defines') defines.set(e.target, e.source);
  for (const n of b.nodes.values()) {
    if (n.description) continue;
    const t = defines.get(n.id);
    if (t && b.get(t)?.description) {
      n.description = b.get(t)!.description;
      n.props.glossaire = t;
      continue;
    }
    const dp = n.provenance
      .filter((p) => p.method === 'mention')
      .sort((a, c) => priority.indexOf(a.file.split('/').pop()!.slice(0, 2)) - priority.indexOf(c.file.split('/').pop()!.slice(0, 2)) || (a.line ?? 0) - (c.line ?? 0));
    if (dp[0]?.snippet) n.description = dp[0].snippet;
  }

  // ------------------------------------------------------------------ 10. declared counts
  const declared: DocExtraction['declared'] = [];
  for (const dd of cfg.declared) {
    const d = docByPrefix(dd.file);
    const l = d?.lines.find((x) => new RegExp(dd.pattern).test(x.raw));
    if (!d || !l) continue;
    declared.push({ id: dd.id, label: dd.label, count: Number(l.raw.match(new RegExp(dd.pattern))![1]), type: dd.type, subtype: dd.subtype, complete: dd.complete, provenance: prov(d, l, 'declared-count') });
  }

  // terms searched and absent from the code (11 §7) are reported as unmapped
  {
    const d = docByPrefix(cfg.docs.glossary.file);
    if (d) for (const l of sectionLines(d, cfg.docs.glossary.absentHeading)) {
      if (l.kind !== 'para') continue;
      for (const t of plain(l.raw).replace(/\.$/, '').split(/,\s*/)) if (t) unmapped.set(`absent:${t}`, { item: t, reason: 'Terme recherché et absent du code (11 §7)', where: `${d.file}:${l.n}` });
    }
  }

  return { docs, lineNodes, declared, unmapped: [...unmapped.values()] };

  // ================================================================== helpers (hoisted)
  function addListProp(props: Record<string, PropValue>, key: string, v: string) {
    const prev = String(props[key] ?? '');
    const list = prev ? prev.split(' · ') : [];
    if (!list.includes(v)) list.push(v);
    props[key] = list.join(' · ');
  }

  // ------------------------------------------------------------------ lifecycles
  interface StateDef { code: string; label: string; ordre: number; doc: MdDoc; line: MdLine; generated: boolean }
  interface LcRuntime extends LifecycleDef { states: StateDef[]; transitions: { from: string; to: string; label?: string; doc: MdDoc; line: MdLine }[]; lines: Set<string>; defLines: { doc: MdDoc; line: MdLine }[] }
  function parseLifecycles() {
    const byId = new Map<string, LcRuntime>();
    const defs: LcRuntime[] = [];
    const stripTags = (s: string) => s.replace(/\[[VH][^\]]*\]/g, '').replace(/`/g, '').replace(/\*\*/g, '').trim().replace(/[.;]+$/, '').trim();
    for (const def of cfg.docs.lifecycles) {
      const d = docByPrefix(def.file);
      if (!d) continue;
      let lc = byId.get(def.id);
      if (!lc) {
        lc = { ...def, states: [], transitions: [], lines: new Set(), defLines: [] };
        byId.set(def.id, lc);
        defs.push(lc);
      } else if (def.mention && !lc.mention) lc.mention = def.mention;
      const L = lc;
      const sec = sectionLines(d, def.heading);
      const add = (code: string, label: string, line: MdLine, generated = false) => {
        code = code.trim();
        label = label.trim();
        if (!code) return;
        const ex = L.states.find((s) => s.code === code);
        if (!ex) L.states.push({ code, label, ordre: L.states.length + 1, doc: d, line, generated });
        L.lines.add(`${d.id}:${line.n}`);
      };
      const pick = () => sec.find((l) => (def.linePattern ? new RegExp(def.linePattern).test(l.raw) : l.kind === 'para' && !/^\s*\[/.test(l.raw)));
      if (def.parser === 'table' || def.parser === 'table-pairs') {
        for (const l of sec.filter((x) => x.kind === 'table-row' && !isHeaderRow(d, x) && x.cells)) {
          const step = def.parser === 'table' ? 2 : 2;
          for (let i = 0; i + 1 < l.cells!.length; i += def.parser === 'table' ? l.cells!.length : step) add(stripTags(l.cells![i]), stripTags(l.cells![i + 1]), l);
          L.defLines.push({ doc: d, line: l });
        }
        continue;
      }
      const l = pick();
      if (!l) continue;
      L.defLines.push({ doc: d, line: l });
      const raw = l.raw.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
      if (def.parser === 'inline-dots') {
        for (const part of raw.split('·')) {
          const m = stripTags(part).match(/^(\d+)\s+(.+)$/);
          if (m) add(m[1], m[2], l);
        }
      } else if (def.parser === 'colon-codes') {
        for (const part of stripTags(raw.slice(raw.lastIndexOf(':') + 1)).split(',')) {
          const m = part.trim().match(/^(\d+)\s+(.+)$/);
          if (m) add(m[1], m[2], l);
        }
      } else if (def.parser === 'colon-list') {
        const after = raw.slice(raw.lastIndexOf(':') + 1);
        for (const part of stripTags(after).split(',')) if (part.trim()) add(slugify(part), part, l, true);
      } else if (def.parser === 'paren') {
        for (const m of raw.matchAll(/(?:«\s*([^»]+?)\s*»|([a-zà-ÿ][a-zà-ÿ ]*?))\s*\((\d+)\)/g)) add(m[3], (m[1] ?? m[2] ?? '').trim().replace(/^.*:\s*/, ''), l);
      } else if (def.parser === 'spans') {
        const at = def.linePattern ? raw.search(new RegExp(def.linePattern)) : 0;
        const end = raw.indexOf('[', at);
        for (const sp of backtickSpans(raw.slice(at, end > 0 ? end : undefined))) if (/^[A-Z][A-Z_]+$/.test(sp.text)) add(sp.text, sp.text, l);
      } else if (def.parser === 'arrow') {
        const clause = raw.split('|').flatMap((c) => c.split(';')).find((c) => c.includes('→')) ?? '';
        const items = clause.split('→').map((x) => stripTags(x).replace(/^.*(?:états|Statuts\s*:)\s*/i, '').trim());
        let prev: string | null = null;
        let pending: string | undefined;
        for (const it of items) {
          if (/^[a-z][A-Za-z]+$/.test(it) && /[A-Z]/.test(it)) {
            pending = it; // method name between two states (onValidateActe)
            continue;
          }
          const m = it.match(/^(\d+)\s+(.+)$/);
          const code = m ? m[1] : slugify(it);
          add(code, m ? m[2] : it, l, !m);
          if (prev) L.transitions.push({ from: prev, to: code, label: pending, doc: d, line: l });
          prev = code;
          pending = undefined;
        }
      }
    }
    const stateId = (lcId: string, code: string) => `state:${lcId.slice(3)}/${slugify(code) || code}`;
    return {
      defs,
      stateId,
      find(lcId: string, v: string, byLabel: boolean): string | undefined {
        const lc = byId.get(lcId);
        if (!lc) return undefined;
        const s = lc.states.find((x) => x.code === v) ?? (byLabel ? lc.states.find((x) => x.label.toLowerCase() === v.trim().toLowerCase()) : undefined);
        return s ? stateId(lcId, s.code) : undefined;
      },
    };
  }

  function buildLifecycleNodes() {
    for (const lc of lifecycles.defs) {
      if (!lc.states.length) continue;
      const first = lc.defLines[0];
      const sec = first.line.headingPath[first.line.headingPath.length - 1] ?? '';
      const hl = first.doc.lines.find((l) => l.kind === 'heading' && l.raw.replace(/^#+\s*/, '') === sec) ?? first.line;
      b.upsertNode(lc.id, { type: 'lifecycle', label: lc.label, aliases: [lc.label, plain(sec)], props: { etats: lc.states.length, ...(lc.column ? { colonne: lc.column } : {}), ...(lc.note ? { note: lc.note } : {}) }, description: lc.note }, prov(first.doc, hl, 'lifecycle-heading'));
      markLine(first.doc, hl.n, lc.id);
      for (const x of lc.defLines.slice(1)) {
        const ln = x.line;
        if (ln !== first.line) b.get(lc.id)!.provenance.push(prov(x.doc, ln, 'lifecycle-definition'));
      }
      for (const s of lc.states) {
        const id = lifecycles.stateId(lc.id, s.code);
        const isNum = /^\d+$/.test(s.code) || /^[A-Z]$/.test(s.code);
        const label = isNum ? `${s.code} · ${s.label}` : s.generated ? s.label : s.code;
        b.upsertNode(id, { type: 'state', label, subtype: lc.label, description: s.label, aliases: [...new Set([s.code, s.label])], props: { ...(s.generated ? {} : { code: s.code }), libelle: s.label, ordre: s.ordre, cycle: lc.id } }, prov(s.doc, s.line, 'lifecycle-state'));
        markLine(s.doc, s.line.n, id);
      }
    }
  }

  function buildLifecycleEdges() {
    for (const lc of lifecycles.defs) {
      if (!lc.states.length) continue;
      const first = lc.defLines[0];
      const sec = first.line.headingPath[first.line.headingPath.length - 1] ?? '';
      const hl = first.doc.lines.find((l) => l.kind === 'heading' && l.raw.replace(/^#+\s*/, '') === sec) ?? first.line;
      for (const h of lineHits(first.doc, hl)) if (h.type === 'table' || h.type === 'object') edge(lc.id, h.id, 'uses', prov(first.doc, hl, 'lifecycle-heading'));
      for (const s of lc.states) edge(lifecycles.stateId(lc.id, s.code), lc.id, 'part-of', prov(s.doc, s.line, 'lifecycle-state'));
      for (const t of lc.transitions) edge(lifecycles.stateId(lc.id, t.from), lifecycles.stateId(lc.id, t.to), 'transition', prov(t.doc, t.line, 'lifecycle-arrow', undefined, t.label ? { methode: t.label } : undefined), t.label);
      if (lc.orderInferred) {
        for (let i = 0; i + 1 < lc.states.length; i++) {
          const a = lifecycles.stateId(lc.id, lc.states[i].code);
          const c = lifecycles.stateId(lc.id, lc.states[i + 1].code);
          if (!b.edges.has(`transition:${a}->${c}`)) edge(a, c, 'transition', prov(lc.states[i + 1].doc, lc.states[i + 1].line, 'lifecycle-order:inferred', H, { inference: 'ordre des lignes du tableau / de l’énumération, aucune flèche dans la doc' }));
        }
      }
    }
    // setters: line entities, else the intro line ending with « : », else the section heading
    for (const ref of cfg.docs.stateSetters) {
      const d = docByPrefix(ref.file);
      if (!d) continue;
      const lines = sectionLines(d, ref.heading);
      const hl = headingLine(d, ref.heading);
      for (const l of lines) {
        const hs = lineHits(d, l);
        const states = hs.filter((h) => h.type === 'state');
        if (!states.length) continue;
        let setters = hs.filter((h) => h.type !== 'state' && !h.inTag && (CODE_TYPES.has(h.type) || h.type === 'actCode') && h.type !== 'package');
        let how = 'state-setter:line';
        if (!setters.length && l.kind === 'list') {
          const intro = [...d.lines.slice(0, l.n - 1)].reverse().find((x) => x.kind !== 'list' && x.kind !== 'blank' && x.sectionId === l.sectionId);
          if (intro && /:\s*$/.test(intro.raw.replace(/\[[^\]]*\]/g, '').trim())) {
            setters = lineHits(d, intro).filter((h) => CODE_TYPES.has(h.type) && h.type !== 'package');
            how = 'state-setter:intro';
          }
        }
        if (!setters.length && hl) {
          setters = lineHits(d, hl).filter((h) => CODE_TYPES.has(h.type) && h.type !== 'package');
          how = 'state-setter:heading';
        }
        const cond = plain(l.raw).replace(/\s*\[[VH][^\]]*\]/g, '');
        for (const s of setters) for (const st of states) edge(s.id, st.id, 'sets-state', prov(d, l, how), cond.length > 90 ? cond.slice(0, 88) + '…' : cond);
      }
    }
  }

  // ------------------------------------------------------------------ workflows
  function parseWorkflow(wf: WorkflowDef) {
    const d = docByPrefix(wf.file);
    if (!d) return;
    const hl = headingLine(d, wf.heading);
    if (!hl) return;
    const lines = sectionLines(d, wf.heading);
    type Step = { id: string; label: string; ordre: number; line: MdLine; desc: string; extra: MdLine[] };
    const steps: Step[] = [];
    const edges: [string, string, MdLine][] = [];
    if (wf.parser === 'ordered-list') {
      let cur: Step | null = null;
      for (const l of lines) {
        if (l.kind === 'list' && l.ordinal && !/^\s/.test(l.raw)) {
          const bold = l.raw.match(/^\s*\d+\.\s+\*\*(.+?)\*\*/)?.[1];
          const text = clean(l.raw);
          const head = text.split(/\s*[:;(]\s*|\.\s|\s\[/)[0].replace(/\.$/, '');
          const label = bold ? plain(bold) : head.length > 64 ? head.slice(0, 64).replace(/\s+\S*$/, '') + '…' : head;
          cur = { id: `${wf.id}/${l.ordinal}`, label: `${l.ordinal}. ${label}`, ordre: l.ordinal, line: l, desc: text, extra: [] };
          steps.push(cur);
        } else if (cur && l.kind === 'list' && /^\s+/.test(l.raw)) cur.extra.push(l);
        else if (l.kind !== 'list' && l.kind !== 'blank') cur = null;
      }
      for (let i = 0; i + 1 < steps.length; i++) edges.push([steps[i].id, steps[i + 1].id, steps[i + 1].line]);
    } else if (wf.parser === 'table') {
      for (const l of lines.filter((x) => x.kind === 'table-row' && !isHeaderRow(d, x) && x.cells)) {
        const n = Number(plain(l.cells![0]));
        if (!Number.isFinite(n) || !n) continue;
        const label = plain(l.cells![1] ?? '');
        steps.push({ id: `${wf.id}/${n}`, label: `${n}. ${label}`, ordre: n, line: l, desc: l.cells!.slice(2).map(plain).join(' — '), extra: [] });
      }
      steps.sort((a, c) => a.ordre - c.ordre);
      for (let i = 0; i + 1 < steps.length; i++) edges.push([steps[i].id, steps[i + 1].id, steps[i + 1].line]);
    } else if (wf.parser === 'diagram') {
      // geometry of the ASCII diagram (07 §1): « A ──► B », « B ◄── A », and « │ / ▼ » between rows
      const code = d.lines.filter((l) => l.n > hl.n && l.n <= (d.sections.find((s) => s.startLine === hl.n)?.endLine ?? hl.n) && l.kind === 'code' && !/^\s*```/.test(l.raw));
      type Item = { label: string; s: number; e: number; line: MdLine };
      const rows: { line: MdLine; items: Item[] }[] = [];
      const byLabel = new Map<string, Step>();
      const stepOf = (it: Item) => {
        let s = byLabel.get(it.label);
        if (!s) {
          s = { id: `${wf.id}/${slugify(it.label)}`, label: it.label, ordre: byLabel.size + 1, line: it.line, desc: it.label, extra: [] };
          byLabel.set(it.label, s);
          steps.push(s);
        }
        return s;
      };
      for (const l of code) {
        if (!/[A-Za-zÀ-ÿ]/.test(l.raw)) continue;
        const items: Item[] = [];
        const ops: string[] = [];
        const re = /(◄──|──►)/g;
        let last = 0;
        let m: RegExpExecArray | null;
        const pushItem = (from: number, to: number) => {
          const txt = l.raw.slice(from, to);
          const lead = txt.length - txt.trimStart().length;
          const label = txt.trim();
          if (label) items.push({ label, s: from + lead, e: from + lead + label.length, line: l });
        };
        while ((m = re.exec(l.raw))) {
          pushItem(last, m.index);
          ops.push(m[1]);
          last = m.index + m[0].length;
        }
        pushItem(last, l.raw.length);
        rows.push({ line: l, items });
        items.forEach((it) => stepOf(it));
        for (let i = 0; i + 1 < items.length; i++) {
          const [a, c] = ops[i] === '──►' ? [items[i], items[i + 1]] : [items[i + 1], items[i]];
          edges.push([stepOf(a).id, stepOf(c).id, l]);
        }
      }
      for (const l of code) {
        const col = l.raw.indexOf('▼');
        if (col < 0) continue;
        const above = [...rows].reverse().find((r) => r.line.n < l.n);
        const below = rows.find((r) => r.line.n > l.n);
        const at = (r?: { items: Item[] }) => r?.items.find((it) => it.s <= col && col < it.e) ?? r?.items.reduce<Item | undefined>((best, it) => (!best || Math.abs(it.s - col) < Math.abs(best.s - col) ? it : best), undefined);
        const a = at(above);
        const c = at(below);
        if (a && c) edges.push([stepOf(a).id, stepOf(c).id, l]);
      }
    }
    if (!steps.length) return;
    b.upsertNode(wf.id, { type: 'workflow', label: wf.label, aliases: [wf.label, plain(hl.raw)], props: { etapes: steps.length, forme: wf.parser === 'diagram' ? 'diagramme ASCII' : wf.parser === 'table' ? 'tableau' : 'liste numérotée' } }, prov(d, hl, 'workflow-heading'));
    markLine(d, hl.n, wf.id);
    for (const s of steps) {
      b.upsertNode(s.id, { type: 'step', subtype: wf.id, label: s.label, aliases: [s.label.replace(/^\d+\.\s*/, '')], description: s.desc, props: { ordre: s.ordre, workflow: wf.id } }, prov(d, s.line, wf.parser === 'diagram' ? 'workflow-diagram' : 'workflow-step'));
      markLine(d, s.line.n, s.id);
      edge(s.id, wf.id, 'part-of', prov(d, s.line, 'workflow-step'));
      for (const l of [s.line, ...s.extra]) for (const h of lineHits(d, l)) if (b.has(h.id) && h.type !== 'doc') edge(h.id, s.id, 'implements', prov(d, l, 'workflow-step'));
    }
    for (const [a, c, l] of edges) edge(a, c, 'sequence', prov(d, l, wf.parser === 'diagram' ? 'diagram-arrow' : 'workflow-order'));
  }

  // ------------------------------------------------------------------ issues (10)
  function parseIssues() {
    const d = docByPrefix(cfg.docs.issues.file);
    if (!d) return;
    const counters = new Map<string, number>();
    const next = (p: string) => {
      const n = (counters.get(p) ?? 0) + 1;
      counters.set(p, n);
      return `${p}${n}`;
    };
    for (const l of d.lines) {
      const h2 = l.headingPath[1] ?? '';
      const h3 = l.headingPath[2] ?? '';
      if (!h2 || /Questions/i.test(h2)) continue;
      const cat = /Bugs/i.test(h2) ? 'Bug' : /Sécurité/i.test(h2) ? 'Sécurité' : /Dette/i.test(h2) ? 'Dette technique' : /Limites/i.test(h2) ? 'Limite de l’analyse' : plain(h2);
      const statut = /^Confirmés/i.test(h3) ? 'confirmé' : /^Potentiels/i.test(h3) ? 'potentiel' : 'constat';
      let id: string | null = null;
      let label = '';
      const props: Record<string, string> = { categorie: cat, statut, section: plain(h3 || h2) };
      if (l.kind === 'table-row' && l.cells && !isHeaderRow(d, l)) {
        if (/^[A-Z]\d+$/.test(l.cells[0])) {
          id = `issue:${l.cells[0]}`;
          label = `${l.cells[0]} · ${clean(l.cells[1])}`;
          props.emplacement = plain(l.cells[2] ?? '');
        } else if (/Secrets/i.test(h3)) {
          const code = next('SEC');
          id = `issue:${code}`;
          // location and kind only: the doc itself never reproduces the values (10:5)
          label = `${code} · ${plain(l.cells[1] ?? '')}`;
          props.categorie = 'Secret dans un fichier suivi';
          props.emplacement = plain(l.cells[0]);
          props.valeur = 'non reproduite (10:5)';
        } else if (/Dépendances/i.test(h3)) {
          const code = next('D');
          id = `issue:${code}`;
          label = `${code} · ${plain(l.cells[0])} ${plain(l.cells[1] ?? '')}`;
          props.categorie = 'Dépendance ancienne';
        }
      } else if (l.kind === 'list' && !/^\s{2,}/.test(l.raw)) {
        const p = cat === 'Bug' ? 'BP' : cat === 'Sécurité' ? 'SP' : cat === 'Dette technique' ? 'T' : cat === 'Limite de l’analyse' ? 'L' : 'X';
        const code = next(p);
        id = `issue:${code}`;
        label = `${code} · ${clean(l.raw)}`;
        if (cat === 'Dette technique') props.sousCategorie = plain(h3);
      }
      if (!id) continue;
      const short = label.length > 96 ? label.slice(0, 94) + '…' : label;
      b.upsertNode(id, { type: 'issue', subtype: props.categorie, label: short, description: label, aliases: [id.slice(6)], props }, prov(d, l, 'issue-row'));
      markLine(d, l.n, id);
      for (const h of lineHits(d, l)) if (b.has(h.id) && h.type !== 'doc') edge(id, h.id, 'affects', prov(d, l, 'issue-row'));
    }
  }

  // ------------------------------------------------------------------ questions
  function parseQuestions() {
    const re = new RegExp(cfg.docs.questionsHeading);
    for (const d of docs) {
      const qsec = d.sections.find((s) => re.test(s.title) && s.level === 2);
      if (!qsec) continue;
      for (const l of d.lines) {
        if (l.n <= qsec.startLine || l.n > qsec.endLine || l.kind !== 'list' || !l.ordinal) continue;
        const sub = l.headingPath.length > 2 ? plain(l.headingPath[l.headingPath.length - 1]) : '';
        const id = `q:${d.id}-${l.ordinal}`;
        const text = clean(l.raw);
        b.upsertNode(id, { type: 'question', subtype: sub || d.title.replace(/^\d+\s*—\s*/, ''), label: `Q${d.id}.${l.ordinal} · ${text.length > 84 ? text.slice(0, 82) + '…' : text}`, description: text, aliases: [`Q${d.id}.${l.ordinal}`], props: { doc: d.id, numero: l.ordinal, categorie: sub || d.title.replace(/^\d+\s*—\s*/, '') } }, prov(d, l, 'question-item'));
        markLine(d, l.n, id);
        for (const h of lineHits(d, l)) if (b.has(h.id) && h.type !== 'doc') edge(id, h.id, 'affects', prov(d, l, 'question-item'));
      }
    }
  }

  // ------------------------------------------------------------------ glossary
  function parseGlossary() {
    const d = docByPrefix(cfg.docs.glossary.file);
    if (!d) return;
    const objRe = new RegExp(cfg.docs.objects.heading);
    for (const l of d.lines) {
      if (l.kind !== 'table-row' || !l.cells || isHeaderRow(d, l) || inSection(l, objRe)) continue;
      const termText = plain(l.cells[0]);
      const id = `term:${slugify(termText)}`;
      const parts = termText.split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean);
      const al = [...parts, ...parts.map((p) => p.replace(/\s*\(.*?\)\s*/g, '').trim())].filter((x) => x.length >= 2);
      const section = plain(l.headingPath[l.headingPath.length - 1] ?? '');
      b.upsertNode(id, { type: 'term', subtype: section.replace(/^\d+\.\s*/, ''), label: termText, description: plain(l.cells[1] ?? ''), aliases: [...new Set(al)], props: { ou: plain(l.cells[2] ?? '') } }, prov(d, l, 'glossary-row'));
      markLine(d, l.n, id);
      const off = l.cellOffsets![1] ?? Infinity;
      for (const h of lineHits(d, l)) if (b.has(h.id) && h.type !== 'doc') edge(id, h.id, h.start < off ? 'defines' : 'mentions', prov(d, l, 'glossary-row'));
    }
  }

  // ------------------------------------------------------------------ conventions
  function parseConventions() {
    for (const c of cfg.docs.conventions) {
      const d = docByPrefix(c.file);
      if (!d) continue;
      let i = 0;
      for (const l of sectionLines(d, c.heading)) {
        let label = '';
        let desc = '';
        if (c.parser === 'table') {
          if (l.kind !== 'table-row' || !l.cells || isHeaderRow(d, l)) continue;
          label = plain(l.cells[0]);
          desc = l.cells.slice(1).map(plain).filter(Boolean).join(' — ');
        } else {
          if (l.kind !== 'list' || /^\s{2,}/.test(l.raw)) continue;
          const text = clean(l.raw);
          const bold = l.raw.match(/^\s*[-*+]\s+\*\*(.+?)\*\*/)?.[1];
          label = bold ? plain(bold).replace(/\s*:$/, '') : text.split(/\s*:\s|\.\s/)[0];
          if (label.length > 72) label = label.slice(0, 70) + '…';
          desc = text;
        }
        if (!label) continue;
        const id = `conv:${d.id}-${slugify(c.subtype)}-${++i}`;
        b.upsertNode(id, { type: 'convention', subtype: c.subtype, label, description: desc, aliases: [label], props: { categorie: c.subtype } }, prov(d, l, 'convention-item'));
        markLine(d, l.n, id);
        const off = l.cellOffsets?.[1] ?? 0;
        for (const h of lineHits(d, l)) {
          if (!b.has(h.id) || h.type === 'doc' || (c.parser === 'table' && h.start < off)) continue;
          const hdr = c.parser === 'table' ? tableHeader(d, l)?.[h.cell] ?? '' : '';
          const rec = CODE_TYPES.has(h.type) && h.type !== 'package' && (c.parser === 'list' || /Composant/i.test(hdr));
          edge(id, h.id, rec ? 'recommends' : 'mentions', prov(d, l, 'convention-item'));
        }
      }
    }
  }
}
