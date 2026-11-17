import type { Confidence, NodeType, Relation } from '../types/graph';

/** Eight color families (validated categorical palette, fixed order) — each type adds a shape as secondary encoding. */
export type Family = 'code' | 'store' | 'system' | 'config' | 'business' | 'knowledge' | 'structure' | 'risk';

export const FAMILY: Record<Family, { label: string; light: string; dark: string; cssVar: string }> = {
  code: { label: 'Code Java', light: '#7eb2ee', dark: '#7eb2ee', cssVar: '--t-code' },
  store: { label: 'Données & migrations', light: '#f5a97f', dark: '#f0a27a', cssVar: '--t-store' },
  system: { label: 'Systèmes & API', light: '#74cc9b', dark: '#6fc496', cssVar: '--t-system' },
  config: { label: 'Configuration & licences', light: '#f2cd5c', dark: '#e9c55a', cssVar: '--t-config' },
  business: { label: 'Métier & cycles de vie', light: '#f3a0c0', dark: '#ee9cbc', cssVar: '--t-business' },
  knowledge: { label: 'Connaissance', light: '#a8b0ba', dark: '#9aa2ac', cssVar: '--t-knowledge' },
  structure: { label: 'Structure & technologies', light: '#7fcac6', dark: '#78c2be', cssVar: '--t-structure' },
  risk: { label: 'Risques', light: '#ef8a8a', dark: '#ec8585', cssVar: '--t-risk' },
};

export interface TypeMeta {
  label: string;
  plural: string;
  family: Family;
  shape: string; // cytoscape shape
}

export const TYPE: Record<NodeType, TypeMeta> = {
  project: { label: 'Projet', plural: 'Projet', family: 'structure', shape: 'star' },
  sourceRoot: { label: 'Racine du dépôt', plural: 'Racines du dépôt', family: 'structure', shape: 'cut-rectangle' },
  module: { label: 'Module fonctionnel', plural: 'Modules', family: 'structure', shape: 'round-pentagon' },
  brick: { label: 'Brique produit', plural: 'Briques produit', family: 'structure', shape: 'round-octagon' },
  tech: { label: 'Technologie', plural: 'Technologies', family: 'structure', shape: 'round-tag' },
  package: { label: 'Paquet Java', plural: 'Paquets', family: 'code', shape: 'round-rectangle' },
  page: { label: 'Page Wicket', plural: 'Pages Wicket', family: 'code', shape: 'rectangle' },
  service: { label: 'Service', plural: 'Services', family: 'code', shape: 'hexagon' },
  class: { label: 'Classe Java', plural: 'Classes', family: 'code', shape: 'ellipse' },
  object: { label: 'Objet du moteur LIA', plural: 'Objets moteur', family: 'code', shape: 'octagon' },
  table: { label: 'Table', plural: 'Tables', family: 'store', shape: 'barrel' },
  view: { label: 'Vue SQL', plural: 'Vues', family: 'store', shape: 'round-diamond' },
  migration: { label: 'Migration dbupdate', plural: 'Migrations', family: 'store', shape: 'round-tag' },
  config: { label: 'Propriété de configuration', plural: 'Configuration', family: 'config', shape: 'hexagon' },
  file: { label: 'Fichier du dépôt', plural: 'Fichiers', family: 'config', shape: 'rectangle' },
  licence: { label: 'Licence', plural: 'Licences', family: 'config', shape: 'tag' },
  system: { label: 'Système externe', plural: 'Systèmes', family: 'system', shape: 'round-rectangle' },
  endpoint: { label: 'Point d’entrée URL', plural: 'Points d’entrée', family: 'system', shape: 'diamond' },
  workflow: { label: 'Enchaînement', plural: 'Enchaînements', family: 'business', shape: 'round-diamond' },
  step: { label: 'Étape', plural: 'Étapes', family: 'business', shape: 'round-rectangle' },
  lifecycle: { label: 'Cycle de vie', plural: 'Cycles de vie', family: 'business', shape: 'round-octagon' },
  state: { label: 'État / statut', plural: 'États', family: 'business', shape: 'ellipse' },
  actCode: { label: 'Type d’acte', plural: 'Types d’actes', family: 'business', shape: 'tag' },
  rule: { label: 'Règle / expertise', plural: 'Règles', family: 'business', shape: 'rhomboid' },
  resource: { label: 'Ressource XML (dd_/ce_)', plural: 'Ressources XML', family: 'business', shape: 'barrel' },
  term: { label: 'Terme du glossaire', plural: 'Glossaire', family: 'knowledge', shape: 'vee' },
  convention: { label: 'Convention', plural: 'Conventions', family: 'knowledge', shape: 'round-rectangle' },
  doc: { label: 'Document', plural: 'Documents', family: 'knowledge', shape: 'rectangle' },
  issue: { label: 'Problème connu', plural: 'Problèmes', family: 'risk', shape: 'triangle' },
  question: { label: 'Question ouverte', plural: 'Questions', family: 'risk', shape: 'round-triangle' },
};

