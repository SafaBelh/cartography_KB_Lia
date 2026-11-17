import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildOutputs } from '../scripts/lib/pipeline';

const ROOT = resolve(__dirname, '..');
const tmp: string[] = [];
afterAll(() => tmp.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('section « Questions pour l’équipe » (fixture synthétique)', () => {
  it('crée une question par item numéroté, reliée aux entités citées sur sa ligne', () => {
    const dir = mkdtempSync(join(tmpdir(), 'liaweb-q-'));
    tmp.push(dir);
    writeFileSync(
      join(dir, '05-database.md'),
      [
        '# 05 — Base',
        '',
        '## 3.1 Conventions de nommage',
        '',
        '| Préfixe | Domaine |',
        '|---|---|',
        '| `PRJ` | Projet |',
        '',
        '## 7. Questions pour l\'équipe',
        '',
        '1. Le script `dbu6109001.sql` met-il à jour `PRJ_PROJET` ?',
        '2. Faut-il garder `com.ordiges.projet.ProjetService` ?',
        '',
      ].join('\n'),
    );
    const cfgPath = join(dir, 'mini.config.json');
    const cfg = JSON.parse(require('node:fs').readFileSync(join(ROOT, 'cartography.config.json'), 'utf8'));
    cfg.docsDir = '.';
    cfg.provenanceRoot = '.';
    delete cfg.docFiles;
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const { graph } = buildOutputs({ configPath: cfgPath, now: '2026-01-01T00:00:00.000Z' });
    const q1 = graph.nodes.find((n) => n.id === 'q:05-1')!;
    expect(q1.type).toBe('question');
    expect(q1.provenance[0]).toMatchObject({ line: 11, method: 'question-item', confidence: 'H', confidenceFrom: 'fallback' });
    const affects = (q: string) => graph.edges.filter((e) => e.source === q && e.relation === 'affects').map((e) => e.target).sort();
    expect(affects('q:05-1')).toEqual(['mig:dbu6109001.sql', 'tbl:PRJ_PROJET']);
    expect(affects('q:05-2')).toEqual(['svc:ProjetService']);
    expect(graph.nodes.filter((n) => n.type === 'question')).toHaveLength(2);
  });
});

describe('cohérence avec la base de connaissances LiaWeb', () => {
  const { graph, stats, docs } = buildOutputs({ configPath: join(ROOT, 'cartography.config.json'), now: '2026-01-01T00:00:00.000Z' });
  const node = (id: string) => graph.nodes.find((n) => n.id === id);
  const rel = (s: string, t: string) => graph.edges.filter((e) => e.source === s && e.target === t).map((e) => e.relation);

  it('passe tous les contrôles intégrés', () => {
    for (const c of stats.checks) expect(c.status === 'fail' ? `${c.id}: ${c.actual} ${c.note ?? ''}` : 'ok').toBe('ok');
    expect(graph.meta.mode).toBe('docs-only');
    expect(stats.docOnlyNodes).toBe(stats.nodes);
  });

  it('retrouve les briques structurantes nommées par la doc', () => {
    expect(docs.docs).toHaveLength(13);
    expect(stats.byType.module).toBe(17); // titres de niveau 3 des parties A et B de 04
    expect(graph.nodes.filter((n) => n.type === 'workflow')).toHaveLength(11);
    expect(graph.nodes.filter((n) => n.type === 'question')).toHaveLength(61); // 39 items des sections « Questions » (dont 8 en 05 régénéré) + 22 (10 §4)
    expect(graph.nodes.filter((n) => n.type === 'issue' && /^issue:[BS]\d+$/.test(n.id))).toHaveLength(32); // B1–B9, S1–S23
    expect(node('svc:ProjetCreateService')?.props.paquet).toBe('com.ordiges.projet.service');
    expect(node('page:ClotureMarchePage')).toBeDefined();
    expect(node('cls:BaseWebApplication')?.props.paquet).toBe('com.wtrace.wapp');
    expect(node('obj:fprj')).toBeDefined();
  });

  it('relie entités et tables d’après 05 §3.2 et 11 §1', () => {
    expect(rel('cls:Marche', 'tbl:MARC_MARCHE')).toContain('maps-to');
    expect(rel('obj:fcns', 'tbl:CNS_CONSULTATION')).toContain('maps-to');
    expect(rel('mig:maj0001.sql', 'view:VUE_AUTENTIF')).toContain('creates');
    expect(rel('mig:maj99', 'view:VUE_AUTENTIF')).toEqual([]); // le dossier d'un chemin n'est pas acteur de la phrase
  });

  it('lit le 05 régénéré (et lui seul) et son inventaire complet des tables (05 §3.5)', () => {
    expect(docs.docs.find((d) => d.id === '05')?.file).toBe('05-database-documentation-new.md');
    const live = graph.nodes.filter((n) => n.type === 'table' && n.subtype === 'table');
    expect(live).toHaveLength(351);
    expect(graph.nodes.filter((n) => n.type === 'view')).toHaveLength(17);
    // bilan de 05 §3.5 : 236 + 63 + 31 + 21
    const by = (k: string) => live.filter((n) => n.props.rattachement === k).length;
    expect([by('entité JPA et objet du moteur'), by('entité JPA seulement'), by('objet du moteur seulement'), by('ni entité ni objet')]).toEqual([236, 63, 31, 21]);
    // une ligne = entité maps-to, objets maps-to, script creates
    expect(rel('cls:PrjSousCritere', 'tbl:PRJ_SOUS_CRITERE')).toContain('maps-to');
    expect(rel('obj:SousCritere', 'tbl:PRJ_SOUS_CRITERE')).toContain('maps-to');
    expect(rel('mig:dbu6102001.sql', 'tbl:PRJ_SOUS_CRITERE')).toContain('creates');
    expect(rel('mig:init', 'tbl:PRJ_PROJET')).toContain('creates');
    expect(node('tbl:PRJ_SOUS_CRITERE')?.props).toMatchObject({ prefixe: 'PRJ', domaine: 'Projet (préparation de la consultation)', statut: 'en place' });
    expect(node('tbl:DASHBOARD')?.props.prefixe).toBe('—');
    expect(rel('cls:VueUtilisateur', 'view:VUE_UTILISATEUR')).toContain('maps-to');
    // lignes non étiquetées : le [V] de « Relevé du 17/11/2026 … [V] : » qualifie l'inventaire
    const p = node('tbl:PRJ_SOUS_CRITERE')!.provenance.find((x) => x.method === 'table-inventory')!;
    expect(p).toMatchObject({ confidence: 'V', confidenceFrom: 'section' });
    // tables supprimées : hors source de données, script drops, objet qui la cite encore
    const dropped = graph.nodes.filter((n) => n.props.statut === 'supprimée');
    expect(dropped).toHaveLength(24);
    expect(rel('mig:dbu6105007.sql', 'tbl:MARC_ACTE')).toContain('drops');
    expect(rel('obj:mact', 'tbl:MARC_ACTE')).toContain('maps-to');
    expect(rel('tbl:MARC_ACTE', 'sys:db')).toEqual([]);
    expect(rel('tbl:PRJ_PROJET', 'sys:db')).toContain('part-of');
    // noms du dictionnaire sans script : [H] comme leur ligne
    const never = graph.nodes.filter((n) => n.props.statut === 'jamais créée');
    expect(never.map((n) => n.label).sort()).toEqual(['ADC_CODEPROG', 'EDM_MSGEMIS', 'EDM_ORGANE', 'EDM_SESSIONECHANGE', 'MO.MO', 'MO.MOOPERATION']);
    for (const n of never) expect(n.confidence).toBe('H');
  });

  it('construit les cycles de vie de 07 avec transitions explicites et déduites [H]', () => {
    const t = graph.edges.find((e) => e.id === 'transition:state:acte/3->state:acte/5')!;
    expect(t.label).toBe('onValidateActe');
    expect(t.confidence).toBe('V');
    const inferred = graph.edges.find((e) => e.id === 'transition:state:projet-etape/preparation->state:projet-etape/redaction')!;
    expect(inferred.confidence).toBe('H');
    expect(inferred.provenance[0].method).toBe('lifecycle-order:inferred');
    expect(rel('page:ClotureMarchePage', 'state:marche-etat/5')).toContain('sets-state');
    expect(rel('act:RESI_MAR', 'state:marche-etat/6')).toContain('sets-state');
    expect(node('lc:suivi-consultation')?.props.note).toMatch(/13 libellés.*n'est pas documentée/);
  });

  it('suit le diagramme ASCII de 07 §1 (flèches et ▼)', () => {
    const seq = (a: string, b: string) => rel(`wf:cycle-global/${a}`, `wf:cycle-global/${b}`);
    expect(seq('recensement', 'programmation')).toContain('sequence');
    expect(seq('notification', 'marche')).toContain('sequence'); // « Marché ◄── Notification »
    expect(seq('marche', 'actes-os')).toContain('sequence'); // flèche verticale
  });

  it('ne garde des secrets que l’emplacement et la nature', () => {
    const secrets = graph.nodes.filter((n) => n.props.categorie === 'Secret dans un fichier suivi');
    expect(secrets.length).toBe(13);
    for (const s of secrets) expect(s.props.valeur).toBe('non reproduite (10:5)');
    for (const n of graph.nodes) if (n.type === 'config') expect(n.label).not.toMatch(/=/);
  });

  it('ne garde que les entrées du dictionnaire réellement citées et indique la règle de chaque arête', () => {
    for (const n of graph.nodes.filter((x) => x.type === 'system' || x.type === 'tech')) expect(n.provenance.some((p) => p.method === 'mention')).toBe(true);
    for (const e of graph.edges) for (const p of e.provenance) expect(p.metadata?.rule).toBe(p.method);
    // toute déduction de l'extracteur est [H]
    for (const e of graph.edges) for (const p of e.provenance) if (/inferred/.test(p.method)) expect(p.confidence).toBe('H');
  });
});
