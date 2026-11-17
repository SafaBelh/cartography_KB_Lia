// Runs before `npm run dev`: generate data/*.json on first launch so `npm install && npm run dev` just works.
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
if (!existsSync('data/graph.json') || !existsSync('data/docs.json') || !existsSync('data/stats.json')) {
  console.log('data/*.json absent → extraction initiale…');
  execSync('npx tsx scripts/extract.ts', { stdio: 'inherit' });
}
