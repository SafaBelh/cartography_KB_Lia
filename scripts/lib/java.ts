/**
 * Deterministic recognisers for the identifiers written in the LiaWeb knowledge base.
 * Pure functions (no I/O): unit-tested in tests/recognizers.test.ts.
 *
 *  - Java: packages, FQCNs, `Class.method(...)`, `src/…/X.java:45-60`, elided `lia-core/.../x/Y.java`,
 *    relative `projet/stage/ProjetStageService.java` (package only from the doc's own base statement)
 *  - tables / views following 05 §3.1 (`<MODULE>_<NOM>`, prefixes read from the doc)
 *  - dbupdate migrations, URL endpoints, JVM properties, repository files, XML resources (12 §6.1 prefixes)
 */

export interface JavaRef {
  kind: 'class' | 'package';
  /** Class simple name (outer class for `Refer.ModeArrondi`). */
  simple?: string;
  /** Full package when the identifier gives it (FQCN or full source path). */
  pkg?: string;
  /** Dotted package suffix when the path is elided (`lia-core/.../security/realm`) or relative. */
  pkgSuffix?: string;
  /** True when pkgSuffix comes from a relative path (to be resolved with the doc's base statement). */
  relative?: boolean;
  /** Source root (`src`, `lia-core`, `srctest`…) when the path starts with one. */
  root?: string;
  /** Path as written (without the line numbers). */
  path?: string;
  /** Line numbers as written: "45-60", "64, 1555-1559". */
  lines?: string;
  method?: string;
}

const CAMEL = /^[A-Z][A-Za-z0-9]*[a-z][A-Za-z0-9]*$|^[A-Z][A-Z0-9]{2,}$/;
const LOWER_SEG = /^[a-z][a-z0-9_]*$/;

