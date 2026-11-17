/**
 * Code Cartography extractor — LiaWeb (mode documentation uniquement).
 *
 *   npm run extract                                  # config par défaut : cartography.config.json
 *   npm run extract -- --config autre.config.json    # autre base de connaissances
 *   npm run extract -- --docs <dossier> --out data
 *
 * Produit data/graph.json, data/docs.json, data/stats.json.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { buildOutputs } from './lib/pipeline';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const configPath = resolve(arg('config') ?? 'cartography.config.json');
const outDir = resolve(arg('out') ?? 'data');
const t0 = Date.now();

const { graph, docs, stats, log } = buildOutputs({
  configPath,
  docsDir: arg('docs'),
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'graph.json'), JSON.stringify(graph, null, 1));
writeFileSync(join(outDir, 'docs.json'), JSON.stringify(docs));
writeFileSync(join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));

for (const l of log) console.log(l);
console.log(`\n✔ ${graph.meta.mode} — ${stats.nodes} nœuds, ${stats.edges} arêtes (${Date.now() - t0} ms)`);
for (const c of stats.checks) console.log(`  [${c.status.toUpperCase().padEnd(4)}] ${c.label} — attendu ${c.expected}, obtenu ${c.actual}${c.note ? ` (${c.note})` : ''}`);
console.log(`→ ${basename(dirname(join(outDir, 'x')))}/graph.json, docs.json, stats.json`);
if (!existsSync(join(outDir, 'graph.json'))) process.exit(1);
