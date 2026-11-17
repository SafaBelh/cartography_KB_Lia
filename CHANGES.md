# Changements

## 1.2.0 — 2026-11-17

Synchronisation avec le 05 régénéré depuis le code source (`05-database-documentation-new.md`, version 8.5.0).

- **Choix du document** : `docFiles` dans `cartography.config.json` désigne le fichier lu pour un numéro (`"05": "05-database-documentation-new.md"`). L’ancien 05 est ignoré. Deux fichiers de même numéro sans choix explicite arrêtent l’extraction (plus de chargement en double).
- **Inventaire complet des tables** (05 §3.5) lu par un analyseur dédié (règle `table-inventory`) :
  - 351 tables en place sur 351 (avant : 95 nommées), 17 vues sur 17 (avant : 9) ;
  - pour chaque table : domaine, entité JPA (`maps-to`), objets du moteur (`maps-to`), script de création (`creates`), rattachement ;
  - bilan identique à celui du document : 236 / 63 / 31 / 21 ;
  - 24 tables supprimées (nouvelle relation `drops` depuis le script de suppression) et 6 noms du dictionnaire jamais créés, hors source de données ;
  - lignes sans tag : [V] repris de la phrase « Relevé du 17/11/2026 … [V] : » (05:201).
- **Comptes déclarés** : « Schéma actuel : 351 tables en place », 17 vues et 24 tables supprimées deviennent des contrôles stricts (réussi / échoué). Motif des objets `dd_lia` corrigé pour la nouvelle phrase (363 objets).
- **Vue Base de données** : titre « version 8.5.0 », tuile « Tables en place 351 / 351 », rattachement sur chaque carte (entité, objets, script, ligne de la doc), filtre par rattachement, groupe « sans préfixe », section « Hors schéma », migrations avec tables créées et supprimées.
- **Atlas** : « Tables en place » ne compte que les tables en place (ni familles `X_*`, ni tables supprimées).
- **Diagrammes** : « Entités et tables » limité aux entités centrales (05 §3.2, 11 §1) ; « Migrations dbupdate » montre les tables créées ou supprimées par un script.
- Bandeau et pied de menu mentionnent le 05 du 17/11/2026.
- Graphe : 2 478 nœuds et 6 237 arêtes (avant : 1 537 et 3 676). Le bloc de données passe de ≈ 4 Mo à 6,7 Mo (simple avertissement de Vite).
- Qualité : 30 tests, `tsc` et build au vert, `npm run check` 2465/2465 nœuds retrouvés sur leur ligne, tous les contrôles intégrés réussis.

## 1.1.0 — 2026-11-12

- **Nouvelle vue « Modules »** (`#/modules`, `g m`) : catalogue en cartes, sans canevas.
  - Modules de 04 : rôle, domaine, comptes et puces des paquets, pages, services, classes et tables cités, problèmes liés, boutons « Diagramme » et « Graphe ».
  - Un onglet par type de nœud, avec recherche, tri par nombre de relations et filtres globaux.
- **Nouvelle vue « Diagrammes »** (`#/diagrams`, `g i`) : diagrammes techniques en colonnes de boîtes de taille fixe, donc sans chevauchement.
  - Diagrammes : module fonctionnel, chaîne d’une requête (filtres dans l’ordre de web.xml), entités et tables, liens entre tables (« Chaîne principale » de 05, cardinalités, sans colonne), intégrations, migrations dbupdate, enchaînements (en serpentin numéroté, ou par rangs pour le diagramme de 07 §1).
  - Chaque boîte est un nœud (clic = provenance), chaque trait une arête (pointillé = [H]). L’ordre des boîtes réduit les croisements.
- **Graphe, chevauchements** :
  - nœuds sans relation visible masqués par défaut (bouton « Isolés ») ;
  - libellés sur une ligne avec ellipse et fond opaque, police des hubs réduite ;
  - layout de force qui réserve la place des libellés ;
  - étapes masquées par défaut.
- **Documentation** : colonne centrale en `flex-1` sur toute la largeur, espaces plus larges et séparateurs entre les colonnes, chemin du document corrigé.
- Contrôle Edge : 90 captures (dont les 10 nouveaux écrans), 0 débordement, 0 défilement horizontal, 0 erreur console.

## 1.0.1 — 2026-11-12

- **Panneaux opaques** : inspecteur, palette, légende, recherche de chemin, carte de survol et barre du haut n’ont plus de transparence ni de flou ; le texte du canevas ne transparaît plus derrière.
- **Thème blanc minimal par défaut** :
  - fond blanc et gris neutres, accent bleu pastel (plus de violet) ;
  - familles de nœuds en pastels clairs : bleu, orange, vert, jaune, rose, rouge, gris, turquoise ;
  - plus de halos colorés ni de dégradés de fond.
- Le thème sombre suit la même palette, sans violet. Un choix « sombre » déjà mémorisé est conservé.
- La recherche de chemin ne recouvre plus la barre d’outils du Graphe à 1280 px de large.
- Contrôle Edge refait : 50 captures, 0 débordement, 0 défilement horizontal, 0 erreur console.

## 1.0.0 — 2026-11-12

Première version. C’est une adaptation de `Team_Faouzia/project-1-cartography` 1.1.0 (Talend) à la base de connaissances LiaWeb (13 documents, 12/11/2026).

### Retiré (propre à Talend)

- Reconnaissance des composants `tXxx`, jobs, sous-jobs, `tRunJob` et étapes du pipeline.
- Variables de contexte Talend et variables globales.
- Lecteur `.item` / `.properties` / `.screenshot`, recherche et extraction de zip (`fflate`, `.source/`), fixtures Talend.
- Vue « Flux des jobs ».

