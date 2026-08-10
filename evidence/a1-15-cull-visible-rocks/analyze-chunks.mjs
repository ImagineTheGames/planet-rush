/**
 * evidence/a1-15-cull-visible-rocks/analyze-chunks.mjs — a1-15, the chunk verdict.
 * OWNER: QA Manager.
 *
 * `mine-chunks.mjs` records both builds' chunk layers through a played match. Its
 * own summary says INCONCLUSIVE, and that is correct **for the test it runs**:
 * it matches chunks between builds by exact world position, and the two live
 * builds are never on exactly the same tick. Their own HUD clocks say so — pre
 * reads MATCH 0:23 / 0:26 / 0:29 where served reads 0:22 / 0:25 / 0:28.
 * `page.clock` fixes when time appears to advance; it does not fix how many sim
 * steps each build takes inside a `runFor`. Exact equality was the wrong test.
 *
 * But the drift is small, bounded and MEASURABLE, and the recorded data shows the
 * two builds carrying the same chunks a few pixels apart:
 *
 *   t+3s  served drew a chunk at screen (157.2, 20.9)-(169.2, 32.9)
 *         pre-cull drew the same one at (164.1, 20.7)-(176.1, 32.7)   —  7 px
 *   t+6s  served (159.5, 607.4)-(171.5, 619.4)
 *         pre-cull (139.4, 606.7)-(151.4, 618.7)                      — 20 px
 *
 * So this re-asks the question with a tolerance instead of exact equality: for
 * every chunk the PRE-CULL build actually DREW whose rect reaches the viewport,
 * is there a chunk the SERVED build drew within `TOL` px? The tolerance is not
 * picked to make the answer come out — it is reported alongside the measured
 * offsets, so a reader can see the margin between the drift (a few px) and the
 * threshold, and the sensitivity sweep at the end shows where the answer would
 * change if it changed at all.
 *
 * The complementary check matters just as much and needs no tolerance: chunks the
 * pre-cull build drew OFF screen must NOT be drawn by the served build. That is
 * the cull doing its job, and it is what the 120 -> 0 headline is actually about.
 *
 *   node evidence/a1-15-cull-visible-rocks/analyze-chunks.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const J = JSON.parse(readFileSync(join(HERE, 'mine-chunks.json'), 'utf8'));
const VP = { left: 0, top: 0, right: 1280, bottom: 800 };
const TOL = 40;

const touches = (r, v) => r.maxX >= v.left && r.minX <= v.right && r.maxY >= v.top && r.minY <= v.bottom;
const drawnOnly = (items) => items.filter((c) => c.visible && c.renderable && c.alpha > 0);
const mid = (r) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 });
const dist = (a, b) => Math.hypot(mid(a).x - mid(b).x, mid(a).y - mid(b).y);

/**
 * The sample filter, and it is the honest one: **the two builds' own HUD MATCH
 * clocks.** Both frames print the sim's own match time, so when they print the
 * same second the two worlds are within a second of each other, and when they do
 * not they are demonstrably not comparable. This replaces the ship-position
 * fingerprint the probe first used, which could never agree: the pre-cull build
 * draws all 8 ships and the served build draws only the ones on screen, so
 * comparing drawn sets across a culled and an un-culled build compares the cull
 * to itself.
 */
const matchClock = (hud) => (hud.find((t) => /MATCH/.test(t)) ?? '').trim();
const comparable = (s) => matchClock(s.hud) === matchClock(s.hudServed);

function evaluate(tol, onlyComparable = true) {
  let onScreen = 0, matched = 0, offScreen = 0, offScreenWronglyDrawn = 0;
  const offsets = [], misses = [];
  for (const s of J.samples) {
    if (onlyComparable && !comparable(s)) continue;
    const pre = drawnOnly(s.rawPre);
    const served = drawnOnly(s.rawServed);
    for (const c of pre) {
      const near = served.map((d) => ({ d, px: dist(c, d) })).sort((a, b) => a.px - b.px)[0];
      if (touches(c, VP)) {
        onScreen++;
        if (near && near.px <= tol) { matched++; offsets.push(Math.round(near.px * 10) / 10); }
        else misses.push({ atMs: s.atMs, rect: [c.minX, c.minY, c.maxX, c.maxY], nearestPx: near ? Math.round(near.px) : null });
      } else {
        offScreen++;
        // Was this off-screen chunk drawn by the served build anyway?
        if (near && near.px <= tol) offScreenWronglyDrawn++;
      }
    }
  }
  return { tol, onScreen, matched, missing: onScreen - matched, offScreen, offScreenWronglyDrawn, offsets, misses };
}

const main = evaluate(TOL);
const all = evaluate(TOL, false);
const comparableSamples = J.samples.filter(comparable).length;
const sweep = [10, 20, 30, 40, 60, 100].map((t) => {
  const r = evaluate(t);
  return { tol: t, matched: r.matched, missing: r.missing, offScreenWronglyDrawn: r.offScreenWronglyDrawn };
});

const out = {
  profile: J.profile, pre: J.pre, served: J.served, tolerancePx: TOL,
  method: 'chunks the pre-cull build DREW and whose rect reaches the viewport, matched to a chunk the served build DREW within TOL px',
  whyTolerance: 'the two live builds are never on exactly the same tick; their HUD MATCH clocks differ by up to 1s, so exact position equality is the wrong test',
  ...main,
  offsetsPx: main.offsets,
  maxOffsetPx: main.offsets.length ? Math.max(...main.offsets) : null,
  comparableSamples,
  totalSamples: J.samples.length,
  ignoringClockAgreement: { onScreen: all.onScreen, matched: all.matched, missing: all.missing, misses: all.misses },
  sensitivitySweep: sweep,
  verdict:
    main.onScreen === 0
      ? 'NO DATA — no on-screen chunk was drawn by the pre-cull build in this run'
      : main.missing === 0
        ? 'CHUNK CULL INNOCENT on this run — every on-screen chunk the pre-cull build drew was also drawn by the served build'
        : `CHUNK CULL DROPPED ${main.missing} of ${main.onScreen} on-screen chunks`,
};
writeFileSync(join(HERE, 'chunk-verdict.json'), JSON.stringify(out, null, 2));

console.log(`${out.pre} (pre-cull) vs ${out.served} (served) — ${out.profile}, tolerance ${TOL} px`);
console.log(`samples where both builds' HUD MATCH clocks agree: ${comparableSamples}/${J.samples.length}\n`);
console.log(`on-screen chunks drawn by pre-cull : ${main.onScreen}`);
console.log(`  of those, drawn by served too    : ${main.matched}`);
console.log(`  MISSING                          : ${main.missing}`);
console.log(`offsets between the matched pairs  : ${main.offsets.join(', ')} px (max ${out.maxOffsetPx})`);
console.log(`\noff-screen chunks drawn by pre-cull: ${main.offScreen}`);
console.log(`  of those, drawn by served anyway : ${main.offScreenWronglyDrawn}   (the cull's whole job)`);
if (main.misses.length) console.log('\nunmatched:', JSON.stringify(main.misses, null, 1));
console.log('\nsensitivity — tol: matched/missing/offScreenDrawn');
for (const s of sweep) console.log(`  ${String(s.tol).padStart(3)} px: ${s.matched}/${s.missing}/${s.offScreenWronglyDrawn}`);
console.log(`\n${out.verdict}`);
