// Reproducible spot-check: pick N nodes (seeded) — or all of them when N ≥ the number of nodes — and compare
// each one with the doc line it cites.
//   node scripts/spot-check.mjs [count] [seed]
// A node passes when its cited line really contains it: its name, an alias, the form written in the doc
// (provenance.metadata.via), its list number or its row id.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const g = JSON.parse(readFileSync('data/graph.json', 'utf8'));
const n = Number(process.argv[2] ?? 10);
let seed = Number(process.argv[3] ?? 20261112);
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const pool = g.nodes.filter((x) => x.type !== 'doc');
let picked;
if (n >= pool.length) picked = pool;
else {
  const s = new Set();
  while (s.size < n) s.add(pool[Math.floor(rnd() * pool.length)]);
  picked = [...s];
}
const verbose = n < pool.length;

const cache = new Map();
const readLine = (p) => {
  // doc provenance is relative to the LiaWeb folder (parent of this app)
  const file = join('..', p.file);
  if (!cache.has(file)) {
    try {
      cache.set(file, readFileSync(file, 'utf8').split(/\r?\n/));
    } catch {
      cache.set(file, []);
    }
  }
  return (cache.get(file)[p.line - 1] ?? '').trim();
};

let ok = 0;
const failures = [];
for (const node of picked) {
  const p = node.provenance.find((q) => q.method === 'mention') ?? node.provenance[0];
  const raw = readLine(p);
  const flat = raw.replace(/[`*]/g, '');
  const shortId = node.id.split(':').slice(1).join(':').split('/').pop();
  const head = node.label.replace(/…$/, '').replace(/^(?:\d+\.|[A-Z]+\d+ ·|Q\d\d\.\d+ ·)\s*/, '').slice(0, 30);
  const found =
    raw.includes(node.label) ||
    flat.includes(node.label) ||
    flat.includes(head) ||
    node.aliases.some((a) => a.length >= 2 && (raw.includes(a) || flat.includes(a))) ||
    (p.metadata?.via && raw.includes(p.metadata.via)) ||
    (node.props.ordre !== undefined && new RegExp(`^(?:\\|\\s*)?${node.props.ordre}[.\\s|]`).test(raw)) ||
    raw.includes(`| ${shortId} |`) ||
    (node.type === 'question' && raw.startsWith(`${node.props.numero}.`)) ||
    (node.type === 'issue' && /^[A-Z]+\d+$/.test(shortId) && (raw.startsWith('- ') || raw.startsWith('|'))) ||
    (node.type === 'state' && node.props.code !== undefined && raw.includes(String(node.props.code)));
  if (found) ok++;
  else failures.push(`${node.id} @ ${p.file.split('/').pop()}:${p.line} > ${raw.slice(0, 120)}`);
  if (verbose) {
    console.log(`${found ? '✔' : '✘'} ${node.id}  [${node.confidence}${node.docOnly ? ', doc-only' : ''}]  ${node.type}`);
    console.log(`    ${p.file}:${p.line}  (${p.method}, confiance ${p.confidence} via ${p.confidenceFrom})`);
    console.log(`    > ${raw.length > 170 ? raw.slice(0, 168) + '…' : raw}`);
  }
}
for (const f of failures.slice(0, 30)) console.log('✘ ' + f);
console.log(`\n${ok}/${picked.length} nœuds retrouvés sur la ligne citée${verbose ? '' : ' (tous les nœuds hors documents)'}.`);
process.exitCode = ok === picked.length ? 0 : 1;
