/**
 * evidence/a0-36-name-the-blobs/_entries.mjs — a0-36, the attestations.
 * OWNER: QA Manager.
 *
 * Merges this round's items into `evidence/manifest.json`, replacing any item
 * with the same id so a re-run is idempotent.
 *
 * The attestations below were written **after looking at every plate**, and
 * they describe what is VISIBLE in the image — not what the code claims and not
 * what a script computed. The scripts compute; they do not judge.
 *
 *   node evidence/a0-36-name-the-blobs/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, '..', 'manifest.json');

const SHA = '75ec737';
const AT = '2026-08-13T03:40:00Z';

const items = [
  {
    id: 'a0-36-the-big-soft-discs-are-the-nebula-not-the-bloom',
    title:
      'The Oval, desktop, 75ec737: the large soft discs are Plasma Reef — 39 of them over 31.7% of the frame, median 54 css px — and the bloom in the same frame tops out at 18.5',
    area: 'backdrop',
    image: 'images/a0-36-two-classes-one-scale.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation:
      'THE DEVELOPER IS LOOKING AT THE SKY. Four crops on this plate, every one the SAME 560x560 device-pixel window, so the sizes on it compare directly. Bottom left, the void-nebula-plasmaReef layer drawn alone over the bare Floor at gain 8: eight or nine large soft discs, each one a stack of four visible concentric bands, each one BRIGHTEST AT ITS OWN CENTRE, sitting in overlapping knots of three and four. NOT ONE OF THEM HAS A STAR IN IT. Bottom right, the same window over the three void-stars-* layers alone at the same gain: about a dozen small hard white points, two of them carrying a four-armed glint, the largest with a tight halo perhaps a tenth the width of a disc on the left. Top row is the same two windows at gain 1 — what the player actually sees: the nebula reads as faint smudges, the stars as pinpricks. The table on the plate, read off the frozen isolation: void-nebula-plasmaReef 39 blobs spanning 4.5-563.5 css px, median 54, covering 31.664% of the frame; void-stars-near 13 blobs at 3-18.5; void-stars-mid 18 at 3-11; void-stars-deep 25 at 4.5-8.5; all three star layers together cover 0.183% of the frame. asteroids: 5 blobs at 10-87.5. atmosphere: one halo at 512. SO THE ANSWER TO "BLOOM IS STILL BROKEN" IS THAT THE BIG DISCS ARE NOT BLOOM AND NEVER WERE. They have no star at the centre because nothing on that layer has a star — it is the nebula assigned to this arena. The bloom is in the same frame, on the right, working, and the widest of it is 18.5 css px against a median soft disc of 54. This is the fourth answer of the form "that is behaving as designed", and it is worth something only because it names the object: THEY ARE PLASMA REEF CLOT NODES.',
  },
  {
    id: 'a0-36-nothing-is-stroked-the-ring-is-the-clot-layout',
    title:
      'Ring or glow, settled: 0 of 44 profiled blobs is a donut as an ELEMENT, and 5 of 8 nebula blobs is one as a GROUP — the rim-with-a-darker-centre is Plasma Reef\'s four-node clot layout',
    area: 'backdrop',
    image: 'images/a0-36-ring-or-glow.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation:
      'THE BRIEF ASKED WHETHER SOMETHING IS STROKING RATHER THAN FILLING. Nothing is. On the left of this plate, Plasma Reef alone at gain 8: I count eight large discs, and every one of them is a four-band concentric stack whose innermost band is the brightest part of it — a filled glow, not an annulus. What IS visible is that the discs sit in knots around a common middle, and in the two knots at upper-left and lower-centre THAT MIDDLE IS EMPTY: the bright parts form a rim and the space they enclose is darker than they are. The two bar charts on the right are the same thing measured. From each blob\'s own peak, the radial profile of that layer\'s isolated luma falls monotonically outward from r=0 — the top chart is a clean descending staircase. From each blob\'s CENTROID, the bottom chart RISES outward to a maximum at r=90 device px with an interior dip of 3.425 luma. The table: void-nebula-plasmaReef, 8 blobs profiled, 0 rings by the element test, 5 by the group test; the three star layers, 24 blobs profiled, 0 RINGS BY EITHER TEST; asteroids 5 blobs, 0 element rings and 5 group rings; vfx-light 7 blobs, 0 and 2. So starFieldSprite\'s three filled discs and softDisc\'s four-stop stack both composite to a glow exactly as written, and the donut the developer sees is PLASMA_REEF.build\'s clot layout — four nodes placed at (n/4)*2pi + jitter, spread*(0.45..1) from a common centre, i.e. ON A CIRCLE WITH NOTHING IN THE MIDDLE. Four filled glows arranged on a ring read as a ring. That is why reading the element\'s source said a donut was impossible while the frame still showed one. THE MEASUREMENT HAS A STATED FLOOR: a dip must clear one 8-bit code value, because an additive stack bands at 1-3 levels a stop and anything smaller is quantisation wearing a shape\'s clothes. THE ZERO CONTROL IS ON THE PLATE AND IT PASSES: every layer with no children in the frozen frame differenced to exactly 0 px (chunks, muzzles, impacts, shots), and the frame re-shot after all the toggling differed from the first by 0 px, peak 0.',
  },
  {
    id: 'a0-36-every-sky-arena-puts-a-quarter-of-the-frame-under-soft-discs',
    title:
      'All six arenas, both viewports: a light-painting sky covers 13-43% of the frame in soft discs up to 1440 css px, while the widest star+bloom anywhere in the round is 18.5 — and the Octagon control has no such layer at all',
    area: 'backdrop',
    image: 'images/a0-36-inventory-by-arena.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation:
      'TWELVE ROWS, ONE PER ARENA AND VIEWPORT, ALL ON 75ec737. Reading the table on the plate: oval/desktop plasmaReef 31.664% of frame, 39 blobs, 4.5-563.5 css px; oval/phone 33.113%, 31, 9-315.3; diamond/desktop patinaDrift 27.648%, 74, 4-499.5; diamond/phone 26.322%, 51, 4.3-342; line/desktop deepEmber 43.368%, 29, 4-1050.5; line/phone 26.226%, 13, 4.3-373.3; crescents/desktop ironVeil 34.662%, 33, 5-1440; crescents/phone 13.439%, 20, 6.3-383.3. The "widest star+bloom" column, over every one of those rows, never exceeds 18.5 css px. TWO ROWS ARE CONTROLS AND BOTH BEHAVE. octagon/desktop and octagon/phone are assigned sky "none": the plate shows 0% of frame, 0 blobs and a dash for span — there is no void-nebula-* layer on that arena to hide, so hiding it moves nothing, which is the same null a1-07 used. compass/desktop and compass/phone show coalsack at 0.116% and 0.057%, 39 and 5 blobs, spans 3-12 css px, and that small number is correct rather than a miss: Coalsack is painted in Floor\'s own colour in front of the star field to REMOVE stars, so it adds no light and hiding it only gives back the handful of stars it covered. THE CONCLUSION THE TABLE SUPPORTS: there is no arena, no viewport and no VFX tier at which the sky\'s discs and a star\'s bloom are the same class of object. The discs run to several hundred css px; the bloom stops at 18.5. Whatever arena the developer was on, if it had a sky, the large soft discs in their frame were that sky.',
  },
  {
    id: 'a0-36-a-star-and-the-disc-it-sits-on-are-different-layers-at-different-parallax',
    title:
      'The drift, measured two ways on one flight: nebula 0.085, stars 0.10 / 0.26 / 0.50, world 1 — a star sitting on a clot node slides off it by 252-598 css px per screen-width, and that is the design',
    area: 'backdrop',
    image: 'images/a0-36-drift-per-screen-width.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation:
      'THE SECOND HALF OF THE REPORT — "the bloom seems to move when i move the camera". One boot, ONE live flight of 679.4 css px of camera pan on The Oval, flown by clicking because Tap Commander is the shipped default scheme (a0-33), with every class photographed at both ends. The table on this plate carries two independent columns. READ is the layer own position taken off the running build: void-nebula-plasmaReef 0.085, void-stars-deep 0.1, void-stars-mid 0.26, void-stars-near 0.5, world 1. MEASURED is the same layer pixels cross-correlated between the two frames, which needs no faith in the first column at all: 0.0854, 0.1001, 0.2598, 0.4997, at lags of 116, 136, 353 and 679 device px inside a 1296 px search, correlations 0.9996, 0.9965, 0.989 and 0.9538. THE TWO COLUMNS AGREE TO 0.0004 ON ALL FOUR. So nothing is moving a backdrop layer outside position, and the running build parallax IS SKY_PARALLAX 0.085 and STAR_LAYERS 0.10 / 0.26 / 0.50. The two strips at the bottom left are the same band of screen before and after that one flight, at gain 7. In the Plasma Reef pair the knots of soft discs shift a little to the right. In the void-stars-near pair the bright four-armed star at the far left of the "before" strip is most of the way across the "after" strip — the same flight, the same band, several times the distance. ONE ROW DID NOT MEASURE CLEANLY AND IT IS ON THE PLATE RATHER THAN DROPPED: the world row lag sat exactly on the 1296 px boundary of its own search at r 0.3814, because a parallax-1 layer moves the whole camera pan, which is past the 45 percent of frame that still leaves a band to correlate over, and its content is live sim that moved between the two shots as well. Its read ratio is 1 by construction — the world container position IS the camera offset — so its measured column is a floor and is labelled railed. WHAT THIS SETTLES: a Plasma Reef clot travels 122.4 css px per screen-width flown, a mid star 374.4 and a near star 720, so a star that happens to sit on a clot node — the ONLY way a soft disc ever has a star in it — slides off it at 252 px per screen-width if it is a mid star and 598 if it is a near one. That is the "weird effect", and nothing is coming apart: they were never one object. WHAT IS NOT HAPPENING is a halo separating from its own star; every star layer read and measured ratio agree, so no star layer moves relative to itself.',
  },
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const ids = new Set(items.map((i) => i.id));
const kept = manifest.filter((i) => !ids.has(i.id));
writeFileSync(MANIFEST, `${JSON.stringify([...kept, ...items], null, 2)}\n`);
console.log(`manifest: ${kept.length} kept + ${items.length} a0-36 = ${kept.length + items.length}`);