/** Split "path:45-60" / "File.java:64, 1555-1559" into path and lines. */
export function splitLines(t: string): { path: string; lines?: string } {
  const m = t.match(/^(.*?\.?[^:\s]+?):(\d[\d\s,\-–]*)$/);
  if (m && !/^[a-z]+:\/\//.test(t)) return { path: m[1], lines: m[2].replace(/\s+/g, ' ').trim() };
  return { path: t };
}

/** Remove call arguments and generics: `BaseWebSession.get().hasDroitOf(objet, droit)` → `BaseWebSession.get.hasDroitOf`. */
export function stripCalls(t: string): string {
  let s = t.replace(/^new\s+/, '').replace(/<[^<>]*>/g, '');
  for (let i = 0; i < 4 && /\([^()]*\)/.test(s); i++) s = s.replace(/\([^()]*\)/g, '');
  return s.replace(/\s+/g, '');
}

/**
 * Parse one backtick span as a Java reference. Returns [] when the span is not Java.
 * `packageRoots`: first package segments considered as LiaWeb code (com.wtrace, com.ordiges, fr.tracesolutions…).
 * `sourceRoots`: path prefixes that are source roots (src, lia-core, lia-social, lia-redaction, srctest, test).
 */
export function parseJavaSpan(span: string, packageRoots: string[], sourceRoots: string[]): JavaRef[] {
  const t = span.trim().replace(/[.,;]+$/, '');
  // templates (`<Entité>Service`, `dbu<numver>.sql`) and annotations are not identifiers
  if (!t || t.startsWith('/') || t.startsWith('@') || t.startsWith('$') || /[<>]/.test(t)) return [];
  const isRoot = (dotted: string) => packageRoots.some((r) => dotted === r || dotted.startsWith(r + '.'));
  const { path, lines } = splitLines(t);
  if (/\s/.test(path.replace(/^new\s+/, '').replace(/\([^()]*\)/g, ''))) return [];

  // ------------------------------------------------------------ path form
  if (path.includes('/') || /\.java$/.test(path)) {
    if (/\.(?!java$)[A-Za-z0-9]+$/.test(path) || /^(?:WebContent|WEB-INF|META-INF)\//.test(path) || /[<>*{}]/.test(path)) return [];
    const segs = path.replace(/\/+$/, '').split('/').filter(Boolean);
    let last = segs[segs.length - 1];
    const isJava = last.endsWith('.java');
    if (isJava) last = last.slice(0, -5);
    const isClass = isJava || CAMEL.test(last);
    const dirs = isClass ? segs.slice(0, -1) : segs;
    let root: string | undefined;
    let rest = dirs;
    if (dirs.length && sourceRoots.includes(dirs[0])) {
      root = dirs[0];
      rest = dirs.slice(1);
      if (rest[0] === 'src' && rest[1] === 'main' && rest[2] === 'java') rest = rest.slice(3);
      else if (rest[0] === 'java') rest = rest.slice(1); // test/java
    }
    const elided = rest.findIndex((s) => s === '...' || s === '…');
    const out: JavaRef = { kind: isClass ? 'class' : 'package', path, lines, root };
    if (isClass) out.simple = last;
    if (elided >= 0) {
      const suf = rest.slice(elided + 1);
      if (suf.length && suf.every((s) => LOWER_SEG.test(s))) out.pkgSuffix = suf.join('.');
    } else if (rest.length && rest.every((s) => /^[A-Za-z][A-Za-z0-9_]*$/.test(s))) {
      const dotted = rest.join('.');
      if (root || isRoot(dotted)) {
        if (!isRoot(dotted)) return []; // third-party code copied into src/ (org.jbpm…, 03 §3.8): not LiaWeb's
        out.pkg = dotted;
      } else {
        out.pkgSuffix = dotted;
        out.relative = true;
      }
    }
    if (!isClass && !out.pkg && !out.pkgSuffix) return [];
    return [out];
  }

  // ------------------------------------------------------------ dotted form
  if (/^[\w-]+\.[a-z]{2,4}$/.test(path) && /^[A-Z0-9_-]+\./.test(path)) return []; // a file name (CLAUDE.md)
  const s = stripCalls(path);
  if (!/^[A-Za-z_][\w.*]*$/.test(s)) return [];
  const segs = s.replace(/\.\*$/, '').replace(/\.$/, '').split('.').filter(Boolean);
  const ci = segs.findIndex((x) => /^[A-Z]/.test(x));
  if (ci < 0) {
    // package only: must start with a configured root (com.ordiges.admin, com.wtrace.*)
    const dotted = segs.join('.');
    return isRoot(dotted) && segs.every((x) => LOWER_SEG.test(x)) ? [{ kind: 'package', pkg: dotted, path }] : [];
  }
  const simple = segs[ci];
  if (!CAMEL.test(simple)) return [];
  const before = segs.slice(0, ci);
  const after = segs.slice(ci + 1);
  if (before.some((x) => !LOWER_SEG.test(x))) return [];
  // an all-caps word alone (FORM, SITE, PRJ) is a code value, never a class
  if (!before.length && !after.length && /^[A-Z0-9]+$/.test(simple)) return [];
  const ref: JavaRef = { kind: 'class', simple, path };
  if (before.length) {
    const dotted = before.join('.');
    if (isRoot(dotted)) ref.pkg = dotted;
    else if (/^(org|java|javax|jakarta|net)\b/.test(dotted)) return []; // third-party (org.apache.wicket…)
    else ref.pkgSuffix = dotted;
  }
  const m = after.find((x) => /^[a-z]/.test(x) && x !== 'class' && x !== 'get');
  if (m) ref.method = m;
  // a bare word with no class suffix and no package is decided by the caller (needs a context cue)
  return [ref];
}

export interface ClassKind {
  type: 'page' | 'service' | 'class';
  subtype: string;
  /** True when the simple name alone proves it is a class (suffix convention, 09 §2). */
  bySuffix: boolean;
}

const SUFFIXES: [RegExp, ClassKind['type'], string][] = [
  [/Page$/, 'page', 'page Wicket'],
  [/Services?(Impl)?$/, 'service', 'service'],
  [/Panel$/, 'class', 'panneau Wicket'],
  [/Modal$/, 'class', 'fenêtre modale'],
  [/Filter$/, 'class', 'filtre servlet'],
  [/Listener$/, 'class', 'écouteur'],
  [/Job$/, 'class', 'tâche planifiée'],
  [/Alg$/, 'class', 'algorithme de décompte'],
  [/(Resource|WS)$/, 'class', 'ressource REST'],
  [/Servlet$/, 'class', 'servlet'],
  [/Test$/, 'class', 'test'],
  [/Task$/, 'class', 'tâche'],
  [/(Util|Utils|Helper)$/, 'class', 'utilitaire'],
  [/(Authenticator|Realm|Checker|Encryptor|Validator)$/, 'class', 'sécurité'],
  [/(Factory|Manager|Provider|Executor|Repository|Generator|Client|Context|Session|Updater|Listener)$/, 'class', 'technique'],
  [/(Converter|Form|Link|Picker|Component|Model|Shelter|Container)$/, 'class', 'composant Wicket'],
  [/(Application)$/, 'class', 'application'],
];

export function classKind(simple: string, overrides: Record<string, string> = {}): ClassKind {
  if (overrides[simple]) return { type: 'class', subtype: overrides[simple], bySuffix: true };
  for (const [re, type, subtype] of SUFFIXES) if (re.test(simple)) return { type, subtype, bySuffix: true };
  return { type: 'class', subtype: 'classe', bySuffix: false };
}

export const classPrefix = (t: ClassKind['type']) => (t === 'page' ? 'page' : t === 'service' ? 'svc' : 'cls');

// ------------------------------------------------------------------ tables (05 §3.1)

/** Build the table-name matcher from the prefixes listed in 05 §3.1. */
export function tableMatcher(prefixes: string[]): RegExp {
  const p = [...prefixes].sort((a, b) => b.length - a.length).map((x) => x.replace(/[^A-Z0-9]/g, '')).join('|');
  return new RegExp(`^(?:${p})_(?:\\*|[A-Z0-9]+(?:_[A-Z0-9]+)*(?:_\\*)?)$`);
}

/** Generic `<MODULE>_<NOM>` shape, used only when the doc itself says "table" next to the name. */
export const TABLE_SHAPE = /^[A-Z][A-Z0-9]{1,8}_(?:\*|[A-Z0-9]+(?:_[A-Z0-9]+)*(?:_\*)?)$/;

/** `REC_CUMUL_ARN/OPE` → REC_CUMUL_ARN, REC_CUMUL_OPE · `DYNDATA_CLASS / DYNDATA_OBJECT` → both · `LBT_COMPTE.LCMP_NUMVER` → table + column. */
export function expandTableToken(t: string): { tables: string[]; column?: string } {
  const s = t.trim().replace(/[.,;:]+$/, '');
  const dot = s.match(/^([A-Z][A-Z0-9_]+)\.([A-Z][A-Z0-9_]+)$/);
  if (dot) return { tables: [dot[1]], column: dot[2] };
  if (s.includes('/')) {
    const parts = s.split('/').map((x) => x.trim()).filter(Boolean);
    if (parts.every((x) => /^[A-Z][A-Z0-9_*]+$/.test(x))) {
      const first = parts[0];
      if (parts.slice(1).every((x) => x.includes('_'))) return { tables: parts };
      // short tails replace the last segment: REC_CUMUL_ARN/OPE
      const base = first.replace(/[^_]+$/, '');
      return { tables: [first, ...parts.slice(1).map((x) => base + x)] };
    }
  }
  return { tables: [s] };
}

// ------------------------------------------------------------------ migrations (05 §4)

export interface MigrationRef {
  id: string;
  label: string;
  subtype: 'racine' | 'manifeste' | 'dossier de version' | 'dossier rejoué' | 'dossier' | 'script' | 'tâche Java';
  /** parent folder id when the path gives it (dbu2026-11-02/dbu6109001.sql) */
  parent?: string;
}

export function parseMigration(t: string, inDbupdateContext: boolean): MigrationRef[] {
  const s = t.trim().replace(/[.,;]+$/, '');
  if (/[<>]/.test(s)) return [];
  if (/^UpgradeTask_\d+/.test(s)) return [{ id: `mig:${s}`, label: s, subtype: 'tâche Java' }];
  const segs = s.replace(/^WebContent\//, '').split('/').filter(Boolean);
  const out: MigrationRef[] = [];
  const hasDbupdate = segs[0] === 'dbupdate';
  const ctx = inDbupdateContext || hasDbupdate;
  const rest = hasDbupdate ? segs.slice(1) : segs;
  const ROOT: MigrationRef = { id: 'mig:dbupdate', label: 'dbupdate/', subtype: 'racine' };
  if (hasDbupdate && !rest.length) return [ROOT];
  if (s === 'dbupdate.xml' || s.endsWith('/dbupdate.xml')) return [{ id: 'mig:dbupdate.xml', label: 'dbupdate.xml', subtype: 'manifeste', parent: hasDbupdate ? 'mig:dbupdate' : undefined }];
  let parent: string | undefined;
  if (hasDbupdate && !(rest.length === 1 && rest[0] === 'dbupdate.xml')) {
    out.push(ROOT);
    parent = ROOT.id;
  }
  for (let i = 0; i < rest.length; i++) {
    const seg = rest[i];
    const isLast = i === rest.length - 1;
    let ref: MigrationRef | null = null;
    if (/^dbu\d{4}-\d{2}-\d{2}$/.test(seg)) ref = { id: `mig:${seg}`, label: `${seg}/`, subtype: 'dossier de version' };
    else if (/^maj99$/.test(seg)) ref = { id: 'mig:maj99', label: 'maj99/', subtype: 'dossier rejoué' };
    else if (ctx && /^(init|cctp)$/.test(seg) && (!isLast || s.endsWith('/'))) ref = { id: `mig:${seg}`, label: `${seg}/`, subtype: 'dossier' };
    else if (/^dbu\d+\.sql$/.test(seg) || /^maj\d+\.sql$/.test(seg)) ref = { id: `mig:${seg}`, label: seg, subtype: 'script' };
    else if (ctx && isLast && /\.(sql|dat)$/.test(seg)) ref = { id: `mig:${seg}`, label: seg, subtype: 'script' };
    if (!ref) {
      if (!isLast || ctx) continue;
      return out.length > (hasDbupdate ? 1 : 0) ? out : [];
    }
    if (parent && !out.some((o) => o.id === ref!.id)) ref.parent = parent;
    out.push(ref);
    parent = ref.id;
  }
  return out;
}

// ------------------------------------------------------------------ endpoints, config, files, resources

/** URL path written in the docs (`/app/*`, `/rest/*`, `../api/v1/docs`, `/app/security?auth=…`). */
export function parseEndpoint(t: string): string | null {
  let s = t.trim();
  if (s.startsWith('../')) s = s.replace(/^(\.\.\/)+/, '/');
  if (!s.startsWith('/') || s.startsWith('/{') || s.length < 2) return null;
  s = s.split('?')[0].replace(/<[^>]+>/g, '…');
  if (!/^\/[\w.*{}…\-/]+$/.test(s)) return null;
  if (/\.java$/.test(s)) return null;
  return s;
}

/** `-Dwebapp.nojob.alert=true` → `-Dwebapp.nojob.alert` (values are never kept). */
export function parseJvmProperty(t: string): string | null {
  const m = t.trim().match(/^(-D[a-z][\w.]*[\w])(?:[=|].*)?$/);
  return m ? m[1] : null;
}

/** Repository file (configuration, resource, script…). Identity: basename, except for sibling `lia-*` projects. */
export function parseFile(t: string, extensions: string[]): { id: string; label: string; path: string; ext: string } | null {
  const s = splitLines(t.trim()).path.split('?')[0].replace(/^\$\{[^}]+\}\//, '');
  if (/\s/.test(s) || /[<>]/.test(s) || s.startsWith('.') || s.startsWith('/')) return null;
  const m = s.match(/\.([A-Za-z0-9]+)$/);
  if (!m || !extensions.includes(m[1])) return null;
  const segs = s.split('/');
  const base = segs[segs.length - 1];
  if (base.startsWith('.') || base.startsWith('*') || base.length < 4 || /(^|_)X\.[a-z]+$/.test(base)) return null; // ce_X.xml is a placeholder
  const keep = segs.length > 1 && /^lia-/.test(segs[0]) && !segs.includes('...') && !segs.includes('…');
  const id = keep ? s : base;
  return { id: `file:${id}`, label: id, path: s, ext: m[1] };
}

/** XML resource folder (dd_lia, ce_redalia2021, rt_lia, dl_lia_fr_BE, ce_*) — prefixes read from 12 §6.1. */
export function parseResource(t: string, prefixes: string[]): string | null {
  const s = t.trim().replace(/\/+$/, '');
  const last = s.split('/').pop() ?? '';
  if (/\.[a-z]+$/i.test(last) || /[<>]/.test(last)) return null;
  const re = new RegExp(`^(?:${prefixes.map((p) => p.replace(/_$/, '')).join('|')})_[A-Za-z0-9_*]+$`);
  return re.test(last) ? last : null;
}
