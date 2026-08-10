/**
 * evidence/a0-18-bloom-gone/_entries.mjs — the a0-18 manifest entries. OWNER: Art Agent.
 *
 * Written by hand AFTER looking at every plate. The scripts in this directory
 * compute; nothing here is generated from them, and no number here is read out of
 * `src/` — every figure is either measured off the frames or read off the live
 * stage of a served bundle.
 *
 * **THIS HAS NOT BEEN RUN.** `evidence/manifest.json` and `evidence/images/` are
 * the QA Manager's, and a0-18 is an Art round; merging into the shared gallery is
 * theirs to do. It copies the two plates it references into `evidence/images/` and
 * then merges, idempotently (an entry with the same id is replaced, never
 * duplicated), so it is one command whenever they want it:
 *
 *   node evidence/a0-18-bloom-gone/_entries.mjs
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, '..');
const MANIFEST = join(EVIDENCE, 'manifest.json');

/** The build under report, and the one it was compared against. */
const SHA = 'ebdae99';
const BEFORE = '111db86';
const AT = '2026-08-10T16:06:00Z';

/** plate in this round's directory → the name it takes in the gallery. */
const IMAGES = [
  ['verdict-the-orb-did-not-move.png', 'a0-18-the-orb-did-not-move.png'],
  ['after-ebdae99-octagon-orb-near-x6.png', 'a0-18-a-bloomed-star-on-the-shipped-build.png'],
];

