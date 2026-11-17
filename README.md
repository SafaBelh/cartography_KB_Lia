# Code Cartography · LiaWeb

Carte interactive, **100 % locale et hors-ligne**, de l’application **LiaWeb** (Ordiges) : progiciel Java 21 / Apache Wicket 9 / Jersey / JPA EclipseLink de gestion des marchés publics. Elle permet aux développeurs, testeurs, chefs de projet et agents IA d’explorer l’application visuellement et de **retrouver la source de chaque affirmation** : fichier, ligne, extrait verbatim, règle d’extraction et confiance [V]/[H].

C’est une adaptation de `Team_Faouzia/project-1-cartography` (projet Talend). L’interface, les performances du canevas, la physique de glisser et les exports sont identiques. L’extracteur et les vues sont réécrits pour LiaWeb.

Source : les 13 documents de `LiaWeb/LIAWEB_knowledge_base/docs/project-knowledge/` (base de connaissances du 12/11/2026 : version 8.4.0, migrations 8.5.0 en cours). Ces documents ne sont jamais modifiés.

---

## Démarrage

```bash
npm install
npm run dev          # → http://127.0.0.1:5173
```

`npm run dev` génère `data/*.json` au premier lancement s’ils sont absents. Aucune police, aucun script ni aucune donnée n’est chargé depuis Internet. Le serveur n’écoute que sur `127.0.0.1`.

