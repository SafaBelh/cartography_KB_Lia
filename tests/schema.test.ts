import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildSchema } from '../src/lib/schema';
import type { DocsBundle, GNode, Graph } from '../src/types/graph';

const graph = JSON.parse(readFileSync(new URL('../data/graph.json', import.meta.url), 'utf8')) as Graph;
const docs = JSON.parse(readFileSync(new URL('../data/docs.json', import.meta.url), 'utf8')) as DocsBundle;
const schema = buildSchema(graph, docs);
const all = [...schema.groups.flatMap((g) => g.tables), ...schema.views];
const table = (label: string) => all.find((t) => t.node.label === label)!;
const docLine = (doc: string, line: number) => docs.docs.find((d) => d.id === doc)!.markdown.split('\n')[line - 1];

describe('schéma (vue Base de données)', () => {
  it('rattache chaque table à la source de données unique uniquement via une arête part-of du graphe', () => {
    expect(schema.database?.id).toBe('sys:db');
    for (const t of all) {
      expect(t.storeEdge?.relation).toBe('part-of');
      expect(t.storeEdge?.target).toBe('sys:db');
    }
    expect(schema.declaredTables?.count).toBe(351);
  });

  it('montre les 351 tables en place de 05 §3.5 et met à part tables supprimées et noms jamais créés', () => {
    expect(schema.stats.tables).toBe(351);
    expect(schema.stats.views).toBe(17);
    expect(schema.stats.byBinding).toEqual({ 'entité JPA et objet du moteur': 236, 'entité JPA seulement': 63, 'objet du moteur seulement': 31, 'ni entité ni objet': 21 });
    expect(schema.retired).toHaveLength(30); // 24 supprimées + 6 sans script
    for (const t of schema.retired) expect(t.storeEdge).toBeUndefined();
    expect(all.some((t) => t.node.props.statut === 'supprimée')).toBe(false);
    expect(schema.groups.find((g) => g.prefix === 'NEGO')?.domain).toBe('Négociation (candidatures, offres, réunions)');
  });

  it('range les tables par préfixe de 05 §3.1', () => {
    const marc = schema.groups.find((g) => g.prefix === 'MARC')!;
    expect(marc.domain).toBe('Marché, exécution');
    expect(marc.tables.map((t) => t.node.label)).toContain('MARC_MARCHE');
    expect(schema.views.map((v) => v.node.label)).toContain('VUE_AUTENTIF');
  });

  it('lit clé et colonnes de liaison de 05 §3.2 : PK seulement dans la colonne « Clé »', () => {
    const mm = table('MARC_MARCHE').columns;
    expect(mm.find((c) => c.name === 'MARM_IDENTIFIANT')).toMatchObject({ pk: true, link: false });
    expect(mm.find((c) => c.name === 'FPRJ_IDENTIFIANT')).toMatchObject({ pk: false, link: true });
    expect(table('CNS_CANDIDAT').columns.filter((c) => c.pk).map((c) => c.name).sort()).toEqual(['CCDT_CODE', 'FPRJ_IDENTIFIANT']);
    expect(table('CNS_OFFRE').columns).toEqual([]);
    expect(table('CNS_OFFRE').keyNote?.text).toMatch(/composite/);
    // REC_EXERCICE/REC_BESOIN/REC_OPERATION ↔ EXC_ID/BES_ID/OPE_ID, appariés dans l'ordre
    expect(table('REC_BESOIN').columns.map((c) => c.name)).toEqual(['BES_ID']);
  });

  it('lit UPDATE … SET … WHERE et TABLE.COLONNE, sans prendre WHERE pour une clé', () => {
    const c = table('LBT_COMPTE').columns;
    expect(c.find((x) => x.name === 'LCMP_NUMVER')!.sql).toEqual(['SET']);
    expect(c.find((x) => x.name === 'LCMP_IDENTIFIANT')!.sql).toEqual(['WHERE']);
    expect(table('MTR_INSTANCE').columns.map((x) => x.name)).toEqual(['MTRI_DATA']);
    expect(table('MTR_INSTANCE').columns[0].pk).toBe(false);
  });

  it('marque [H] les colonnes rattachées par la seule convention de préfixe', () => {
    const fp = table('PRJ_PROJET').columns.find((c) => c.name === 'FPRJ_STAGENAME')!;
    expect(fp.inferred).toBe(true);
    expect(fp.sources.every((s) => s.rule === 'column-prefix')).toBe(true);
  });

  it('ne prend jamais une liste de codes, de classes ou de tables pour des colonnes', () => {
    const tbl = graph.nodes.find((n) => n.id === 'tbl:MARC_MARCHE')!;
    const fake: Graph = { ...graph, nodes: [...graph.nodes] };
    const bundle: DocsBundle = {
      generatedAt: docs.generatedAt,
      docs: [
        {
          id: '99',
          file: '99-test.md',
          title: 'test',
          sections: [],
          lineNodes: {},
          markdown: [
            '- `MARC_MARCHE` (`AV_MT_MAR`, `NT_MAR`) : codes d’actes',
            '- `MARC_MARCHE` (`ProjetCreateService`, `MarcheService`)',
            '- `MARC_MARCHE` (`PRJ_LOT`, `PRJ_PROJET`)',
            '- `MARC_MARCHE` (`MARM_EXEMPLE`, `MARM_AUTRE`)',
          ].join('\n'),
        },
      ],
    };
    const s = buildSchema(fake, bundle);
    const cols = [...s.groups.flatMap((g) => g.tables)].find((t) => t.node.id === (tbl as GNode).id)!.columns.map((c) => c.name);
    expect(cols).toEqual(['MARM_AUTRE', 'MARM_EXEMPLE']); // seule la dernière ligne est une liste de colonnes
  });

  it('cite pour chaque colonne une ligne de doc qui contient bien son nom', () => {
    let n = 0;
    for (const t of all)
      for (const c of t.columns)
        for (const s of c.sources) {
          expect(docLine(s.doc, s.line)).toContain(c.name);
          if (s.rule !== 'column-prefix') expect(docLine(s.doc, s.line)).toContain(t.node.label.split('_')[0]);
          n++;
        }
    expect(n).toBeGreaterThan(40);
  });

  it('n’invente ni clé étrangère ni accès ; liens de table seulement depuis la « Chaîne principale » de 05', () => {
    expect(schema.stats.fks).toBe(0);
    const ids = new Set(graph.edges.map((e) => e.id));
    for (const t of all) for (const a of t.access) {
      expect(ids.has(a.edge.id)).toBe(true);
      expect(a.edge.target).toBe(t.node.id);
    }
    expect(schema.links.length).toBe(9);
    for (const l of schema.links) expect(docLine(l.source.doc, l.source.line)).toMatch(/Chaîne principale/);
    expect(schema.links.find((l) => l.from === 'Projet' && l.to === 'Consultation')).toMatchObject({ card: '1-1', fromTable: 'tbl:PRJ_PROJET', toTable: 'tbl:CNS_CONSULTATION' });
    expect(schema.links.find((l) => l.from === 'Projet' && l.to === 'Lot')?.toTable).toBeUndefined(); // « Lot » = flot ou flcs : non résolu
  });
});