export const TYPE_ORDER: NodeType[] = [
  'project', 'module', 'brick', 'sourceRoot', 'package', 'page', 'service', 'class', 'object',
  'table', 'view', 'migration', 'system', 'endpoint', 'tech', 'config', 'file', 'licence', 'resource',
  'workflow', 'step', 'lifecycle', 'state', 'actCode', 'rule', 'issue', 'question', 'convention', 'term', 'doc',
];

export interface RelMeta {
  label: string;
  style: 'solid' | 'dashed' | 'dotted';
  arrow: boolean;
  weight: number; // visual width
  structural?: boolean;
  data?: boolean;
}

export const REL: Record<Relation, RelMeta> = {
  contains: { label: 'contient', style: 'solid', arrow: false, weight: 0.8, structural: true },
  'part-of': { label: 'fait partie de', style: 'solid', arrow: true, weight: 0.8, structural: true },
  sequence: { label: 'puis (enchaînement écrit)', style: 'solid', arrow: true, weight: 1.6 },
  transition: { label: 'transition d’état', style: 'solid', arrow: true, weight: 1.8 },
  'sets-state': { label: 'positionne l’état', style: 'dashed', arrow: true, weight: 1.4 },
  'maps-to': { label: 'correspond à la table', style: 'solid', arrow: true, weight: 1.4, data: true },
  reads: { label: 'lit', style: 'solid', arrow: true, weight: 1.4, data: true },
  writes: { label: 'écrit', style: 'solid', arrow: true, weight: 1.4, data: true },
  creates: { label: 'crée / recrée', style: 'solid', arrow: true, weight: 1.4, data: true },
  drops: { label: 'supprime', style: 'dashed', arrow: true, weight: 1.2, data: true },
  calls: { label: 'appelle', style: 'solid', arrow: true, weight: 1.4, data: true },
  exposes: { label: 'expose', style: 'solid', arrow: true, weight: 1.4, data: true },
  'applies-to': { label: 's’applique à', style: 'dashed', arrow: true, weight: 1.2 },
  uses: { label: 'utilise (même phrase)', style: 'dotted', arrow: true, weight: 1 },
  configures: { label: 'configure', style: 'dotted', arrow: true, weight: 1 },
  'licensed-by': { label: 'sous licence', style: 'dotted', arrow: true, weight: 1 },
  recommends: { label: 'recommande', style: 'dashed', arrow: true, weight: 1 },
  implements: { label: 'met en œuvre', style: 'dashed', arrow: true, weight: 1 },
  defines: { label: 'définit', style: 'dotted', arrow: true, weight: 1 },
  mentions: { label: 'mentionne', style: 'dotted', arrow: false, weight: 0.7 },
  affects: { label: 'concerne', style: 'dashed', arrow: true, weight: 1 },
  'flows-to': { label: 'vers (déduit)', style: 'dashed', arrow: true, weight: 1.1, data: true },
  'documented-in': { label: 'documenté dans', style: 'dotted', arrow: false, weight: 0.6 },
};

export const CONF: Record<Confidence, { label: string; long: string; color: string }> = {
  V: { label: 'V', long: 'Vérifié dans le code', color: 'var(--good)' },
  H: { label: 'H', long: 'Hypothèse à confirmer', color: 'var(--warning)' },
};
export const CONF_KEYS: Confidence[] = ['V', 'H'];

/** Issue categories of 10 (no severity scale in the LiaWeb docs: category + status). */
export const ISSUE_CAT: Record<string, { label: string; color: string }> = {
  Bug: { label: 'Bug', color: 'var(--critical)' },
  Sécurité: { label: 'Sécurité', color: 'var(--critical)' },
  'Secret dans un fichier suivi': { label: 'Secret (emplacement)', color: 'var(--serious)' },
  'Dette technique': { label: 'Dette', color: 'var(--warning)' },
  'Dépendance ancienne': { label: 'Dépendance', color: 'var(--warning)' },
  'Limite de l’analyse': { label: 'Limite', color: 'var(--muted)' },
};

