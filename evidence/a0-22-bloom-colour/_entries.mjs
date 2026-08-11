/**
 * evidence/a0-22-bloom-colour/_entries.mjs — the a0-22 manifest entries.
 * OWNER: Art Agent.
 *
 * Written by hand AFTER looking at every plate. The scripts in this directory
 * compute; nothing here is generated from them, and no number here is read out of
 * `src/` — every figure is either measured off the frames or read off the live
 * stage of a served bundle.
 *
 * **THIS HAS NOT BEEN RUN.** `evidence/manifest.json` and `evidence/images/` are
 * the QA Manager's, and a0-22 is an Art round; merging into the shared gallery is
 * theirs to do. It copies the plates it references into `evidence/images/` and
 * then merges, idempotently (an entry with the same id is replaced, never
 * duplicated), so it is one command whenever they want it:
 *
 *   node evidence/a0-22-bloom-colour/_entries.mjs
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, '..');
const MANIFEST = join(EVIDENCE, 'manifest.json');

/** The build the measurements were taken against, and this branch's own. */
const BEFORE = '0f8fd05';
const AT = '2026-08-11T05:10:00Z';

/** plate in this round's directory → the name it takes in the gallery. */
const IMAGES = [
  ['plate-orbs-octagon.png', 'a0-22-the-orbs-take-a-colour.png'],
  ['plate-size-ladder.png', 'a0-22-what-in-a-frame-has-no-star-in-it.png'],
  ['plate-mockup-vs-now.png', 'a0-22-the-mockup-colours-against-the-shipped-ones.png'],
  ['golden-desktop-frozen-desktop-linux.png', 'a0-22-the-golden-that-moved.png'],
];