### Extracteur

- Nouveaux reconnaisseurs déterministes (`scripts/lib/java.ts`) :
  - paquets, FQCN, `Classe.méthode()`, chemins `src/…/X.java:45-60` (élidés ou relatifs) ;
  - type de classe par suffixe (09 §2) ;
  - tables et vues selon les préfixes **lus dans 05 §3.1** ;
  - migrations `dbupdate`, points d’entrée URL, propriétés `-D…` (sans valeur), fichiers, ressources `dd_` / `ce_` / `rt_` / `dl_` (12 §6.1).
- Noms définis par la doc elle-même : objets du moteur (11 §1), types d’actes (04), briques et licences (01 §2), racines du dépôt (03 §1, 02 §2), préférences et expertises citées après « préférence », « clé » ou « expertise ».
- Tags LiaWeb : `[V `chemin`]`, `[V sur …]`, `[H : …]`, `[V pour X, H pour Y]` (le plus faible gagne). Un tag écrit seul sous un titre qualifie sa section. La légende de 10 (« Confirmé » / « Potentiel ») est appliquée à ses sections.
- Relations écrites seulement :
  - flèches (éléments voisins de la flèche) ;
  - même proposition, avec le verbe comme indice : lit, écrit, crée, appelle, planifie, appelé depuis ; une phrase niée ne crée rien ;
  - lignes de tableau, tableaux d’entités, d’objets et REST ;
  - transitions écrites, acteurs d’état.
- La règle est dans `provenance.method` et `provenance.metadata.rule`. Les déductions (ordre d’un tableau, paquet d’un chemin relatif) sont toujours [H].
- Cycles de vie (11), enchaînements (11, dont le diagramme ASCII de 07 §1 lu avec ses flèches `──►`, `◄──`, `▼`), règles et expertises, problèmes de 10 (secrets par emplacement seulement), questions de toutes les sections « Questions pour l’équipe » et de 10 §4, glossaire, conventions de 12 et 09.
- Contrôles intégrés : règle sur chaque arête, aucune valeur de secret, comptes déclarés (351 tables, ≈ 250 pages, 289 migrations…).
- `spot-check.mjs` vérifie tous les nœuds quand le nombre demandé dépasse leur total (l’ancien tirage aléatoire ne se terminait pas sur 1 500 nœuds).

### Application

- Modèle, familles de couleurs, formes et libellés pluriels refaits pour LiaWeb (`src/types/graph.ts`, `src/lib/meta.ts`).
- **Atlas** : nouvelle carte héro de l’architecture.
  - Entrées → filtres → Wicket / REST → modules → persistance → `jdbc/liaweb` → intégrations.
  - Chaque liaison est étayée par les arêtes du graphe au survol.
- **Cycles de vie** (nouvelle vue, remplace « Flux des jobs ») : machine à états par cycle, transitions écrites ou [H], acteurs et risques. Canevas Cytoscape avec `watchSize`, `zoomInSnapshot`, physique de glisser et aucun relayout au clic.
- **Intégrations** (ex-« Données ») : systèmes par catégorie de 06, API REST, points d’entrée, configuration, pile technique.
- **Base de données** refaite à partir de 05 :
  - une seule source de données ;
  - tables par préfixe, colonnes citées avec leur ligne ;
  - clé seulement dans la colonne « Clé », colonnes de préfixe marquées [H] ;
  - 0 FK, liens de la « Chaîne principale ».
- **Workflows** (11 enchaînements), **Risques** (catégorie + statut confirmé / potentiel au lieu de la gravité) et **Glossaire** (avec les codes d’objets) adaptés.
- Nouvelle vue **Conventions UI** (12, 09 §2).
- Filtre global par domaine (parties A / B de 04) au lieu du job.
- Palette, raccourcis (`g c`, `g u`), « Expliquer cette vue », bandeau « SVN non disponible ».
- Graphe : types peu structurants masqués par défaut ; zoom du mode focus plafonné pour garder les libellés lisibles.
- Données dans leur propre chunk (≈ 4 Mo) : le code de l’application reste à 145 ko.
- Repris tels quels : thèmes clair et sombre, menu repliable, URL profondes, exports, physique de glisser, corrections de débordement de la version 1.1.0.

### Qualité

- 28 tests Vitest, `tsc --noEmit` et `vite build` au vert. `npm run check` : 1524/1524 nœuds retrouvés sur leur ligne.
- Contrôle Edge headless (CDP) :
  - 12 vues × thèmes sombre et clair × 1920×940 et 1280×720, plus deux captures à 390 px de large ;
  - 0 texte hors de sa boîte bordée ou remplie (seules l’ellipse, le line-clamp et les zones défilantes sont acceptés comme troncature) ;
  - 0 défilement horizontal de page, 0 erreur console.

### Limites connues

- Code source non disponible : seuls les éléments nommés dans la doc sont cartographiés.
- 1 117 nœuds n’ont que des citations non étiquetées : ils sont traités [H].
- Paquets déduits d’un chemin relatif : la doc n’est pas toujours cohérente. Exemple : `admin/ws/UserWS` en 06 contre `src/com/ordiges/rest/admin/ws/UserWS.java` en 10 ; le chemin complet l’emporte, l’autre reste [H].
- Termes non cartographiés (52, dans `stats.unmapped`). Exemples : `BUD_ARTICLE` et `APP_MAILSERVER` (préfixe absent de 05 §3.1, sans le mot « table »), `InstanceMetier`, `ServiceMetier` (CamelCase sans indice de classe), termes absents du code (11 §7).
