import { describe, expect, it } from 'vitest';
import { classKind, expandTableToken, parseEndpoint, parseFile, parseJavaSpan, parseJvmProperty, parseMigration, parseResource, splitLines, tableMatcher } from '../scripts/lib/java';
import { findTags, findTagsDetailed, parseMarkdown, resolveConfidence } from '../scripts/lib/markdown';

const ROOTS = ['com.wtrace', 'com.ordiges', 'fr.tracesolutions'];
const SRC = ['src', 'lia-core', 'lia-social', 'lia-redaction', 'srctest', 'test'];
const java = (t: string) => parseJavaSpan(t, ROOTS, SRC);

describe('identifiants Java', () => {
  it('lit un FQCN : paquet + classe', () => {
    expect(java('com.ordiges.liaweb.startup.StartupFilter')).toEqual([{ kind: 'class', simple: 'StartupFilter', pkg: 'com.ordiges.liaweb.startup', path: 'com.ordiges.liaweb.startup.StartupFilter' }]);
    expect(java('com.wtrace.*')).toEqual([{ kind: 'package', pkg: 'com.wtrace', path: 'com.wtrace.*' }]);
    expect(java('org.apache.wicket.protocol.http.WicketFilter')).toEqual([]); // code tiers
  });

  it('lit Classe.méthode, y compris avec arguments et new', () => {
    const r = java('BaseWebSession.get().hasDroitOf(objet, droit)')[0];
    expect(r.simple).toBe('BaseWebSession');
    expect(r.method).toBe('hasDroitOf');
    expect(java('ProjetCreateService.createProject')[0]).toMatchObject({ simple: 'ProjetCreateService', method: 'createProject' });
    expect(java('new LiaResourceModel("cle").getObject(this)')[0].simple).toBe('LiaResourceModel');
  });

  it('lit un chemin source avec lignes, un chemin élidé et un chemin relatif', () => {
    expect(java('src/com/ordiges/projet/validation/ProjetValidationService.java:45-60')[0]).toMatchObject({ simple: 'ProjetValidationService', pkg: 'com.ordiges.projet.validation', root: 'src', lines: '45-60' });
    expect(java('lia-core/src/main/java/com/ordiges/util/UUIDUtil.java')[0]).toMatchObject({ simple: 'UUIDUtil', pkg: 'com.ordiges.util', root: 'lia-core' });
    expect(java('lia-core/.../security/realm/LiaRealm.java:37-56')[0]).toMatchObject({ simple: 'LiaRealm', pkgSuffix: 'security.realm', root: 'lia-core' });
    expect(java('projet/stage/ProjetStageService.java:19-25')[0]).toMatchObject({ simple: 'ProjetStageService', pkgSuffix: 'projet.stage', relative: true });
    expect(java('SituationService.java:64, 1555-1559')[0]).toMatchObject({ simple: 'SituationService', lines: '64, 1555-1559' });
    expect(splitLines('MarcheService.java:3060-3085')).toEqual({ path: 'MarcheService.java', lines: '3060-3085' });
  });

  it('ne prend pour des classes ni les fichiers, ni les gabarits, ni les codes en capitales', () => {
    expect(java('pom.xml:1392-1397')).toEqual([]);
    expect(java('CLAUDE.md')).toEqual([]);
    expect(java('<Entité>Service')).toEqual([]);
    expect(java('FORM')).toEqual([]);
    expect(java('src/org/jbpm/pvm/internal/email/impl/')).toEqual([]);
    expect(java('java:comp/env/jdbc/liaweb')).toEqual([]);
  });

  it('classe par convention de suffixe (09 §2)', () => {
    expect(classKind('ProjetValidationPage').type).toBe('page');
    expect(classKind('ProjetCreateService').type).toBe('service');
    expect(classKind('VersAvanceAlg').subtype).toBe('algorithme de décompte');
    expect(classKind('XssSecurityFilter').subtype).toBe('filtre servlet');
    expect(classKind('Processing').bySuffix).toBe(false);
    expect(classKind('MountPage', { MountPage: 'constantes de montage' }).type).toBe('class');
  });
});

