import { readFileSync } from 'node:fs';
import type { Confidence, NodeType } from '../../src/types/graph';

/** Alias dictionary entry (systems, technologies). Kept only if an alias is really found in the docs. */
export interface DictEntry {
  id: string;
  label: string;
  /** systems: demat, publicite, reglementaire, signature, ged, ia, externe, identite, messagerie, outil, database
   *  tech: langage, build, serveur, interface, api, persistance, workflow, planification, cache, script, document, securite, journal, interne, sgbd, frontend, outil */
  category: string;
  aliases: string[];
}

/** A section of one doc: file prefix ("05-") + heading pattern (matched on any heading of the line's path). */
export interface SectionRef {
  file: string;
  heading: string;
}

export interface LifecycleDef extends SectionRef {
  id: string;
  label: string;
  /** table: rows "code | libellé" · table-pairs: "code | libellé | code | libellé" · inline-dots: "0 a · 1 b"
   *  colon-list: "… : a, b, c" (labels only) · colon-codes: "… : 0 a, 1 b" · paren: "a (0), « b » (2)"
   *  arrow: "`3 en cours` → `onValidateActe` → `5 validé`" · spans: backtick spans after the colon */
  parser: 'table' | 'table-pairs' | 'inline-dots' | 'colon-list' | 'colon-codes' | 'paren' | 'arrow' | 'spans';
  /** Regex selecting the line inside the section (first match). */
  linePattern?: string;
  /** Column / attribute that stores the state, as written in the docs. */
  column?: string;
  /** Table order (or enumeration order) read as transitions — always tagged [H]. */
  orderInferred?: boolean;
  /** Recognise this lifecycle's codes elsewhere: `guard` must match the line, `code` (global regex, group 1) gives the code. */
  mention?: { guard: string; code: string; byLabel?: boolean };
  note?: string;
}

export interface WorkflowDef extends SectionRef {
  id: string;
  label: string;
  parser: 'ordered-list' | 'table' | 'diagram';
}

export interface DeclaredDef {
  id: string;
  label: string;
  file: string;
  /** Regex with one capture group: the declared number. */
  pattern: string;
  type: NodeType;
  /** Optional filter on the counted nodes (subtype or package prefix). */
  subtype?: string;
}

export interface CartoConfig {
  projectLabel: string;
  title: string;
  /** Knowledge-base folder (13 Markdown docs), relative to this config file. */
  docsDir: string;
  /** Provenance paths are written relative to this folder (relative to this config file). */
  provenanceRoot: string;
  scopeNote: string;
  java: {
    packageRoots: string[];
    sourceRoots: string[];
    /** JDK / JPA / library classes that are not LiaWeb code (never become nodes). */
    ignoreClasses: string[];
    /** Class-kind overrides justified by a doc line (e.g. MountPage = constants, 02:73). */
    kindOverrides: Record<string, string>;
    /** Column headers / words that make a bare CamelCase span a class. */
    classCues: string;
  };
  docs: {
    legendLinePattern: string;
    /** Section headings read with a doc-specific legend (10:3 « Confirmé = constaté à la lecture du code »). */
    legendSections: (SectionRef & { confidence: Confidence; where: string })[];
    /** "Sauf mention contraire, les paquets/chemins sont sous `src/com/ordiges/`" */
    docBasePattern: string;
    project: SectionRef;
    sourceRoots: SectionRef[];
    tablePrefixes: SectionRef;
    resourcePrefixes: SectionRef;
    views: SectionRef;
    entities: SectionRef;
    schemaChain: { file: string; pattern: string };
    columnPrefixes: { file: string; pattern: string };
    singleDatasource: { file: string; pattern: string };
    objects: SectionRef;
    bricks: SectionRef & { ambiguous: string[] };
    licences: { file: string; heading: string; listPattern: string };
    actCodes: SectionRef;
    modules: { file: string; parts: string[] };
    techTable: SectionRef;
    restTable: SectionRef & { prefixPattern: string };
    filters: SectionRef;
    migrationTree: SectionRef;
    migrationSections: SectionRef[];
    workflows: WorkflowDef[];
    lifecycles: LifecycleDef[];
    stateSetters: SectionRef[];
    rules: (SectionRef & { subtype: string })[];
    issues: { file: string };
    questionsHeading: string;
    glossary: { file: string; absentHeading: string };
    conventions: (SectionRef & { subtype: string; parser: 'table' | 'list' })[];
  };
  declared: DeclaredDef[];
  files: { extensions: string[] };
  systems: DictEntry[];
  tech: DictEntry[];
}

export function loadConfig(path: string): CartoConfig {
  return JSON.parse(readFileSync(path, 'utf8')) as CartoConfig;
}