const entries = [
  {
    id: 'a0-22-the-blooms-take-a-colour',
    title:
      'The blooms are no longer one colour: two thirds of the near layer and a third of the mid now carry a plasma or patina halo, and the change takes light OUT of the frame — the brightest halo pixel in the game falls Y′ 37.6 → 27.8',
    area: 'match',
    image: 'images/a0-22-the-orbs-take-a-colour.png',
    capturedAt: AT,
    buildSha: 'this branch',
    attestation: [
      'THE REPORT: "the bloom is still messed up, still doesnt match our mockups and if you notice our mockups had ' +
        'different colored blooms these are all 1 color there are no stars in them...", from live play. The first ' +
        'half is true and was not a bug: every star ink was hullSteel, hullLight or white, starFieldSprite drew each ' +
        'halo in its star\'s own colour, and the rule that did it was written above STAR_LAYERS — "steel value ramp ' +
        'only: a star is a bright point, so it climbs by alpha/whiteness, never by hue". IT OBEYED STYLE-GUIDE §1 ' +
        'AND THE COMPOSITOR PAGE DID NOT, and nobody noticed the two disagreed until the game was in front of the ' +
        'developer.',
      '',
      'WHAT §1 IS PROTECTING, WHICH IS NOT THE SAME AS WHAT IT SAYS. The in-match palette carries meaning: yellow is ' +
        'ore, red is danger, the roster hues are who. The failure the ban prevents is a bloom a player checks ' +
        'because on this screen a warm glow has always meant something. Two of the compositor\'s four bloom colours ' +
        'were signal yellow #F2D24B and threat red #B23A3A — exactly the two that line excludes — AND THAT IS ' +
        'ALREADY A GATE RATHER THAN A JUDGEMENT. compliance.ts fails yellow and red on any role but ore/core/danger, ' +
        'and the star field is in ALL_SPRITES, so a warm halo reddens the build today and always would have. The ' +
        '§2.2 sky carve-out prices red on the backdrop at alpha <= 0.06; a bloom\'s INNER ring runs 0.042 to 0.147, ' +
        'over that ceiling on every layer in the field by 1.0x to 2.5x. Signal yellow has no carve-out at any alpha. ' +
        'So the two mockup hues this round cannot deliver are barred by a rule with a number on it, and moving that ' +
        'number is the Director\'s call and not Art\'s.',
      '',
      'WHAT SHIPS INSTEAD: the other half of the mockup, and the palette\'s other cold hue. plasma #4DC3FF — the ' +
        'compositor\'s own bloom cyan, and the most chromatic thing in the palette at C* 41.7 — and patina #4FA08B ' +
        'at C* 30.2. THE STAR\'S OWN POINT IS UNTOUCHED AND STAYS ON THE STEEL RAMP: §1\'s sentence is about the ' +
        'point, and only the light that scatters around it takes a hue. So does the diffraction glint, which is the ' +
        'point\'s own spike. Six of the field\'s nine inks stay wholly on the ramp.',
      '',
      'THE BOUND, MEASURED PER INK. A tint is bought with alpha — a halo paints at 16% of its star\'s own alpha ' +
        '(BLOOM.intensity, ratified at the lowest of three magnitudes in a0-07 and NOT TOUCHED HERE), so the ' +
        'composited pixel\'s Lab chroma is the honest measure of "coloured" and its luma over Floor is the honest ' +
        'measure of cost. Untinted halos sit at C* 1.0 to 2.3. mid hullSteel@0.70 goes C* 2.1 -> 8.2 and Y\' 16.8 ' +
        '-> 21.2; near WHITE@0.88 goes C* 1.3 -> 9.7 and Y\' 37.6 -> 25.1; near hullLight@0.92 goes C* 2.3 -> 5.6 ' +
        'and Y\' 26.8 -> 22.4. THE FRAME GETS QUIETER, NOT LOUDER: white is the most luminous thing in the palette, ' +
        'so the brightest bloom in the game loses a quarter of its value by becoming cyan. The brightest halo pixel ' +
        'anywhere in the field falls from Y\' 37.6 to 27.8 (-26%), the worst contrast tax any halo levies on a ' +
        'bright signal falls from 26.7% to 17.8%, and NOTHING REACHES THE INK OUTLINE EVERY SPRITE IS DRAWN WITH ' +
        '(rockFissure, Y\' 43.4) — the same invariant the six skies are held to. One ink moves the other way and is ' +
        'stated rather than buried: mid\'s steel, Y\' 16.8 -> 21.2, and it buys the only cyan a frame reliably ' +
        'contains.',
      '',
      'WHY dE IS NOT THE MEASURE HERE, stated because it is the trap. Every candidate tint lands dE >= 66 from ore, ' +
        'from danger and from all eight roster hues — but so does the steel that ships today, because at Y\' 20 ' +
        'everything is far from everything. The dE floor is asserted in backdrop.test.ts and it proves very little; ' +
        'the chroma column is what a player sees, and its ceiling at BLOOM.intensity 0.16 is C* 10.',
      '',
      'WHY THE FAR LAYER TAKES NO TINT, priced rather than assumed. "Hue on deep only" was the narrowest change ' +
        'available. At deep\'s halo alphas (0.042 to 0.061) the most chroma any tint can reach is C* 3.9, against ' +
        'C* 5.6 to 9.7 where one is actually spent, painted across a 6 px disc sitting 7 luma above its background. ' +
        'It is a change the developer could not see, on the layer where 25 of a frame\'s 36 blooms live. Keeping ' +
        'deep neutral also makes the tint a nearness cue rather than a repaint.',
      '',
      'WHAT THE PLATE SHOWS. The bloomed stars the live geometry read-back located, cut identically out of both ' +
        'served bundles at 8x nearest neighbour with NO AMPLIFICATION — the shipped bundle above, this branch ' +
        'below. The frame under each crop is the void ALONE: every world layer hidden on the Pixi stage, so no rock ' +
        'can be mistaken for a star or sit on top of one. The first cell is the round in one image: a white halo ' +
        'becomes a cyan one and the white star inside it does not move. Cells 2 to 4 are the untinted inks, ' +
        'unchanged.',
      '',
      'VERDICT: VERIFIED. The blooms carry more than one colour, no bloom carries a RESERVED one, and the void is ' +
        'measurably quieter than it was. WHAT THIS DOES NOT SETTLE is whether the tint is strong enough for the ' +
        'developer: BLOOM.intensity is the ceiling on how coloured a bloom can be, and at 0.16 that ceiling is ' +
        'C* 10. Raising it is a design call on a number a0-07 chose deliberately, and it is the developer\'s.',
    ].join('\n'),
    verdict: 'verified',
  },
  {
    id: 'a0-22-there-are-no-stars-in-them',
    title:
      'Measured, not argued: 36 of 36 bloomed stars on a screenful have a core, and it is the brightest pixel in every one — what is round, soft and genuinely starless in that frame is 2 to 100 times bigger',
    area: 'match',
    image: 'images/a0-22-what-in-a-frame-has-no-star-in-it.png',
    capturedAt: AT,
    buildSha: BEFORE,
    attestation: [
      'THE SECOND HALF OF THE REPORT: "there are no stars in them". starFieldSprite pushes the halo first and the ' +
        'star\'s own point second at the same x,y, so a star SHOULD sit in every bloom — but that is a claim about ' +
        'submission and the report is a claim about pixels, so both were asked separately on the served bundle ' +
        `${BEFORE}, desktop 1440x900 at dpr 2, ?debug=1&freeze=1.`,
      '',
      'THE FRAME IS THE VOID ALONE. Every child of the Pixi stage but the backdrop root was hidden before the ' +
        'screenshot, so no rock, ship or station can be mistaken for a star or sit on top of one. That matters here ' +
        'specifically: a1-07 measured that the soft grey discs the developer described in an EARLIER round were the ' +
        'asteroids, so this round removes them from the question by construction rather than by argument. Nothing ' +
        'in src/ was touched to take any of it; the stage is reached through pixi.js\'s own __PIXI_APP_INIT__ ' +
        'devtools hook from a Playwright init script.',
      '',
      'EVERY BLOOM HAS A STAR IN IT, AND IT IS THE BRIGHTEST THING IN IT. On octagon, 36 bloomed stars fall inside ' +
        'the viewport — 25 deep, 10 mid, 1 near — and ZERO OF THEM LACK A CORE. Sampling the rendered PNG at each ' +
        'star\'s own centre against the annulus of its own inner halo: deep, core peak Y\' 41.7, standing 33.4 luma ' +
        'above its halo; mid, 112.3 and 90.6; near, 230.0 and 182.7. Not one core fails to clear its own halo by ' +
        'even 1 of 255. On oval, which carries Plasma Reef behind the stars, the same measurement gives 42.9/33.4, ' +
        '105.3/81.7 and 165.0/127.2 — a lit sky does not swallow a core either.',
      '',
      'WHAT IN THAT FRAME DOES HAVE NO STAR, and it is the point of the plate. Bloom halos are 6.0 px (deep), 7.6 ' +
        '(mid) and 11.8 (near) across in CSS pixels. The sky\'s own soft discs are 8.1 to 659.2, median 38.3, and ' +
        'there are 1,004 of them on The Oval — A NEBULA DISC HAS NO STAR IN IT BY CONSTRUCTION. An asteroid is ' +
        '62.7 (a1-07, measured on a ground-only frame with no stars and no bloom in it at all). So the smallest ' +
        'starless round thing in the frame is more than THREE TIMES the median bloom and half again the largest ' +
        'one.',
      '',
      'THE HONEST READING, and its limit. Nothing here measures perception, so this does not say what the developer ' +
        'was looking at. What it does say is narrower and checkable: whatever had no star in it was not a bloom. ' +
        'The one sub-claim the numbers do support is about the FAR layer — a deep bloom is a 6 px disc sitting 7 ' +
        'luma over its background with a 1.4 CSS px core in it, and 25 of a screenful\'s 36 blooms are those. They ' +
        'are faint by design (a0-18 measured the same thing from the other direction and the Director has the ' +
        'question), and they are the layer this round deliberately left alone.',
      '',
      'VERDICT: VERIFIED as a measurement. The literal claim is false of the blooms and true of two other things in ' +
        'the same frame, both of them bigger. What this branch changes about it: the star point keeps the steel ' +
        'ramp while its halo takes a hue, so a tinted bloom is now the EASIEST place in the sky to find a star — ' +
        'measured after the change, the near layer\'s core-over-halo rises from 182.7 to 195.5.',
    ].join('\n'),
    verdict: 'verified',
  },
  {
    id: 'a0-22-the-goldens-and-a-finding-about-them',
    title:
      'Five goldens re-baselined and every moved pixel is a bloom halo — and, against a calibrated zero noise floor, 35 of main’s 44 committed baselines do not reproduce from main’s own code',
    area: 'process',
    image: 'images/a0-22-the-golden-that-moved.png',
    capturedAt: AT,
    buildSha: 'this branch',
    attestation: [
      'THE RE-BASELINE. Five baselines moved: desktop-frozen and desktop-frozen-teams at 187 pixels of 1,024,000 ' +
        '(mean delta Y\' +1.67), and phone-landscape-frozen, phone-landscape-frozen-teams and ' +
        'phone-portrait-frozen-teams at 34 of 329,160 (+2.06 to +2.08). The plate cuts the bounding box of ' +
        'everything that changed out of both frames at nearest neighbour, main above and this branch below, with ' +
        'the difference at x10 beneath — the only amplified thing on it. ON THE DESKTOP PLATE THE DIFFERENCE ROW IS ' +
        'FOUR ISOLATED BLUE POINTS AND NOTHING ELSE: no entity, no HUD, no text, no panel. On the phone plates it ' +
        'is one star, whose neutral grey halo becomes teal while its white core stays put.',
      '',
      'THE NOISE FLOOR IS A CALIBRATED ZERO. Two independent regenerations of the whole suite from the same build ' +
        'came back BYTE-IDENTICAL ON 44 OF 44 baselines, so none of the numbers here has noise to clear and every ' +
        'difference below is real.',
      '',
      'AND AGAINST THAT ZERO, A FINDING THAT IS NOT THE BACKDROP\'S. 35 OF MAIN\'S 44 COMMITTED BASELINES DO NOT ' +
        `REPRODUCE FROM MAIN'S OWN CODE in this container — measured by regenerating the suite in a clean worktree ` +
        `at ${BEFORE} and diffing against what that same commit has committed. The clearest is desktop-hud-top, ` +
        'where 98.8% of the frame differs at peak delta 137: THE COMMITTED BASELINE READS "TOTAL" WHERE THE BUILD ' +
        'DRAWS "ORE". Four wheel plates differ at peak delta 224 over 0.78% of the frame; both desktop pause plates ' +
        'at 1.2-1.4%; both phone pause plates at 1.9%. All of it sits under maxDiffPixelRatio\'s 1% budget as ' +
        'pixelmatch counts it perceptually, which is why CI has stayed green over it. It is filed here rather than ' +
        'fixed: it is not this round\'s to re-baseline.',
      '',
      'SO THIS BRANCH RE-BASELINES ONLY WHAT IT MOVED. The other 39 keep main\'s committed bytes, because adopting ' +
        'them in an Art PR would fold another lane\'s un-baselined change into it and hide it. Separating the two ' +
        'took a third comparison — main regenerated in this container against this branch regenerated in it — and ' +
        'it splits cleanly: the bloom tint (mean delta RGB about [-3, +3, +6], cyan replacing white) and the BUILD ' +
        'BADGE, a 38x8 px box carrying the commit sha that differs on every commit and always has.',
      '',
      'VERDICT: VERIFIED for the five that moved — every changed pixel was looked at, magnified, and is a bloom ' +
        'halo. The 35-baseline drift is reported as a FINDING for the QA Manager and the Director, not acted on ' +
        'here.',
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