describe('tables, migrations, endpoints, configuration', () => {
  const re = tableMatcher(['PRJ', 'CNS', 'MARC', 'MARD', 'ACT', 'REC', 'LBT', 'VUE', 'JBPM4']);
  it('reconnaît une table selon les préfixes de 05 §3.1', () => {
    expect(re.test('PRJ_PROJET')).toBe(true);
    expect(re.test('MARC_BP_*')).toBe(true);
    expect(re.test('JBPM4_*')).toBe(true);
    expect(re.test('FPRJ_STAGENAME')).toBe(false); // colonne (préfixe FPRJ_)
    expect(re.test('AV_MT_MAR')).toBe(false); // code d'acte
    expect(re.test('ACTE_Controle')).toBe(false); // expertise
  });
  it('développe les écritures abrégées de tables', () => {
    expect(expandTableToken('REC_CUMUL_ARN/OPE').tables).toEqual(['REC_CUMUL_ARN', 'REC_CUMUL_OPE']);
    expect(expandTableToken('DYNDATA_CLASS / DYNDATA_OBJECT / DYNDATA_PROPERTY').tables).toEqual(['DYNDATA_CLASS', 'DYNDATA_OBJECT', 'DYNDATA_PROPERTY']);
    expect(expandTableToken('LBT_COMPTE.LCMP_NUMVER')).toEqual({ tables: ['LBT_COMPTE'], column: 'LCMP_NUMVER' });
  });
  it('reconnaît les migrations dbupdate', () => {
    expect(parseMigration('dbu2026-11-02/dbu6109001.sql', false).map((m) => [m.id, m.parent])).toEqual([
      ['mig:dbu2026-11-02', undefined],
      ['mig:dbu6109001.sql', 'mig:dbu2026-11-02'],
    ]);
    expect(parseMigration('WebContent/dbupdate/maj99/maj0001.sql', false).map((m) => m.id)).toEqual(['mig:dbupdate', 'mig:maj99', 'mig:maj0001.sql']);
    expect(parseMigration('UpgradeTask_033_*', false)[0].subtype).toBe('tâche Java');
    expect(parseMigration('dbu<numver>.sql', true)).toEqual([]);
    expect(parseMigration('init/', false)).toEqual([]); // hors contexte dbupdate
  });
  it('reconnaît endpoints, propriétés JVM (sans valeur), fichiers et ressources', () => {
    expect(parseEndpoint('/app/security?auth=…')).toBe('/app/security');
    expect(parseEndpoint('../api/v1/docs')).toBe('/api/v1/docs');
    expect(parseEndpoint('/{userId}')).toBeNull();
    expect(parseJvmProperty('-Dwebapp.nojob.alert=true')).toBe('-Dwebapp.nojob.alert');
    expect(parseFile('src/META-INF/persistence.xml', ['xml'])?.id).toBe('file:persistence.xml');
    expect(parseFile('lia-pom/pom.xml:213-237', ['xml'])?.id).toBe('file:lia-pom/pom.xml');
    expect(parseResource('WebContent/resources/ce_redalia2021/', ['dd_', 'ce_', 'rt_', 'dl_'])).toBe('ce_redalia2021');
    expect(parseResource('WebContent/resources/dd_lia/at_*.xml', ['dd_', 'ce_'])).toBeNull();
  });
});

describe('tags de confiance LiaWeb', () => {
  it('lit les tags annotés et garde le plus faible quand ils sont mêlés', () => {
    expect(findTags('[V `src/com/ordiges/projet/validation/ProjetValidationService.java:45-60`]')).toEqual(['V']);
    expect(findTags('[V sur le WAR éclaté ; origine transitive non identifiée]')).toEqual(['V']);
    expect(findTags('[V pour les fichiers manquants, H pour la conclusion]')).toEqual(['V', 'H']);
    expect(findTags('[H : DEVELOPMENT par défaut]')).toEqual(['H']);
    expect(findTags('**[V]** = vérifié · [README.md](x)')).toEqual(['V']);
    expect(findTagsDetailed('[V `lia-core/.../H/X.java`]').tags).toEqual(['V']); // une lettre dans un chemin n'est pas un tag
    const doc = parseMarkdown('x.md', '# T\n\n## S\n\nx [V pour A, H pour B]\n');
    expect(resolveConfidence(doc, doc.lines[4]).confidence).toBe('H');
  });

  it('applique un tag écrit seul sous un titre à toute sa section', () => {
    const doc = parseMarkdown('07-x.md', '# T\n\n### 2.1 Étapes\n\n[V `projet/stage/ProjetStageService.java:19-25`]\n\n| a | b |\n|---|---|\n| `preparation` | Saisie |\n');
    const row = doc.lines.find((l) => l.raw.includes('preparation'))!;
    expect(resolveConfidence(doc, row)).toMatchObject({ confidence: 'V', from: 'section' });
  });

  it('lit « Confirmés / Potentiels » avec la légende du document 10', () => {
    const doc = parseMarkdown('10-x.md', '# 10\n\n## 1. Bugs\n\n### Confirmés\n\n- a\n\n### Potentiels\n\n- b\n');
    const legend = [
      { heading: /^Confirmés$/, confidence: 'V' as const, where: '10:3' },
      { heading: /^Potentiels$/, confidence: 'H' as const, where: '10:3' },
    ];
    expect(resolveConfidence(doc, doc.lines[6], legend)).toMatchObject({ confidence: 'V', from: 'legend' });
    expect(resolveConfidence(doc, doc.lines[10], legend)).toMatchObject({ confidence: 'H', from: 'legend' });
  });
});