| Commande | Rôle |
|---|---|
| `npm run extract` | (Re)construit `data/graph.json`, `data/docs.json` et `data/stats.json` |
| `npm run dev` | Application en développement (http://127.0.0.1:5173) |
| `npm run build` | `tsc --noEmit` puis build de production dans `dist/` (CSP stricte : uniquement `'self'`) |
| `npm run preview` | Sert `dist/` sur http://127.0.0.1:4173 (si le port est pris : `npx vite preview --port 4391`) |
| `npm test` | Tests Vitest (reconnaisseurs, extracteur, schéma) |
| `npm run spot-check` | Tire 10 nœuds au hasard (graine fixe) et les compare à la ligne citée |
| `npm run check` | Typecheck + tests + vérification de **tous** les nœuds sur leur ligne |

## Mode « documentation uniquement »

Le dépôt SVN de LiaWeb n’est pas disponible. La carte est construite **uniquement à partir des 13 documents**, et un bandeau « Code source non chargé » le rappelle dans l’application. Tous les nœuds sont `docOnly: true`.

Conséquences :

- Seuls les éléments **nommés dans la doc** apparaissent. Exemples : 95 tables sur les 351 déclarées (05:81), 66 pages sur ≈ 250 montées (02:61), 6 migrations sur 289 (05:154). Ces comptes sont des contrôles « n/a » de l’Atlas.
- Un **[V]** est l’affirmation de la doc (« vérifié dans le code »), pas une vérification faite par cet outil.
- Une ligne de doc sans tag est traitée comme **[H]**. C’est volontairement prudent.

## Ce qui est extrait

| Type | D’où il vient |
|---|---|
| Paquets Java (`com.ordiges`, `com.wtrace`, `fr.tracesolutions`) | Noms qualifiés, chemins `src/…`, noms courts dans une colonne « Paquet(s) » avec le préfixe que la doc donne (en-tête « `com.ordiges.` », titre « `com.ordiges` », « Sauf mention contraire… sous `src/com/ordiges/` ») |
| Pages Wicket, services, classes | `*Page`, `*Service`, FQCN, `Classe.méthode()`, `src/…/X.java:45-60`, chemins élidés `lia-core/.../x/Y.java`. Un nom CamelCase seul n’est retenu que s’il a un suffixe de convention (09 §2), s’il est dans une colonne « Classe / Entité / Composant / Ressource », ou s’il est cité ailleurs avec un chemin |
| Objets du moteur LIA (`fprj`, `fcns`…) | 11 §1, puis mentions |
| Tables et vues | Préfixes **lus dans 05 §3.1** ; un autre `X_Y` seulement si la doc écrit « table » juste avant ; `A/B` et `_*` développés ; jamais dans une colonne « Clé / Colonnes » |
| Migrations | `dbu<date>/`, `dbu<numver>.sql`, `maj99/`, `init/`, `UpgradeTask_*` (05 §4) |
| Points d’entrée, API REST | Chemins `/app/*`, `/rest/*`… ; tableau 06 §5.2 (ressource → chemin, préfixe lu en 06:128) |
| Configuration | `-D…` et noms écrits après « préférence / paramètre / clé ». **Noms seulement, jamais de valeur** |
| Systèmes externes, technologies | Dictionnaire de `cartography.config.json` ; **une entrée n’est gardée que si un alias est trouvé** dans la doc |
| Modules, briques, licences, types d’actes | Titres de 04 (parties A et B), tableau 01 §2, tableau des familles d’actes de 04 |
| Enchaînements, cycles de vie | Listes numérotées et tableaux de 07 (et 02, 05, 01) ; diagramme ASCII de 07 §1 lu avec ses flèches `──►`, `◄──`, `▼` ; états de 07 §2, §6, §8 et de 04 |
| Problèmes, questions | 10 (B1–B9, S1–S23, potentiels, secrets **par emplacement**, dette, dépendances, limites) ; toutes les sections « Questions pour l’équipe » et 10 §4 |
| Glossaire, conventions | 11 ; 12 §2–§5 et 09 §2 |

**Confiance.** Pour chaque citation, la règle est la suivante :
1. Le tag de la ligne : `[V]`, `[H]`, `[V `chemin:lignes`]`, `[V sur …]`, `[H : …]`. Quand une ligne en porte plusieurs (`[V pour X, H pour Y]`), on retient **le plus faible**.
2. Sinon, le tag de la section. Un tag écrit seul sous un titre (`[V `projet/stage/ProjetStageService.java:19-25`]`) qualifie toute la section.
3. Sinon, la légende du document (10 : « Confirmé = constaté à la lecture du code »).
4. Sinon, **[H]**.

Un nœud ou une arête prend la confiance la plus forte de ses citations.

**Relations.** Elles viennent uniquement d’énoncés explicites. La règle est inscrite dans `provenance.method` et `provenance.metadata.rule`, avec l’indice éventuel (`cue`) :

| Règle | Exemple |
|---|---|
| `arrow-chain` | « `CreateContractTask` → `SetIndexVariationTask` » donne `sequence` ; « `fprj` → `PRJ_PROJET` » donne `maps-to`. Seuls les éléments voisins de la flèche sont reliés |
| `same-clause` | Même proposition. Le verbe donne la relation : « `LiaRealm` lit `VUE_AUTENTIF` » → `reads` ; « `InitSchedulerJob` planifie `AlerteJob` » → `calls` ; « `DatabaseUpdater`, appelé depuis `ContextListener` » → appel inversé. Sans verbe → `uses`. Une phrase niée (« n’est pas couvert par ») ne crée rien |
| `table-row` | Ligne de tableau : paquet ↔ plateforme (06 §2) → `calls` ; filtre ↔ portée (02 §3) → `applies-to` |
| `entity-table`, `object-table`, `rest-table` | Tableaux 05 §3.2, 11 §1, 06 §5.2 |
| `lifecycle-arrow` | « `3 en cours` → `onValidateActe` → `5 validé` » donne une transition étiquetée `onValidateActe` |
| `state-setter:*` | « `ClotureMarchePage` passe l’état à 5 », « acte `RESI_MAR` → état 6 », phrase d’introduction « `MarcheService.putMarcheEtat` : » |
| `lifecycle-order:inferred` | Ordre des lignes d’un tableau lu comme transition : **toujours [H]** |
| `path:package-inferred` | Paquet déduit d’un chemin relatif et de la base déclarée par le document : **toujours [H]** |

Les hits situés à l’intérieur d’un tag `[V `chemin`]` sont des preuves pour la ligne : ils ne participent à aucune relation.

**Secrets.** 10 §2 liste des fichiers suivis qui contiennent des secrets. Seuls l’emplacement et la nature sont repris (`valeur : non reproduite (10:5)`). Le contrôle intégré « Aucune valeur de secret copiée » et un test le vérifient.

## Vues

| Vue | Contenu |
|---|---|
| **Atlas** | Carte héro de l’architecture : entrées (`/app/*`, `/rest/*`, connexion, tâches de fond) → chaîne de 8 filtres (02 §3) → Wicket / ressources REST → 17 modules (04) et moteur LIA → trois chemins de persistance → source de données unique `jdbc/liaweb` et migrations → intégrations par catégorie (06). Au survol, chaque liaison affiche les arêtes du graphe qui la justifient ; trait pointillé = aucune arête. Indicateurs, enchaînement global de 07 §1, contrôles qualité |
| **Graphe** | Cytoscape : layouts force, hiérarchique, concentrique et arbre ; couleur par type ou par communauté ; mode focus (`f`, double-clic) ; recherche de chemin (exemple : `ProjetValidationPage → CNS_CONSULTATION`) ; **Physique** au glisser. Documents, termes, conventions, questions, problèmes, licences, fichiers, étapes et nœuds isolés (bouton « Isolés ») sont masqués par défaut ; libellés sur une ligne avec fond opaque |
| **Modules** | Catalogue en cartes, sans canevas : une carte par module de 04 (rôle, domaine, paquets, pages, services, classes, tables cités, problèmes liés, liens vers son diagramme et le graphe), puis un onglet par type de nœud avec recherche |
| **Diagrammes** | Diagrammes techniques en colonnes de boîtes de taille fixe (aucun chevauchement) : module fonctionnel, chaîne d’une requête, entités et tables, liens entre tables (05:138), intégrations, migrations, enchaînements. Boîte = nœud, trait = arête (pointillé = [H]) |
| **Cycles de vie** (remplace « Flux des jobs ») | Une machine à états par cycle de 07 et 04 : états dans l’ordre de la doc, transitions écrites (trait plein, avec la méthode), ordre de tableau [H] (pointillé), classes et codes d’actes qui positionnent l’état (au-dessus), problèmes et questions qui le concernent (en dessous). Physique au glisser, états fixes |
| **Intégrations** | Systèmes par catégorie de 06, avec qui les appelle ; API REST ; points d’entrée URL ; configuration (noms seulement) ; pile technique avec versions citées |
| **Base de données** | Voir ci-dessous |
| **Workflows** | 11 enchaînements (07, 02, 05, 01), règles de 01 §6 et 07 §4, expertises des catalogues `ce_*` |
| **Risques** | Problèmes de 10 (catégorie + statut confirmé / potentiel / constat) et 60 questions, avec filtres et nœuds concernés |
| **Documentation** | Les 13 documents ; chaque identifiant reconnu est un lien, chaque terme du glossaire a sa définition au survol |
| **Glossaire** | 109 termes et les 11 codes d’objets du moteur |
| **Conventions UI** | Conventions de 12 (composants de référence, navigation et droits, fichiers Wicket, i18n) et de 09 §2 |

Partout : palette `Ctrl K` (ou `/`), inspecteur (Aperçu, Relations, **Expliquer** = provenance, indice et déduction de chaque affirmation), filtres globaux (confiance, domaine de 04), fil d’Ariane, URL profondes (`#/graph?n=svc:ProjetValidationService&focus=1`, `#/lifecycles?lc=lc:acte`, `#/docs/07?line=150`, `?theme=light`), thèmes sombre et clair, export PNG / SVG / JSON.

Raccourcis : `g` puis `a` Atlas · `g` Graphe · `m` Modules · `i` Diagrammes · `c` Cycles de vie · `d` Intégrations · `b` Base de données · `w` Workflows · `r` Risques · `o` Docs · `l` Glossaire · `u` Conventions UI. `e` explique la vue ou le nœud, `t` change de thème, `[` replie / déplie le menu, `?` affiche l’aide, `Échap` ferme.

### Vue Base de données : d’où vient chaque élément

`src/lib/schema.ts` est une fonction pure, testée dans `tests/schema.test.ts`.

| Élément | Source |
|---|---|
| Base | Nœud `system` de catégorie « database » (`jdbc/liaweb`). Une table y est rattachée par une arête `part-of` (règle `single-datasource`, 05:10 : « une seule » source de données) |
| Groupes | Préfixe et domaine lus dans 05 §3.1 |
| Colonnes | Uniquement : colonnes « Clé » et « Colonnes de liaison » de 05 §3.2 ; `` `TABLE.COLONNE` `` ; `UPDATE … SET … WHERE …` (code inclus) ; `` `TABLE` (`col`, …) `` (une liste de tables, classes ou codes d’actes est rejetée). La convention de préfixe (`PRJ_PROJET` → `FPRJ_`) rattache aussi des colonnes, marquées **[H]** |
| Clés | Clé seulement dans la colonne « Clé » ; clé « composite (lot, candidat…) » sans noms affichée comme texte ; **aucune clé étrangère** entre colonnes |
| Liens entre tables | Phrase « Chaîne principale » (05:138), cardinalité telle qu’écrite. Un nom ambigu (« Lot » = `flot` ou `flcs`) reste non résolu |
| Accès | Arêtes `maps-to`, `reads`, `creates`, `uses` du graphe |

État au 12/11/2026 : 95 tables nommées (351 déclarées), 9 vues, 55 colonnes citées sur 25 tables (dont 3 [H]), 25 clés, 0 FK, 9 liens documentés, 15 migrations.

## Modèle de données

`src/types/graph.ts` est partagé par l’extracteur et l’interface. `data/graph.json` contient `{ meta, nodes[], edges[] }`.

- **Nœud** : `id`, `type`, `label`, `subtype`, `module`, `description`, `props`, `aliases`, `confidence`, `docOnly`, `provenance[]`.
  - Types : `project`, `sourceRoot`, `module`, `brick`, `tech`, `package`, `page`, `service`, `class`, `object`, `table`, `view`, `migration`, `config`, `file`, `licence`, `system`, `endpoint`, `workflow`, `step`, `lifecycle`, `state`, `actCode`, `rule`, `resource`, `term`, `convention`, `doc`, `issue`, `question`.
  - Identifiants : `pkg:com.ordiges.projet`, `svc:ProjetCreateService`, `page:ClotureMarchePage`, `cls:Marche`, `tbl:PRJ_PROJET`, `view:VUE_AUTENTIF`, `mig:dbu6109001.sql`, `ep:/rest/*`, `state:marche-etat/5`, `issue:S2`, `q:07-1`…
- **Arête** : `source`, `target`, `relation`, `label`, `confidence`, `docOnly`, `provenance[]`.
  - Relations : `contains`, `part-of`, `sequence`, `transition`, `sets-state`, `maps-to`, `reads`, `writes`, `creates`, `calls`, `exposes`, `applies-to`, `uses`, `configures`, `licensed-by`, `recommends`, `implements`, `defines`, `mentions`, `affects`, `flows-to`, `documented-in`.
- **Provenance** : `file` (relatif à `LiaWeb/`), `line`, `section`, `snippet`, `confidence`, `confidenceFrom` (`line` | `section` | `legend` | `fallback`), `method`, `metadata` (`rule`, `cue`, `via` = forme écrite dans la doc, `inference`, `tag`).

## Réutiliser sur une autre base de connaissances

Tout ce qui est propre à LiaWeb est dans `cartography.config.json` : sections citées (expressions régulières sur les titres), racines de paquets, dictionnaire des systèmes et technologies, cycles de vie (`parser` : `table`, `table-pairs`, `inline-dots`, `colon-list`, `colon-codes`, `paren`, `arrow`, `spans`), enchaînements, comptes déclarés, légende propre à un document.

```bash
npm run extract -- --config autre.config.json --out data
```

## Vérifications

- `npm test` : 28 tests.
  - `tests/recognizers.test.ts` : FQCN, `Classe.méthode`, chemins avec lignes, tables selon 05 §3.1, migrations, endpoints, tags annotés et mêlés, tag de section, légende de 10.
  - `tests/extractor.test.ts` : section « Questions pour l’équipe » sur une fixture synthétique ; cohérence avec la base LiaWeb (modules, questions, entités ↔ tables, cycles de vie, diagramme ASCII, secrets, règle de chaque arête, déductions toujours [H]).
  - `tests/schema.test.ts` : base unique, clés, liaisons, UPDATE, colonnes [H], **liste de codes ou de classes jamais prise pour des colonnes**, aucun FK inventé.
- Contrôles intégrés (`stats.checks`) : provenance sur chaque nœud, aucune arête orpheline, règle sur chaque arête, chaque ligne citée contient bien l’entité, aucune valeur de secret, comptes déclarés.
- `npm run check` : 1524/1524 nœuds (hors documents) retrouvés sur leur ligne au 12/11/2026.

## Arborescence

```
liaweb-cartography/
├── cartography.config.json     # sections, dictionnaire et règles propres à LiaWeb
├── scripts/
│   ├── extract.ts              # CLI
│   ├── spot-check.mjs          # vérification des nœuds sur leur ligne
│   ├── ensure-data.mjs         # pré-génération pour npm run dev
│   └── lib/                    # markdown (tags), java (reconnaisseurs), docs-extract, builder, pipeline, config
├── data/                       # graph.json, docs.json, stats.json
├── src/                        # Vite + React + TypeScript (vues, Cytoscape, physique, schéma)
└── tests/                      # Vitest
```
