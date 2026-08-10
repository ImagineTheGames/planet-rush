/**
 * evidence/a1-11-atlas-pooling/golden-delta.mjs — what the re-baseline actually moved.
 *
 * a1-11 re-cut `tests/mobile/goldens.spec.ts-snapshots/` because the shipped
 * renderer stopped drawing rocks, turrets and shots as vector `Graphics` and
 * started blitting baked textures. The brief asks for every changed image to be
 * justified, and "it looks the same to me" is not a justification — so this
 * measures each pair instead.
 *
 * Run it against the pre-change baselines (take them off git, they are not kept
 * in the tree twice):
 *
 *   mkdir -p /tmp/goldens-before
 *   for f in tests/mobile/goldens.spec.ts-snapshots/*.png; do
 *     git show <BEFORE-REF>:"$f" > /tmp/goldens-before/"$(basename "$f")"
 *   done
 *   node evidence/a1-11-atlas-pooling/golden-delta.mjs /tmp/goldens-before \
 *        tests/mobile/goldens.spec.ts-snapshots
 *
 * For each pair it reports the fraction of pixels that differ at all, the
 * fraction that differ by more than a *visible* amount, the worst single-channel
 * delta, and the bounding box the differences fall inside — which is the number
 * that tells you WHERE a change landed, and therefore whether it is the entity
 * layer that was rewired or something that should not have moved.
 *
 * `--json` writes a machine-readable summary to stdout instead of the table.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PNG } from 'pngjs';

/** A per-channel delta at or below this is antialiasing, not a look change.
 *  Chosen to match what `toHaveScreenshot`'s own comparator treats as noise. */
const VISIBLE_DELTA = 12;

const [, , beforeDir, afterDir, ...flags] = process.argv;
if (!beforeDir || !afterDir) {
  console.error('usage: golden-delta.mjs <before-dir> <after-dir> [--json]');
  process.exit(2);
}
const asJson = flags.includes('--json');

/** Compare one pair. Returns null when the files are byte-identical — the common
 *  case, and the one worth saying nothing about. */
function compare(name) {
  const beforeBuf = readFileSync(join(beforeDir, name));
  const afterBuf = readFileSync(join(afterDir, name));
  if (beforeBuf.equals(afterBuf)) return { name, identical: true };

  const a = PNG.sync.read(beforeBuf);
  const b = PNG.sync.read(afterBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { name, resized: true, before: [a.width, a.height], after: [b.width, b.height] };
  }

  const total = a.width * a.height;
  let differing = 0;
  let visible = 0;
  let worst = 0;
  let sum = 0;
  let minX = a.width;
  let minY = a.height;
  let maxX = -1;
  let maxY = -1;

  for (let i = 0; i < total; i++) {
    const o = i << 2;
    const dr = Math.abs(a.data[o] - b.data[o]);
    const dg = Math.abs(a.data[o + 1] - b.data[o + 1]);
    const db = Math.abs(a.data[o + 2] - b.data[o + 2]);
    const da = Math.abs(a.data[o + 3] - b.data[o + 3]);
    const d = Math.max(dr, dg, db, da);
    if (d === 0) continue;
    differing++;
    sum += d;
    if (d > worst) worst = d;
    if (d > VISIBLE_DELTA) {
      visible++;
      const x = i % a.width;
      const y = (i / a.width) | 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  return {
    name,
    identical: false,
    width: a.width,
    height: a.height,
    total,
    differing,
    differingRatio: differing / total,
    visible,
    visibleRatio: visible / total,
    worstDelta: worst,
    meanDelta: differing > 0 ? sum / differing : 0,
    // Where the visible differences live. `null` when none clear the threshold.
    box: maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

const names = readdirSync(afterDir).filter((f) => f.endsWith('.png')).sort();
const rows = names.map((n) => compare(basename(n)));

if (asJson) {
  console.log(JSON.stringify({ visibleDeltaThreshold: VISIBLE_DELTA, images: rows }, null, 2));
} else {
  const moved = rows.filter((r) => !r.identical);
  console.log(`${rows.length} images · ${moved.length} moved · ${rows.length - moved.length} byte-identical`);
  console.log(
    ['image'.padEnd(46), 'diff%'.padStart(8), 'vis%'.padStart(8), 'worst'.padStart(6), 'mean'.padStart(6), 'box'].join(
      ' | ',
    ),
  );
  for (const r of moved) {
    if (r.resized) {
      console.log(`${r.name.padEnd(46)} | RESIZED ${r.before.join('x')} -> ${r.after.join('x')}`);
      continue;
    }
    const pct = (v) => (v * 100).toFixed(3).padStart(8);
    const box = r.box ? `${r.box.x},${r.box.y} ${r.box.w}x${r.box.h}` : '(none over threshold)';
    console.log(
      [
        r.name.padEnd(46),
        pct(r.differingRatio),
        pct(r.visibleRatio),
        String(r.worstDelta).padStart(6),
        r.meanDelta.toFixed(1).padStart(6),
        box,
      ].join(' | '),
    );
  }
}
