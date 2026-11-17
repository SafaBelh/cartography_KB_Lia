/**
 * Shared data model between the extractor (scripts/) and the UI (src/).
 * Keep this file dependency-free: it is imported from Node and from the browser.
 */

/** Confidence legend of the LiaWeb knowledge base (00:4): V = vérifié dans le code, H = hypothèse à confirmer.
 *  Mixed tags ("[V pour X, H pour Y]") resolve to the weakest. */
export type Confidence = 'V' | 'H';

export type NodeType =
  // structure
  | 'project'
  | 'sourceRoot'
  | 'module'
  | 'brick'
  | 'tech'
  // code
  | 'package'
  | 'page'
  | 'service'
  | 'class'
  | 'object'
  // data
  | 'table'
  | 'view'
  | 'migration'
  // configuration
  | 'config'
  | 'file'
  | 'licence'
  // systems
  | 'system'
  | 'endpoint'
  // business
  | 'workflow'
  | 'step'
  | 'lifecycle'
  | 'state'
  | 'actCode'
  | 'rule'
  | 'resource'
  // knowledge
  | 'term'
  | 'convention'
  | 'doc'
  // risks
  | 'issue'
  | 'question';

export type Relation =
  | 'contains' // project → module, root → package, package → class, module → page/table…
  | 'part-of' // step → workflow, state → lifecycle, table → database, endpoint → endpoint prefix
  | 'sequence' // step → step, class → class (doc arrow "A → B")
  | 'transition' // state → state (doc arrow, or table order [H])
  | 'sets-state' // class / act code → state
  | 'maps-to' // JPA entity / engine object → table
  | 'reads'
  | 'writes'
  | 'creates' // migration → view/table, class → table ("crée")
  | 'calls' // code → external system / code → code ("appelle")
  | 'exposes' // REST resource / servlet → endpoint
  | 'applies-to' // servlet filter → URL pattern
  | 'uses' // code → table/tech/config (same clause, no verb)
  | 'configures' // config property → class / system
  | 'licensed-by' // brick → licence
  | 'recommends' // UI / code convention → class
  | 'implements' // technical node → workflow step / rule
  | 'defines' // glossary term → node
  | 'mentions' // weak link (glossary "Où", rule text …)
  | 'affects' // issue / question → node
  | 'flows-to' // generic arrow between non-code entities [H]
  | 'documented-in'; // doc → node

export interface Provenance {
  kind: 'doc' | 'config';
  /** Path relative to the LiaWeb folder (LIAWEB_knowledge_base/docs/project-knowledge/<file>). */
  file: string;
  line?: number;
  section?: string;
  /** Verbatim excerpt (trimmed). Never contains secret values. */
  snippet?: string;
  confidence: Confidence;
  /** Where the confidence tag came from. */
  confidenceFrom: 'line' | 'section' | 'legend' | 'fallback';
  /** Extraction rule that produced the fact. */
  method: string;
  /** Rule details: rule id, verb cue, raw tag text, inference note… */
  metadata?: Record<string, string>;
}

export type PropValue = string | number | boolean;

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  /** Class kind (entité, filtre…), system family, issue category, migration kind… */
  subtype?: string;
  /** Owning functional module (04) when the docs place the node in one. */
  module?: string;
  description?: string;
  props: Record<string, PropValue>;
  aliases: string[];
  confidence: Confidence;
  /** Always true here: the LiaWeb source (SVN) is not available, every node comes from the docs. */
  docOnly: boolean;
  provenance: Provenance[];
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  label?: string;
  confidence: Confidence;
  docOnly: boolean;
  provenance: Provenance[];
}

export interface DeclaredCount {
  id: string;
  label: string;
  count: number;
  /** Node type counted against the declared value. */
  type: NodeType;
  provenance: Provenance;
}

export interface GraphMeta {
  generatedAt: string;
  extractorVersion: string;
  projectLabel: string;
  title: string;
  mode: 'docs-only';
  sourceInfo: {
    loaded: false;
    note: string;
  };
  scopeNote: string;
  declared: DeclaredCount[];
  warnings: string[];
}

export interface Graph {
  meta: GraphMeta;
  nodes: GNode[];
  edges: GEdge[];
}

export interface DocSection {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  nodeIds: string[];
}

export interface DocFile {
  id: string; // "00"
  file: string; // "00-project-overview.md"
  title: string;
  markdown: string;
  sections: DocSection[];
  /** line number → node ids mentioned on that line */
  lineNodes: Record<string, string[]>;
}

export interface DocsBundle {
  generatedAt: string;
  docs: DocFile[];
}

export interface Check {
  id: string;
  label: string;
  expected: string;
  actual: string;
  status: 'pass' | 'fail' | 'n/a';
  note?: string;
}

export interface Stats {
  generatedAt: string;
  mode: GraphMeta['mode'];
  nodes: number;
  edges: number;
  byType: Record<string, number>;
  byRelation: Record<string, number>;
  byConfidence: Record<Confidence, number>;
  edgesByConfidence: Record<Confidence, number>;
  docOnlyNodes: number;
  checks: Check[];
  unmapped: { item: string; reason: string; where?: string }[];
}
