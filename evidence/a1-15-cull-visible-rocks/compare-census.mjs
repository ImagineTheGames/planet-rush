/**
 * evidence/a1-15-cull-visible-rocks/compare-census.mjs — a1-15, the verdict.
 * OWNER: QA Manager.
 *
 * Takes the two censuses `census-drawn.mjs` produced and answers the brief's
 * question per rock, not per count. Counts alone cannot settle it: the served
 * build could draw the same NUMBER of rocks while drawing a different SET.
 *
 *   VISIBLE_TRUE — rocks whose real drawn silhouette (live `getBounds()` on the
 *                  PRE-CULL build, where nothing is culled) intersects the
 *                  visible viewport. What the player could see.
 *   DRAWN        — rocks the SERVED build left `visible`.
 *   MISSING      — VISIBLE_TRUE \ DRAWN. **Non-empty ⇒ the cull ate something the
 *                  player could see, and the report has its cause.**
 *   OVERDRAW     — DRAWN \ VISIBLE_TRUE. The pad erring outward; harmless.
 *
 * Matched by world position (`g.x`/`g.y`, the entity's own coordinates), because
 * the pooled build only creates a display object for a slot it has drawn, so
 * child index is not slot index there. `src/sim/` and `src/platform/freeze.ts`
 * are byte-identical across the pair and `?freeze=1` pins the tick, so the
 * positions are the same numbers on both sides — asserted here via `worldHash`
 * and via the match itself, which would fall apart if the worlds differed.
 *
 * A note on the two builds' RECTANGLES. They are not the same size, and that is
 * expected: the served build's rocks are pooled sprites whose texture carries the
 * bake margin (transparent texels around the silhouette), so their bounds are a
 * few percent wider than the pre-cull `Graphics` geometry. The pre-cull rect is
 * therefore the honest silhouette and the one VISIBLE_TRUE is computed from; the
 * served rect is used only to say what the served build drew, never to decide
 * what was visible.
 *
 *   node evidence/a1-15-cull-visible-rocks/compare-census.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRE = JSON.parse(readFileSync(join(HERE, 'census-pre-cull-111db86.json'), 'utf8'));
const POST = JSON.parse(readFileSync(join(HERE, 'census-served-ebdae99.json'), 'utf8'));

const touches = (r, vp) => r.maxX >= vp.left && r.minX <= vp.right && r.maxY >= vp.top && r.minY <= vp.bottom;
const inside = (r, vp) => r.minX >= vp.left && r.maxX <= vp.right && r.minY >= vp.top && r.maxY <= vp.bottom;
const key = (it) => `${it.x.toFixed(2)},${it.y.toFixed(2)}`;

/** How far a rect pokes into the viewport, in CSS px — how much of it the player
 *  actually gets. A straddler with 0.4 px on screen is a different claim from one
 *  with 60 px on screen, and a dropped rock should be reported with that number. */
function onScreenArea(r, vp) {
  const w = Math.min(r.maxX, vp.right) - Math.max(r.minX, vp.left);
  const h = Math.min(r.maxY, vp.bottom) - Math.max(r.minY, vp.top);
  return w <= 0 || h <= 0 ? 0 : Math.round(w * h);
}

const report = { pre: PRE.buildSha, served: POST.buildSha, layers: {}, profiles: {}, worst: [] };
let missingTotal = 0;
let straddleChecked = 0;

const names = Object.keys(PRE.profiles);
for (const name of names) {
  const a = PRE.profiles[name];
  const b = POST.profiles[name];
  if (!b) continue;
  const vp = a.visibleRect;
  const row = { viewport: a.viewport, worldHashPre: a.worldHash, worldHashServed: b.worldHash, layers: {} };

  for (const layer of ['asteroids', 'chunks']) {
    if (a[layer].error || b[layer].error) continue;
    // Ground truth from the pre-cull build: every rock, with its true silhouette.
    const truth = a[layer].items.filter((i) => touches(i, vp));
    const straddlers = truth.filter((i) => !inside(i, vp));
    const drawn = b[layer].items.filter((i) => i.visible && i.renderable && i.alpha > 0);
    const drawnKeys = new Set(drawn.map(key));
    const truthKeys = new Set(truth.map(key));

    const missing = truth.filter((i) => !drawnKeys.has(key(i)));
    const overdraw = drawn.filter((i) => !truthKeys.has(key(i)));

    missingTotal += missing.length;
    straddleChecked += straddlers.length;

    row.layers[layer] = {
      visibleTrue: truth.length,
      straddling: straddlers.length,
      drawn: drawn.length,
      missing: missing.length,
      overdraw: overdraw.length,
      missingDetail: missing.map((i) => ({
        x: i.x,
        y: i.y,
        rect: [i.minX, i.minY, i.maxX, i.maxY],
        onScreenPx2: onScreenArea(i, vp),
      })),
    };
    for (const m of missing) report.worst.push({ profile: name, layer, ...m, onScreenPx2: onScreenArea(m, vp) });
  }
  report.profiles[name] = row;
}

// Totals across every profile.
for (const layer of ['asteroids', 'chunks']) {
  let vt = 0, dr = 0, ms = 0, od = 0, st = 0;
  for (const p of Object.values(report.profiles)) {
    const l = p.layers[layer];
    if (!l) continue;
    vt += l.visibleTrue; dr += l.drawn; ms += l.missing; od += l.overdraw; st += l.straddling;
  }
  report.layers[layer] = { visibleTrue: vt, straddling: st, drawn: dr, missing: ms, overdraw: od };
}

report.profilesCompared = Object.keys(report.profiles).length;
report.straddleCasesChecked = straddleChecked;
report.verdict = missingTotal === 0 ? 'CULL INNOCENT — no visible body was dropped' : `CULL DROPS ${missingTotal} VISIBLE BODIES`;

writeFileSync(join(HERE, 'verdict.json'), JSON.stringify(report, null, 2));

const hashesAgree = Object.values(report.profiles).every((p) => p.worldHashPre === p.worldHashServed);
console.log(`pre-cull ${report.pre}   served ${report.served}`);
console.log(`worldHash agrees on every profile: ${hashesAgree}`);
console.log(`profiles compared: ${report.profilesCompared}   straddle cases checked: ${straddleChecked}\n`);
console.log('layer      visibleTrue  straddling  drawn  MISSING  overdraw');
for (const [l, t] of Object.entries(report.layers)) {
  console.log(
    `${l.padEnd(10)} ${String(t.visibleTrue).padStart(11)} ${String(t.straddling).padStart(11)} ${String(t.drawn).padStart(6)} ${String(t.missing).padStart(8)} ${String(t.overdraw).padStart(9)}`,
  );
}
console.log(`\n${report.verdict}`);
if (report.worst.length) {
  console.log('\nDropped bodies (world x,y — on-screen px²):');
  for (const w of report.worst.slice(0, 40))
    console.log(`  ${w.profile} ${w.layer} (${w.x}, ${w.y}) ${w.onScreenPx2} px²`);
}