const entries = [
  {
    id: 'a0-18-the-bloom-was-never-gone',
    title:
      'The bloom orbs are NOT gone: both builds either side of the perf chain submit an identical 319 bloomed stars of 1,624, and the void’s own pixels differ by 68 of 5,184,000 — all 68 on one rock’s rim',
    area: 'match',
    image: 'images/a0-18-the-orb-did-not-move.png',
    capturedAt: AT,
    buildSha: SHA,
    attestation: [
      'THE REPORT: "the bloom orbs are gone, but they are gone completely, they were supposed to be there with ' +
        'subtle bloom on random stars...", from live play, after a1-11 (texture pooling) and a1-12 (viewport cull) ' +
        `landed. Two served bundles were compared on one box twelve minutes apart: ${SHA} (current main, the build ` +
        `under report) and ${BEFORE}, which is ecc1496^ — the commit before the perf chain. Same arena, same seed, ` +
        'same viewport (1440x900 at deviceScaleFactor 2), same pinned tick (?debug=1&freeze=1). Both /version.json ' +
        'reads are recorded in readback-after-ebdae99.json and readback-before-111db86.json.',
      '',
      'THE BLOOM IS PRESENT AND IT IS IDENTICAL. Two independent instruments, because "is it submitted" and "is it ' +
        'painted" are different questions with different answers. FIRST, the geometry read-back. starFieldSprite ' +
        'pushes, per bloomed star and in this order, an outer halo at 4.3x the star\'s radius and 0.065x its alpha, ' +
        'an inner halo at 2.4x and 0.16x, then the star\'s own point; drawSprite plays each as circle() + fill(), so ' +
        'on the live Graphics each is its own context.instructions entry with its own path and its own alpha. ' +
        'GROUPING A LAYER\'S FILLS BY CENTRE THEREFORE RECOVERS THE SCATTER EXACTLY — a group of 3 is a bloomed ' +
        'star, a group of 1 a plain one — and nothing is inferred from a pixel. Frozen octagon: deep 795 stars / ' +
        '163 bloomed / ratio 0.205, mid 575 / 102 / 0.177, near 254 / 54 / 0.213, against BLOOM.scatter of 0.18. ' +
        'Halo alphas arrive as 0.0169 to 0.1472 and widest halo radii as 4.08 / 5.78 / 9.24 units. EVERY ONE OF ' +
        'THOSE NUMBERS IS THE SAME ON BOTH BUILDS. Live, with the sim running, the totals are 319 bloomed of 1,624 ' +
        'on desktop and 127 of 706 on a phone at dpr 3.',
      '',
      'SECOND, the frame isolation — a1-07\'s method, and its calibrated zero. With the sim pinned, two screenshots ' +
        'differing by exactly one hidden layer differ by that layer\'s own pixels, so |A - A-without-that-layer| is ' +
        'the layer alone rather than a claim about it. The null control (the same frame shot twice, nothing changed) ' +
        'came back at 0 pixels and peak delta 0 on both arenas and both builds, so none of the numbers here has a ' +
        'noise floor to clear. The largest near orb, as a cut of raw luma through its centre, is ground 1.9, outer ' +
        'ring 15.9, inner ring 48.9, core 230.0 — two flat rings and a point, at the ratified alphas, exactly as ' +
        'authored. The stage was reached through pixi.js 8.6.6\'s own __PIXI_APP_INIT__ devtools hook from a ' +
        'Playwright init script; NOTHING IN src/ WAS TOUCHED to take any of this, which is what let one file measure ' +
        'two different commits\' bundles.',
      '',
      'WHAT THE PLATE SHOWS, and it is the whole round in one image. A 96x96 device-pixel window on a bloomed near ' +
        'star, cut identically out of both builds and shown at 6x nearest neighbour — no resampling, no ' +
        'amplification, the shipped frame\'s own pixels. Left is 111db86, middle is ebdae99, right is the difference ' +
        'at x6 in plasma cyan so it cannot be mistaken for frame content. In both panels the star is a white core ' +
        'inside two concentric soft rings, and a rock\'s rim enters at the left. THE DIFFERENCE PANEL LIGHTS UP THE ' +
        'ROCK\'S RIM AND LEAVES THE ORB BLACK. Every differing pixel in that window lies in the left 168 columns; ' +
        'the nearest one to the star is 20.2 device px away.',
      '',
      'THE WHOLE-FRAME PARTITION, so the verdict is falsifiable rather than asserted. Differencing the two frozen ' +
        'frames and bucketing every changed pixel by what was drawing there: on octagon 58,257 pixels of 5,184,000 ' +
        'changed (1.12%), of which 56,143 are the WORLD (peak delta 65.1), 2,046 are empty background (peak delta ' +
        '3.0), and 68 — SIXTY-EIGHT — are inside the void\'s own pixels, at peak delta 12.9. Those 68 are not ' +
        'scattered: they are one site, and 66 of the 68 sit on top of a world object. On line the same partition ' +
        'gives 27,248 world, 723 background, 79 void. The perf chain changed the entity layers, which is what it was ' +
        'for, and it did not touch the backdrop.',
      '',
      'WHICH OF THE THREE SUSPECTS IT WAS: NONE. Suspect 1, pooling quantising a 6% wash — the star layers are not ' +
        'baked at all; VoidBackdrop.configure plays them into Graphics with drawSprite(..., 1) and never reaches ' +
        'SpriteTextureCache, and the halo alphas read off the running build are BLOOM.intensity applied, not rounded ' +
        'away. Suspect 2, the cull reaching a backdrop layer — all three void-stars-* layers are on the stage, ' +
        'visible, renderable, at alpha 1, on both arenas and both viewports. Suspect 3, reduced-VFX shedding more ' +
        'than it claims — THE FROZEN PROBE CANNOT TEST THIS AT ALL, because ?freeze=1 pins reduceVfx to false in ' +
        'src/main.ts, so a separate live probe held the sim for 30 s at 4-5 fps (the reducer engaged far past its ' +
        'trigger) and the star field is unchanged from t+2 s to t+30 s on desktop and on a phone. The comment in ' +
        'Renderer.setReduceVfx that says the stars stay is accurate.',
      '',
      'WHAT DID CHANGE THE LOOK, stated because the brief asked for it if the bloom turned out to be present. The ' +
        '56,143 world pixels are a1-11 re-baking the entity looks as mipmapped sprites, concentrated on silhouette ' +
        'rims at up to delta 65. a1-07 had already established that the soft grey discs the developer described in ' +
        'THAT round were the asteroids — the same objects whose rims moved tonight. That is a lead for the Director, ' +
        'not a finding here: this round measures the frame, not perception.',
      '',
      'VERDICT: VERIFIED, that the bloom is present and that tonight\'s renderer work did not touch it. What this ' +
        'does NOT settle is why the developer sees no orbs; the companion entry counts what a screenful actually ' +
        'holds, and that number is a design question rather than a defect.',
    ].join('\n'),
    verdict: 'verified',
  },
  {
    id: 'a0-18-what-a-screenful-of-bloom-actually-holds',
    title:
      'Counted rather than argued: one desktop screenful holds 34 bloomed stars of 194, and only 20 have a halo ring clearing 10/255 — two of them in the near layer, at 12.5 CSS px',
    area: 'match',
    image: 'images/a0-18-a-bloomed-star-on-the-shipped-build.png',
    capturedAt: AT,
    buildSha: SHA,
    attestation: [
      'WHY THIS ENTRY EXISTS. "The bloom is present" is a fact about the frame and not yet an answer to "they are ' +
        'gone completely", because what the developer reported is a PERCEPTUAL quantity. So it is counted as one, on ' +
        `the served bundle ${SHA}, one screenful at 1440x900 CSS and dpr 2.`,
      '',
      'HOW IT WAS COUNTED, and the cross-check that says the count is sound. Each star layer\'s own delta field ' +
        '(|A - A-without-that-layer|, recomputed from the RAW frozen frames rather than read off the amplified ' +
        'isolate plate, which clips at delta 18.2 and would silently cap every core) is segmented into connected ' +
        'components. Components are then split by FOOTPRINT against that layer\'s authored radii: a plain star ' +
        'cannot be wider than its own diameter plus a pixel of antialiasing either side, while a bloomed one ' +
        'carries an outer halo of 4.3x its radius. THE SCRIPT HAS NO KNOWLEDGE OF BLOOM.scatter ANYWHERE IN IT, and ' +
        'the split lands on 17.5% of the stars on octagon and 21.4% on line — the ratified 0.18, recovered from ' +
        'pixels alone. That is what makes the rest of the table trustworthy. One threshold IS a judgement and is ' +
        'stated rather than hidden: "perceptible" means the halo\'s own brightest ring clears delta 10/255 over the ' +
        'ground, about the step a flat grey patch needs against near-black on a normal monitor. Argue with the 10 — ' +
        'the raw counts are in orb-census.json either way. One soft edge is called out too: for the DEEP layer the ' +
        'plain and bloomed footprint ranges very nearly touch (3.9 px against 3.87), so that row\'s split is the one ' +
        'number here that is not clean.',
      '',
      'WHAT A SCREENFUL HOLDS. Octagon, the default arena and the goldens\' scene: 194 stars visible, 34 blooming, ' +
        'and 20 whose halo clears the threshold — 2 in near, 11 in mid, 7 in deep. Line, which carries deepEmber: ' +
        '192 visible, 41 blooming, 27 perceptible — 5 near, 11 mid, 11 deep. Median orb width 6 to 12.5 CSS px. THE ' +
        'BEFORE-BUILD NUMBERS ARE THE SAME TO WITHIN TWO STARS, which is the point of the companion entry.',
      '',
      'WHAT THE PLATE SHOWS. The largest bloomed near star on the shipped build, at 6x nearest neighbour, ' +
        'UNAMPLIFIED — a white core inside a brighter inner ring inside a fainter outer ring, with a rock\'s rim at ' +
        'the left of frame for scale. This is what the design delivers, and it is genuinely there: a cut of raw ' +
        'luma through its centre reads ground 1.9, outer ring 15.9, inner ring 48.9, core 230.0.',
      '',
      'THE HONEST READING. "Gone completely" is not what the frame says. "You can fly for a while without noticing ' +
        'one" is. The near layer is the only one whose orbs are unambiguous at 12.5 CSS px, and it puts TWO of them ' +
        'on a desktop screen — because BLOOM.radii multiply each star\'s own radius rather than being an absolute ' +
        'size, and near has a density of 13 per million square units. The 21 deep-layer orbs are 6 px wide at delta ' +
        '7 and are not there to the eye at all.',
      '',
      'VERDICT: VERIFIED as a measurement, and DELIBERATELY NOT ACTED ON. Whether 20 orbs a screenful at these ' +
        'sizes is what a0-07 meant by "subtle bloom on random stars" is a design call on scatter and density, and it ' +
        'is the Director\'s to make with the developer. BLOOM is ratified; a0-07 chose the lowest of the three ' +
        'magnitudes shown on purpose; the brief for this round forbids both a brighter bloom and a different ' +
        'mechanism. Nothing in a0-18 changes a rendered pixel, and no golden moves.',
    ].join('\n'),
    verdict: 'verified',
  },
];

for (const [from, to] of IMAGES) {
  copyFileSync(join(HERE, 'plates', from), join(EVIDENCE, 'images', to));
  console.log(`[image] plates/${from} -> images/${to}`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('manifest.json is not an array');
const ids = new Set(entries.map((e) => e.id));
const kept = manifest.filter((e) => !ids.has(e.id));
const out = [...kept, ...entries];
writeFileSync(MANIFEST, `${JSON.stringify(out, null, 2)}\n`);
console.log(`[manifest] ${manifest.length} -> ${out.length} entries (replaced ${manifest.length - kept.length})`);
for (const e of entries) console.log(`  ${e.id}: ${e.verdict} (${e.attestation.length} chars)`);
