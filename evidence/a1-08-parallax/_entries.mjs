/**
 * evidence/a1-08-parallax/_entries.mjs — the a1-08 manifest entries.
 * OWNER: QA Manager.
 *
 * Written by hand AFTER looking at every plate. The scripts in this directory
 * compute; nothing here is generated from them, and no number here is repeated
 * from `src/` — every figure is either measured off the frames or read off the
 * live stage. Merge into the gallery with:
 *
 *   node evidence/a1-08-parallax/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SHA = 'f79aa61';
const LINE = '2026-08-10T04:11:56Z';
const COMPASS = '2026-08-10T04:23:15Z';

const ENTRIES = [
  {
    id: 'a1-08-sky-parallax-measured-on-an-arena-that-has-a-sky',
    title:
      'The sky drifts at 0.0850 of camera travel against the deep stars’ 0.1001 — measured in the pixels, on The Line, over three baselines. a1-05’s open question is answered.',
    area: 'match',
    image: 'images/a1-08-line-sky-drift.png',
    capturedAt: LINE,
    buildSha: SHA,
    attestation:
      "WHAT a1-05 COULD NOT DO. `a1-05-sky-parallax-not-camera-locked` has stood inconclusive since it was filed, and its own words say why: it proved the backdrop was not glued to the camera, but the arena it flew had no sky to track, so it could only ever watch the STARS. This flies an arena that has one. Served bundle f79aa61 (/version.json, and the build badge reads f79aa61 in the bottom-left of the player's frame), The Line, whose MAP_NEBULA entry a1-07 already verified as deepEmber on this same build. Desktop 1440x900 at deviceScaleFactor 1 ON PURPOSE: the camera is 1:1 and Pixi autoDensity puts the stage in CSS px, so ONE IMAGE PIXEL IS ONE CSS PIXEL IS ONE WORLD UNIT and nothing below needs converting. (a1-05 reported '219 px' against '844 world units' without saying which unit the 219 was in; that ambiguity is not repeated here.) HOW THE SKY WAS ISOLATED, because differencing whole frames is exactly what made the first attempt inconclusive. A frame holds the ground, three star layers, the sky and a live world, all moving at different rates; cross-correlating two of them returns whichever layer owns the most contrast, and a1-05's 0.259 of camera travel is the MID star layer's 0.26, not the sky's. a1-07 isolated a layer by hiding it and subtracting two FROZEN frames, but a flight cannot be frozen — ?freeze=1 pins the ship, so the camera never moves. So this isolates by hiding EVERYTHING ELSE: at each camera stop the harness hides every sibling of the void container (world, HUD, badge) and every void layer but one, and the screenshot IS that single layer, alone, over black. Nothing is mixed in and there is nothing to attribute. The stage is reached read-only through pixi.js 8.6.6's own `__PIXI_APP_INIT__` devtools hook, claimed from a Playwright init-script exactly as a1-07 did it; NOTHING IN src/ WAS TOUCHED, and no constant was retuned. THE FLIGHT. One straight run east from ship world x 682.7, stopping at four camera positions and coming to a FULL REST at each — the camera offset moved 0.000 px between the readback and the last of the six frames at every one of the four stops, so no frame is smeared across two camera positions. Baselines of 574.4, 966.1 and 1406.6 world units flown; the camera offset moved -574.43, -966.11 and -1406.61 px, i.e. 1.0000 x the distance flown, which is what a 1:1 camera means. WHAT THE PIXELS SAY, on the longest baseline (1406.6 u): void-nebula-deepEmber moved -119.61 px, void-stars-deep -140.75 px, void-stars-mid -365.80 px, void-stars-near -703.22 px, void-ground 0.00 px. As a fraction of camera travel that is 0.0850, 0.1001, 0.2601, 0.4999 and 0.0000. The same four ratios come back at 574 u (0.0851 / 0.0999 / 0.2598 / 0.4998) and at 966 u (0.0850 / 0.1001 / 0.2599 / 0.5000): three independent baselines, no drift between them. NORMALISED TO ONE SCREEN-WIDTH FLOWN (844 u) the sky falls 71.7 px where the deep stars fall 84.5 px, and the sky trails them by 12.7 px. THE PLATE, and what is actually visible on it. Top-left overlays stop 0 in red on stop 3 in cyan with NO re-alignment — the camera-locked hypothesis drawn out. Every ringed disc is doubled, a red one and a cyan one with cyan to the left. Top-right is the same pair with stop 3 shifted back by 119.61 px: the doubling closes and the discs go neutral grey. The mean absolute difference is 10.047x worse at zero shift than at the measured one, and the best score anywhere more than 25 px away from the winner is 3.859x worse, so the minimum is sharp rather than a shallow basin. Bottom-left applies the SKY's 119.61 px to the deep stars at 2x magnification: still doubled, every star a red point with a cyan one beside it. Bottom-right gives the stars their own 140.75 px and each pair closes to a single white point. THE INDEPENDENT SECOND OPINION. Alongside the frames the harness read each layer's live `position` off the scene graph. Those say -119.56, -140.66, -365.72, -703.30 and 0.00 px. The correlator never sees them; they agree with the pixels to under a tenth of a pixel on every layer. TWO CONTROLS. void-ground is parallax 0 — it is literally glued to the camera, so it is the measured picture of the defect being alleged, and it measures 0 px: its frames are BYTE-IDENTICAL (md5 6889bd38...) across all four stops. That identity is also how I know nothing live leaked past the isolation, because a frame with anything live in it cannot repeat to the byte. VERDICT: the sky is not camera-locked, and it is not the pre-a0-07b 0.05 either — 0.05 would put it 42 px behind the deep stars per screen-width and it is measured at 12.7. It travels with the far star field at 85% of its rate and separates from it slowly, which is what a0-07b set out to make it do. THE ONE THING THIS DOES NOT SETTLE: it does not tell you what the developer saw. Nobody has matched their frame to an arena, a build or a moment, and a0-07b's own text says the read that prompted it was about GROUPING rather than speed. This measures the geometry, not the perception.",
    verdict: 'verified',
  },
  {
    id: 'a1-08-compass-sky-coalsack-is-the-declared-exception-and-out-runs-the-stars',
    title:
      'The Compass — Coalsack measures 0.1401 of camera travel, FASTER than the deep stars’ 0.1001: the one sky not on SKY_PARALLAX behaves like the dust-in-front it is declared to be',
    area: 'match',
    image: 'images/a1-08-compass-sky-drift.png',
    capturedAt: COMPASS,
    buildSha: SHA,
    attestation:
      "WHY THIS ARENA WAS FLOWN AT ALL — it is the falsification guard. Coalsack is the one sky deliberately NOT on SKY_PARALLAX: it is declared as dust in FRONT of the deep star layer at 0.14, so it should out-run the very stars the other skies trail. If the instrument merely echoed whatever number it was pointed at, The Line and The Compass could not disagree. They must, and they do. Served bundle f79aa61, map pinned through localStorage['planet-rush:mapId']='compass', desktop 1440x900 at deviceScaleFactor 1, same isolation as the Line item: every sibling of the void container and every void layer but one hidden, so each frame is one layer alone over black. THE FLIGHT. One straight run WEST from ship world x 1751.7 — west because the first attempt flew east, ran the ship into the arena wall at x 2384 after ~600 u, and produced two 'camera positions' that were really one (a1-07 hit exactly this trap and named it). Two usable baselines: 596.1 u and 1018.9 u flown, camera offset moving +596.10 and +1018.87 px, full rest at each stop and 0.000 px of camera drift across every frame set. WHAT THE PIXELS SAY, on the 1018.9 u baseline: void-nebula-coalsack moved +142.71 px, void-stars-deep +101.95, void-stars-mid +264.95, void-stars-near +509.34, void-ground 0.00 — ratios of 0.1401, 0.1001, 0.2600, 0.4999 and 0.0000 of camera travel. At 596.1 u the same layers give 0.1399, 0.1002, 0.2600, 0.5000. The live scene-graph transforms, read independently and never shown to the correlator, say 142.64, 101.89, 264.91, 509.43 and 0.00 px: agreement to under a tenth of a pixel again. SO THE TWO ARENAS DISAGREE, AND THEY DISAGREE IN THE DECLARED DIRECTION — 0.1401 here against 0.0850 on The Line, both measured by the same script on the same build within twelve minutes of each other. Per screen-width flown (844 u) Coalsack covers 118.2 px where the deep stars cover 84.5, so it OUT-RUNS them by 33.8 px rather than trailing them. WHAT IS VISIBLE ON THE PLATE. Coalsack isolated is not the faint wash the other skies are: at 12.8x from a floor of 1 it is a bank of overlapping dark lobes filling the upper two-thirds of the frame, and this matches a1-07's finding that it paints the GROUND colour and adds no light — over black it reads as shape, not as glow. Top-left, overlaid at zero shift, every lobe is doubled with cyan to the right; top-right, shifted back 142.71 px, the doubling closes to grey. Mean absolute difference is 15.683x worse at zero shift than at the measured one. Bottom-left applies Coalsack's 142.71 px to the deep stars and they stay doubled; bottom-right gives them their own 101.95 px and they close. A STOP WAS DROPPED, AND SAYING SO IS THE POINT. The fourth camera stop is not in any number above: the player ship was destroyed mid-sequence and the ELIMINATED summary replaced the arena between the scene-graph readback and the shutter, so all five of that stop's 'isolated layers' are the same screenshot of a menu. The tell is exact rather than statistical — the five frames are byte-identical to each other, which cannot happen when the isolation is in force — and the measuring script now refuses them by that test rather than reporting the confident nonsense they would otherwise produce (a first pass had them 'measuring' a 910 px shift). The frames are kept in frames/ as compass-stop3-*.png. VERDICT: the registry's declared exception is real in the shipped build. Coalsack is at 0.14, in front of the deep layer, and the instrument that measured 0.085 on The Line measures 0.14 here.",
    verdict: 'verified',
  },
  {
    id: 'a1-08-parallax-null-control-what-camera-locked-actually-measures-as',
    title:
      'The null control: void-ground is parallax 0, and across a 1406 u flight its isolated frames are byte-identical — 0 px is what “glued to the camera” looks like on this ruler',
    area: 'match',
    image: 'images/a1-08-line-layer-ladder.png',
    capturedAt: LINE,
    buildSha: SHA,
    attestation:
      "A MEASUREMENT OF DRIFT MEANS NOTHING WITHOUT THE ZERO. The complaint a0-07b answered was that the sky read as 'attached to the camera'. A layer attached to the camera does not drift a small amount — it drifts NOTHING, and until you have shot one you have no idea what your instrument returns for it. void-ground is that layer: it sits at parallax 0 by construction, so it is the defect drawn out on purpose. Served f79aa61, The Line, one straight flight east, four camera stops spanning 1406.6 world units. ITS ISOLATED FRAMES ARE BYTE-IDENTICAL AT EVERY STOP — md5 6889bd384e51571b117ba524befa76ca for all four of stops 0, 1, 2 and 3. Not 'close', not 'sub-pixel': the same file. THAT IDENTITY DOES TWO JOBS. First, it fixes the zero: 0 px, exactly, is the reading for a camera-locked layer, and the sky's 119.61 px over the same flight is therefore a real displacement and not an artefact of the method. Second, it is the leak test for the whole round. The isolation works by hiding every sibling of the void container and every void layer but one; if anything live — a rock, a ship, a HUD digit, a bloom animation — had survived that hiding, two frames taken minutes apart could not possibly repeat to the byte. Nothing survived it. WHAT THE PLATE SHOWS. Five panels, one per void layer, each overlaying stop 0 in red on stop 2 in cyan with NO re-alignment, so the width of the red/cyan separation IS that layer's drift. Top-left, void-ground: a flat uniform grey field with no separation anywhere, because the two frames are the same bytes. void-nebula-deepEmber: soft ringed discs, each one doubled by a modest amount. void-stars-deep, mid and near: scattered points, doubled by visibly more each time. Read in order the separation widens 0, 82.08, 96.67, 251.11, 483.03 px against camera travel of 966.11 px — the declared ladder 0 / 0.085 / 0.10 / 0.26 / 0.50, applied. A LIMIT OF THE RULER, STATED. Cross-correlation needs structure to lock onto, and void-ground is a near-flat fill: mean-subtracted, it scores the same at every candidate shift. A first pass had it confidently reporting -414 px, which was simply whichever shift the search loop reached first. The script now requires the winning shift to beat everything more than 25 px away by at least 5% before it will report a number, and says 'unmeasurable' otherwise; on this layer the byte-identity is what pins it, and it is a stronger statement than any correlation could make — the same pixels cannot have moved. That correction matters beyond this panel: an earlier version of the same guard used an absolute score threshold and wrongly condemned all three star layers, because a star field is mostly empty and its winning score is tiny in absolute terms while still being a sharp lock. Discrimination, not magnitude, is the test. VERDICT: the zero is established and the ladder is intact, which is what makes the two sky measurements in this round mean something.",
    verdict: 'verified',
  },
];

const PATH = new URL('../manifest.json', import.meta.url);
const manifest = JSON.parse(readFileSync(PATH, 'utf8'));
if (!Array.isArray(manifest)) throw new Error('manifest.json is not an array');

const byId = new Map(manifest.map((e) => [e.id, e]));
let added = 0;
let replaced = 0;
for (const e of ENTRIES) {
  if (byId.has(e.id)) {
    Object.assign(byId.get(e.id), e);
    replaced++;
  } else {
    manifest.push(e);
    added++;
  }
}

// The shape is fixed at eight keys across the whole gallery — keep it that way.
const KEYS = ['id', 'title', 'area', 'image', 'capturedAt', 'buildSha', 'attestation', 'verdict'];
for (const e of ENTRIES) {
  const extra = Object.keys(e).filter((k) => !KEYS.includes(k));
  if (extra.length) throw new Error(`entry ${e.id} carries keys outside the gallery shape: ${extra.join(', ')}`);
}

writeFileSync(PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`manifest: ${manifest.length} items (${added} added, ${replaced} replaced)`);
for (const e of ENTRIES) console.log(`  ${e.verdict.padEnd(12)} ${e.id}`);
