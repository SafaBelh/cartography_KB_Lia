/**
 * Line-oriented Markdown reader tailored for knowledge-base docs.
 * We keep exact line numbers so every extracted fact can point back to its source line.
 */
import type { Confidence } from '../../src/types/graph';

export type LineKind = 'heading' | 'table-row' | 'table-sep' | 'list' | 'quote' | 'para' | 'code' | 'blank';

export interface MdLine {
  n: number; // 1-based line number
  raw: string;
  kind: LineKind;
  level?: number; // heading level
  /** Ordered-list number when the line is "1. …" */
  ordinal?: number;
  cells?: string[]; // table cells (raw, trimmed)
  cellOffsets?: number[]; // start offset of each cell inside raw
  sectionId: string;
  headingPath: string[];
  /** Confidence tags found on this very line (weakest first resolution happens later). */
  tags: Confidence[];
  /** Raw text of the tags on this line ("V `src/…/X.java:45-60`", "V pour …, H pour …"). */
  tagText: string[];
  isLegend: boolean;
}

export interface MdSection {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  tags: Confidence[];
  /** Raw tag text, including a tag written alone on the line under the heading. */
  tagText: string[];
  parentId?: string;
}

export interface MdDoc {
  id: string; // "00"
  file: string; // file name
  title: string;
  text: string;
  lines: MdLine[];
  sections: MdSection[];
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** Extract every V/H tag from a line, in the spellings of the LiaWeb knowledge base:
 *  "[V]", "**[H]**", "[V `src/…/X.java:45-60`]", "[V sur le WAR éclaté ; …]", "[H : …]",
 *  "[V pour les fichiers manquants, H pour la conclusion]". Mixed tags return both letters
 *  (the weakest wins later). Markdown links such as "[README.md](x)" are ignored. */
export function findTags(text: string): Confidence[] {
  return findTagsDetailed(text).tags;
}

export function findTagsDetailed(text: string): { tags: Confidence[]; raw: string[] } {
  const out: Confidence[] = [];
  const raw: string[] = [];
  const re = /\[([^\[\]]{1,200})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const inner = m[1].trim();
    // must start with a tag letter followed by a non-letter (avoids "[Something]") and not be a link
    if (!/^(\*\*)?[VH](\*\*)?(?![A-Za-zÀ-ÿ])/.test(inner) || text[m.index + m[0].length] === '(') continue;
    // letters outside backticks only (paths may contain "/H…")
    const bare = inner.replace(/`[^`]*`/g, ' ');
    const letters = bare.match(/(?:^|[\s/;,*])([VH])(?=$|[\s/;:,*\]]|\s+pour)/g) ?? [];
    let found = false;
    for (const l of letters) {
      const c = l.replace(/[^VH]/g, '') as Confidence;
      if (!c) continue;
      found = true;
      if (!out.includes(c)) out.push(c);
    }
    if (found) raw.push(inner);
  }
  return { tags: out, raw };
}

/** A paragraph made only of a tag ("[V `projet/stage/ProjetStageService.java:19-25`]") qualifies its section. */
export const isTagOnlyLine = (raw: string) => /^\s*\[[VH][^\[\]]*\]\s*$/.test(raw);

const RANK: Record<Confidence, number> = { V: 2, H: 1 };
export const weakest = (tags: Confidence[]): Confidence | undefined =>
  tags.length ? tags.reduce((a, b) => (RANK[a] <= RANK[b] ? a : b)) : undefined;
export const strongest = (tags: Confidence[]): Confidence | undefined =>
  tags.length ? tags.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b)) : undefined;
export const rank = (c: Confidence) => RANK[c];

function splitCells(raw: string): { cells: string[]; offsets: number[] } {
  const cells: string[] = [];
  const offsets: number[] = [];
  // split on | that are not inside backticks
  let inTick = false;
  let start = raw.indexOf('|') + 1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '`') inTick = !inTick;
    if (ch === '|' && !inTick) {
      const cell = raw.slice(start, i);
      const lead = cell.length - cell.trimStart().length;
      cells.push(cell.trim());
      offsets.push(start + lead);
      start = i + 1;
    }
  }
  return { cells, offsets };
}

export function parseMarkdown(file: string, text: string, legendPattern?: RegExp): MdDoc {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: MdLine[] = [];
  const sections: MdSection[] = [];
  const stack: MdSection[] = [];
  let inCode = false;
  let title = file;
  const usedIds = new Set<string>();

  const root: MdSection = { id: 'top', title: file, level: 0, startLine: 1, endLine: rawLines.length, tags: [], tagText: [] };
  sections.push(root);

  rawLines.forEach((raw, idx) => {
    const n = idx + 1;
    let kind: LineKind = 'para';
    let level: number | undefined;
    let ordinal: number | undefined;
    let cells: string[] | undefined;
    let cellOffsets: number[] | undefined;

    if (/^\s*```/.test(raw)) {
      inCode = !inCode;
      kind = 'code';
    } else if (inCode) {
      kind = 'code';
    } else if (/^\s*$/.test(raw)) {
      kind = 'blank';
    } else if (/^#{1,6}\s/.test(raw)) {
      kind = 'heading';
      level = raw.match(/^#+/)![0].length;
      const htitle = raw.replace(/^#+\s*/, '').trim();
      if (level === 1 && title === file) title = htitle.replace(/\s*\[[VH][^\]]*\]\s*/g, '').trim();
      // close sections with level >= current
      while (stack.length && stack[stack.length - 1].level >= level) {
        stack.pop()!.endLine = n - 1;
      }
      let id = slugify(htitle) || `section-${n}`;
      while (usedIds.has(id)) id = `${id}-${n}`;
      usedIds.add(id);
      const sec: MdSection = {
        id,
        title: htitle,
        level,
        startLine: n,
        endLine: rawLines.length,
        tags: findTags(htitle),
        tagText: findTagsDetailed(htitle).raw,
        parentId: stack[stack.length - 1]?.id ?? 'top',
      };
      sections.push(sec);
      stack.push(sec);
    } else if (/^\s*\|/.test(raw)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(raw)) kind = 'table-sep';
      else {
        kind = 'table-row';
        const s = splitCells(raw);
        cells = s.cells;
        cellOffsets = s.offsets;
      }
    } else if (/^\s*>/.test(raw)) {
      kind = 'quote';
    } else if (/^\s*(?:[-*+]|\d+\.)\s/.test(raw)) {
      kind = 'list';
      const om = raw.match(/^\s*(\d+)\.\s/);
      if (om) ordinal = Number(om[1]);
    }

    const cur = stack[stack.length - 1] ?? root;
    const isLegend =
      !!legendPattern && legendPattern.test(raw) && (raw.match(/\*\*\[[VH]\]\*\*/g)?.length ?? 0) >= 2;
    const td = kind === 'heading' || isLegend ? { tags: [], raw: [] } : findTagsDetailed(raw);
    // "[V `path`]" alone under a heading qualifies the whole section (07 §2.1, §3.1 …)
    if (kind === 'para' && isTagOnlyLine(raw) && cur !== root && !cur.tags.length) {
      cur.tags = td.tags;
      cur.tagText = td.raw;
    }
    lines.push({
      n,
      raw,
      kind,
      level,
      ordinal,
      cells,
      cellOffsets,
      sectionId: kind === 'heading' ? sections[sections.length - 1].id : cur.id,
      headingPath: stack.map((s) => s.title),
      tags: td.tags,
      tagText: td.raw,
      isLegend,
    });
  });
  while (stack.length) stack.pop()!.endLine = rawLines.length;

  const id = file.match(/^(\d+)/)?.[1] ?? slugify(file);
  return { id, file, title, text, lines, sections };
}

export interface LegendRule {
  /** Section title pattern ("^Confirmés$") */
  heading: RegExp;
  confidence: Confidence;
  /** Where the doc defines this reading ("10:3") */
  where: string;
}

/** Resolve the confidence of a line: line tag → nearest heading tag (or tag-only line under it)
 *  → section legend of the doc (10: « Confirmé = constaté à la lecture du code ») → fallback H. */
export function resolveConfidence(
  doc: MdDoc,
  line: MdLine,
  legend: LegendRule[] = [],
): { confidence: Confidence; from: 'line' | 'section' | 'legend' | 'fallback'; tagText?: string } {
  const lt = weakest(line.tags);
  if (lt) return { confidence: lt, from: 'line', tagText: line.tagText.join(' | ') };
  // walk the section chain
  let sec = doc.sections.find((s) => s.id === line.sectionId);
  while (sec) {
    const st = weakest(sec.tags);
    if (st) return { confidence: st, from: 'section', tagText: sec.tagText.join(' | ') };
    const lg = legend.find((r) => r.heading.test(sec!.title));
    if (lg) return { confidence: lg.confidence, from: 'legend', tagText: `${sec.title} (légende ${lg.where})` };
    sec = sec.parentId ? doc.sections.find((s) => s.id === sec!.parentId) : undefined;
  }
  return { confidence: 'H', from: 'fallback' };
}

export interface Span {
  text: string;
  start: number; // offset of the opening backtick
  end: number; // offset after the closing backtick
}

export function backtickSpans(raw: string): Span[] {
  const out: Span[] = [];
  const re = /`([^`]+)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) out.push({ text: m[1], start: m.index, end: m.index + m[0].length });
  return out;
}

/** Same-length copy of raw where backtick spans are blanked out (for plain-text alias matching). */
export function maskSpans(raw: string, spans: Span[]): string {
  let s = raw;
  for (const sp of spans) s = s.slice(0, sp.start) + ' '.repeat(sp.end - sp.start) + s.slice(sp.end);
  return s;
}

/** Parenthesis depth (outside backticks) at each offset of the line. */
export function parenDepth(raw: string, spans: Span[]): number[] {
  const depth: number[] = new Array(raw.length + 1).fill(0);
  let d = 0;
  let si = 0;
  for (let i = 0; i < raw.length; i++) {
    while (si < spans.length && spans[si].end <= i) si++;
    const inSpan = si < spans.length && spans[si].start <= i && i < spans[si].end;
    if (!inSpan) {
      if (raw[i] === '(' || raw[i] === '«') d++;
      else if ((raw[i] === ')' || raw[i] === '»') && d > 0) d--;
    }
    depth[i] = d;
  }
  depth[raw.length] = d;
  return depth;
}

/** Strip markdown emphasis/backticks to produce a readable snippet. */
export function plain(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(.+?)\*(?=\s|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*>\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function snippet(s: string, max = 260): string {
  const p = plain(s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').replace(/\s*\|\s*/g, ' · '));
  return p.length > max ? p.slice(0, max - 1) + '…' : p;
}