export const SYSTEM_CAT: Record<string, string> = {
  database: 'Base de données',
  demat: 'Plateformes de dématérialisation',
  publicite: 'Publicité',
  reglementaire: 'Flux réglementaires et conformité',
  signature: 'Parapheur et signature',
  ged: 'GED',
  ia: 'Intelligence artificielle',
  externe: 'Autres appels sortants',
  identite: 'Identité',
  messagerie: 'Messagerie',
  outil: 'Outils de développement',
};

export function familyColor(type: NodeType, theme: 'light' | 'dark'): string {
  const f = FAMILY[TYPE[type].family];
  return theme === 'dark' ? f.dark : f.light;
}

export const METHOD_LABEL: Record<string, string> = {
  mention: 'Mention dans la documentation',
  'arrow-chain': 'Enchaînement « A → B » écrit dans la doc',
  'same-clause': 'Même proposition (rattachement au sujet qui précède)',
  'same-clause:leading': 'Même proposition (sujet qui suit)',
  'table-row': 'Même ligne d’un tableau de la doc',
  'project-identity': 'Identité du projet (00 §1)',
  'source-root-table': 'Tableau des racines du dépôt (03 §1, 02 §2)',
  'module-heading': 'Titre de module (04)',
  'module-section': 'Cité dans la section du module (04)',
  'brick-table': 'Tableau des briques produit (01 §2)',
  'licence-list': 'Liste des licences (01 §2)',
  'act-family-table': 'Tableau des familles d’actes (04)',
  'object-table': 'Codes d’objets du moteur LIA (11 §1)',
  'entity-table': 'Tableau des entités centrales (05 §3.2)',
  'table-inventory': 'Inventaire complet des tables (05 §3.5) ou rattachement des vues (05 §3.3)',
  'table-inventory:dropped': 'Tables supprimées par une migration (05 §3.5)',
  'table-inventory:no-script': 'Noms du dictionnaire sans script de création (05 §3.5)',
  'rest-table': 'Tableau des ressources REST (06 §5.2)',
  'migration-path': 'Chemin de migration (dossier / script)',
  'single-datasource': 'Source de données unique (05 §1)',
  'structure:url-prefix': 'Préfixe d’URL (/app/x sous /app/*)',
  'structure:package-parent': 'Paquet parent (nom qualifié)',
  'path:package': 'Paquet donné par le chemin ou le nom qualifié',
  'path:package-inferred': 'Paquet déduit d’un chemin relatif [H]',
  'path:root': 'Racine donnée par le chemin',
  'section-heading-root': 'Racine nommée dans le titre de section',
  'workflow-heading': 'Titre d’enchaînement',
  'workflow-step': 'Étape d’enchaînement (liste numérotée ou tableau)',
  'workflow-diagram': 'Élément du diagramme ASCII (07 §1)',
  'workflow-order': 'Ordre des étapes',
  'diagram-arrow': 'Flèche du diagramme ASCII (──►, ◄──, ▼)',
  'lifecycle-heading': 'Titre de cycle de vie (07)',
  'lifecycle-definition': 'Autre définition du même cycle',
  'lifecycle-state': 'État listé dans la doc',
  'lifecycle-arrow': 'Transition écrite « A → B »',
  'lifecycle-order:inferred': 'Ordre du tableau lu comme transition [H]',
  'state-setter:line': 'Positionne l’état (même ligne)',
  'state-setter:intro': 'Positionne l’état (phrase d’introduction de la liste)',
  'state-setter:heading': 'Positionne l’état (titre de section)',
  'rule-item': 'Règle listée (01 §6, 07 §4)',
  'issue-row': 'Problème connu (10)',
  'question-item': 'Question pour l’équipe',
  'glossary-row': 'Entrée du glossaire (11)',
  'convention-item': 'Convention (12, 09 §2)',
  'declared-count': 'Compte déclaré dans la doc',
  'doc-file': 'Fichier de documentation',
};

export function methodLabel(m: string): string {
  return METHOD_LABEL[m] ?? m;
}
