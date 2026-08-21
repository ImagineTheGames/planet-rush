/**
 * evidence/a0-126-the-last-two-points/merge.ts — fold shard artifacts into one.
 * OWNER: QA Agent (brief a0-126).
 *
 *   npx vite-node evidence/.../merge.ts <out.json> <shard.json> [shard.json …]
 *
 * The fold itself is `harness/mirrors` `mergeSections`, which refuses shards of
 * different sections, different rotation counts, different ceilings, or a seed
 * claimed twice. Nothing is averaged here: a shard is a disjoint seed span of
 * the same cross product, so the merge is concatenation with the section pools
 * summed.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { mergeSections } from '../../harness/mirrors';
import type { SectionRun } from '../../harness/mirrors';

const [out, ...shardPaths] = process.argv.slice(2);
if (!out || shardPaths.length === 0) {
  console.error('usage: merge.ts <out.json> <shard.json> [shard.json …]');
  process.exit(2);
}
const shards = shardPaths.map((p) => JSON.parse(readFileSync(resolve(p), 'utf8')) as SectionRun);
const merged = mergeSections(shards);
mkdirSync(dirname(resolve(out)), { recursive: true });
writeFileSync(resolve(out), `${JSON.stringify(merged, null, 1)}\n`, 'utf8');
const decided = merged.matches.filter((r) => r.ok && r.winner !== null).length;
const hangs = merged.matches.filter((r) => r.failure === 'wall-clock' || r.failure === 'stalled').length;
console.log(
  `merged ${shards.length} shards → ${out}: ${merged.matches.length} matches, ${decided} decided, ` +
    `${hangs} hangs, seeds ${merged.seeds[0]}…${merged.seeds[merged.seeds.length - 1]}`,
);
if (hangs > 0) {
  console.error(`MERGE FAILED: ${hangs} match(es) hung — GDD §3.8`);
  process.exit(1);
}
