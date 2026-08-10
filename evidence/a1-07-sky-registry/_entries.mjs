/**
 * evidence/a1-07-sky-registry/_entries.mjs — the a1-07 manifest entries.
 * OWNER: QA Manager.
 *
 * Written by hand AFTER looking at every plate. The scripts in this directory
 * compute; nothing here is generated from them. Merge into the gallery with:
 *
 *   node evidence/a1-07-sky-registry/_entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SHA = 'dd1d3f5';
const SHOT = '2026-08-10T02:40:26Z';
const PROBE = '2026-08-10T02:42:50Z';

const ENTRIES = [
  // ── The six arenas ────────────────────────────────────────────────────────
  {
    id: 'a1-07-octagon-sky-none',
    title: 'The Octagon — MAP_NEBULA says none, and the running build draws nothing: the sky-isolation difference is identically zero',
    area: 'match',
    image: 'images/a1-07-octagon-sky-none.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "THE DEFAULT ARENA, AND THE HIGHEST-VALUE CELL IN THE TABLE — a fresh install lands on octagon (DEFAULT_MAP_ID) and MAP_NEBULA.octagon is the one entry that says `none`. Served bundle dd1d3f5 (/version.json, and the build badge reads dd1d3f5 in the live frame), desktop 1440x900 at dpr 2, map pinned through localStorage['planet-rush:mapId']='octagon'. THE STAGE WAS READ, NOT EYEBALLED. `Void.build()` labels every layer it makes and the label carries the registry's own answer — `void-nebula-${this.nebula.id}` is written from the same `nebula.id` that `nebulaSprite()` draws from, so a label cannot disagree with the geometry. The live Pixi scene graph, walked through pixi.js 8.6.6's own `__PIXI_APP_INIT__` devtools hook (an init-script in the harness; nothing in src/ was touched, this being a read-only round), holds FOUR children in the void container and their draw order back-to-front is `void-ground > void-stars-deep > void-stars-mid > void-stars-near`. THERE IS NO `void-nebula-*` CHILD AT ALL — on the live `?debug=1` boot and on the frozen `?debug=1&freeze=1` one alike. WHAT THE PLATE SHOWS. Panel A is the seeded pinned world with everything drawing. Panel C is the same frozen frame with all three star layers hidden — there is no nebula layer here to hide, so the star layers are what the second panel can subtract. Panel D has EVERY void layer but the ground hidden: Floor and the world, nothing else. The third panel is |A - B| x 14, the sky's own pixels — and it is BLACK. Not faint: 0.0% of the frame touched, peak channel delta 0, peak luma delta 0. Not one pixel of a 2880x1800 frame changed when `void-nebula-*` was hidden, because there was nothing there to hide. THAT ZERO IS ALSO THE METHOD'S NULL CONTROL. Every other arena's isolation number is a difference between two screenshots of a `?freeze=1` world taken seconds apart; octagon proves that difference has no noise floor to clear — the sim really is pinned, and a non-zero reading elsewhere is a layer, not jitter. For scale, the same subtraction against the star layers on this same frame touches 0.2% of the frame at peak luma delta 228: the instrument is not blind, it simply found nothing. VERDICT: the registry entry `octagon: 'none'` is what the shipped build does. Nothing draws a sky on the default arena.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-compass-coalsack',
    title: 'The Compass — Coalsack is on the stage and drawn LAST, in front of all three star layers; 2,409 pixels of star are covered, and the field is not stuck to the glass',
    area: 'match',
    image: 'images/a1-07-compass-coalsack.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "MAP_NEBULA.compass says `coalsack` and the live stage answers `void-nebula-coalsack`, on both the live `?debug=1` boot and the frozen one, on served dd1d3f5. THE DRAW ORDER IS THE HALF OF THIS THAT MATTERS: `void-ground > void-stars-deep > void-stars-mid > void-stars-near > void-nebula-coalsack` — the sky is the LAST child, i.e. in FRONT of every star layer, which is what `occludes: true` is for and is the reverse of the other four skies (all of which sit second, behind the stars). IT ADDS NO LIGHT, WHICH IS WHY IT LOOKS LIKE A FAULT. Over the whole frozen frame, hiding it changed 0.1% of pixels, and the mean ink of that difference is r17.8 g18.4 b18.9 — NEUTRAL GREY. That is not Coalsack's colour; Coalsack has no colour, it is the ground colour. It is the colour of the STARS it was standing in front of. A sky that paints Floor over Floor is invisible; a sky that paints Floor over a star is a missing star. THE PATCH WHERE THE FIELD STOPS. 2,409 pixels of star are covered across the frame. The plate's top row zooms 3x on the 400x250 device-px window holding the most of them — chosen BY the measurement, so it cannot have been chosen to flatter — showing the same window with the dust drawing (empty void), with `void-nebula-coalsack` hidden (two bright stars and several faint ones return), and the difference. IN MOTION, which is the read a still cannot carry. One straight live flight west, three camera positions (ship world x 1752 -> 1279 -> 934). Star points were extracted per frame and their per-column density profiles cross-correlated. On both short baselines the field re-aligns at 10.0% and 9.9% of the camera's travel — the deep star layer's `parallax 0.1` to within a pixel (95 px measured vs 95 predicted; 68 vs 69) — and scores materially worse at zero shift (0.513 vs 0.611, 0.431 vs 0.603). SO THE STAR-POOR STRUCTURE TRAVELS WITH THE STAR FIELD, NOT WITH THE SHIP AND NOT WITH THE SCREEN. WHAT IT DOES NOT SETTLE, said plainly: it does not resolve Coalsack's own `parallax 0.14` from the 0.10 of the stars it eats — those predictions are 4% of camera travel apart (37 px and 28 px on these baselines) and a few hundred star pixels will not separate them; 0.14 scores below 0.10 on every pair, which is the expected answer for a profile made of stars rather than of dust. The long baseline (frames 1->3) fails openly: it peaks at 33 px and scores best of all at zero. Two real reasons — the star field is not rigid (deep 0.10, mid 0.26, near 0.50 separate by hundreds of px over 1636 px of travel), and frame 1 alone contains the home station's dashed range rings, thin and dim enough to survive the point detector as fixed structure near frame centre. Pair 2->3 is the clean one and it is the one that lands on 0.10. VERDICT: the entry is right, the ordering is right, and the shape is a dust lane in front of the stars rather than a rendering fault.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-oval-plasmareef',
    title: 'The Oval — Plasma Reef is on the stage, behind the stars, on `add`; isolated it is unmistakably the reef, cyan ringed blobs over a deep blue wash',
    area: 'match',
    image: 'images/a1-07-oval-plasmareef.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "MAP_NEBULA.oval says `plasmaReef`; the frozen live stage answers `void-nebula-plasmaReef`, on served dd1d3f5. Draw order back-to-front: `void-ground > void-nebula-plasmaReef > void-stars-deep > void-stars-mid > void-stars-near` — second, i.e. BEHIND all three star layers, which is correct for a sky of light rather than of dust. Its blend mode reads `add` off the live node, the only one of the five that is not `inherit`. ISOLATED, IT IS THE REEF AND NOT MERELY 'SOMETHING BLUE'. Hiding that one layer on the pinned `?freeze=1` world and subtracting gives a difference touching 30.1% of the frame at peak luma delta 15 of 255 — a broad, faint wash, which is what a0-07's 'subtle' means in numbers. Amplified 14x it resolves into DOZENS OF CONCENTRIC CYAN RINGED DISCS, like polyps, scattered over a deep blue field: the reef's own shape, quite unlike Patina Drift's angular plates, Deep Ember's red coals or Iron Veil's diagonal bands, all four measured off the same instrument on the same build. The mean ink where the layer paints is r0.52 g1.61 b2.76 — blue-dominant, and dim enough that at page scale panel A and panel B are hard to tell apart by eye, which is exactly why the layer label and the subtraction were used instead of eyes. ONE THING THIS FRAME ALSO SHOWS, and it needed its own shot: the LIVE `?debug=1` read of the same bundle came back with NO nebula layer, while the frozen read had plasmaReef. That is not a registry fault — see `a1-07-oval-sky-drops-on-throttle`, where it is watched happening with a control beside it. VERDICT: the registry entry is what the build loads.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-diamond-patinadrift',
    title: 'Double Diamond — Patina Drift is on the stage, behind the stars; isolated it is angular teal-and-ochre plates, not a generic teal wash',
    area: 'match',
    image: 'images/a1-07-diamond-patinadrift.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "MAP_NEBULA.diamond says `patinaDrift`; the live stage answers `void-nebula-patinaDrift` on BOTH the live `?debug=1` boot and the frozen `?debug=1&freeze=1` one, on served dd1d3f5. Draw order back-to-front: `void-ground > void-nebula-patinaDrift > void-stars-deep > void-stars-mid > void-stars-near` — behind the star field, blend mode `inherit` (no additive pass, as the registry's own note says). ISOLATED BY HIDING EXACTLY THAT ONE LAYER on the pinned world, the difference touches 25.9% of the frame at peak luma delta 14.2 of 255, mean ink r1.66 g2.70 b2.48. Amplified 14x the shape is legible and it is specific: FLAT ANGULAR LOZENGES AND PLATES, overlapping like sheets, in verdigris teal with warm ochre through the larger ones. That is the 'old system' tint the registry says this board takes, and it is not what any other sky in the set looks like under the same amplification — this is the difference between 'looks teal' and 'is patinaDrift'. The black voids inside the amplified image are where opaque world objects (the station bodies, the HUD strips) stand in front of the sky and there is therefore nothing to subtract. VERDICT: the registry entry is what the build loads.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-line-deepember',
    title: 'The Line — Deep Ember is on the stage, behind the stars; isolated it is red-dominant coals, the faintest sky of the five at peak luma delta 7.3',
    area: 'match',
    image: 'images/a1-07-line-deepember.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "MAP_NEBULA.line says `deepEmber`; the live stage answers `void-nebula-deepEmber` on both the live and the frozen boot, on served dd1d3f5. Draw order back-to-front: `void-ground > void-nebula-deepEmber > void-stars-deep > void-stars-mid > void-stars-near` — behind the stars, blend mode `inherit`. ISOLATED, THE INK IS THE CLAIM: mean r4.41 g1.13 b1.04 where the layer paints — red at roughly four times either other channel, the only warm sky in the set (Iron Veil, the other warm one, measures r6.26 g4.34 b4.34, i.e. warm-GREY; Plasma Reef and Patina Drift are both blue- or green-dominant). Amplified 14x the difference resolves into LARGE CONCENTRIC RED-ORANGE COALS with soft rims, several per screen. It is also the WIDEST and the FAINTEST sky measured here: it touches 41.1% of the frame — more than any other — at peak luma delta 7.3 of 255, half of Plasma Reef's 15 and the lowest of the five. On the unamplified frame A that reads as a barely-there warm cast at the frame edges, and nothing at all in the middle. VERDICT: the registry entry is what the build loads.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-crescents-ironveil',
    title: 'The Crescents — Iron Veil is on the stage, behind the stars; laminated diagonal bands with rust through them, and the only sky of the five plainly visible unamplified',
    area: 'match',
    image: 'images/a1-07-crescents-ironveil.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "MAP_NEBULA.crescents says `ironVeil`; the live stage answers `void-nebula-ironVeil` on both the live and the frozen boot, on served dd1d3f5. Draw order back-to-front: `void-ground > void-nebula-ironVeil > void-stars-deep > void-stars-mid > void-stars-near` — behind the stars, blend mode `inherit`. ISOLATED it touches 34.5% of the frame at peak luma delta 12.3 of 255, mean ink r6.26 g4.34 b4.34 — warm grey, red slightly ahead of two equal lower channels, i.e. iron with rust in it rather than a colour. Amplified 14x the shape is a set of LONG STRAIGHT DIAGONAL BANDS running lower-left to upper-right, laminated in overlapping strips, grey sheets with red-rust ones among them. That is the registry's 'laminated iron band with rust through it'. A NOTE ON HOW IT READS, which is taste for the Director and not a wiring fault: this is the one sky of the five I can see plainly in the UNAMPLIFIED frame A — the diagonal bands are visible as broad soft streaks across the open field at page scale, where Plasma Reef, Patina Drift and Deep Ember all need the subtraction to be seen at all. It matches its registry entry exactly; whether the busiest frame in the set wants the most legible sky is a question for the developer, who picked 'subtle', not a defect to fix here. VERDICT: the registry entry is what the build loads.",
    verdict: 'verified',
  },

  // ── What the round turned up on the way ───────────────────────────────────
  {
    id: 'a1-07-oval-sky-drops-on-throttle',
    title: 'The Oval is the only arena that can end up with NO sky on a throttled client — plasmaReef alone has reducedDensity 0, watched dropping at t+8.3 s with a control beside it',
    area: 'match',
    image: 'images/a1-07-oval-sky-drops-on-throttle.png',
    capturedAt: PROBE,
    buildSha: SHA,
    attestation:
      "FOUND BY THE SIX-ARENA SWEEP DISAGREEING WITH ITSELF: on The Oval, `?debug=1&freeze=1` had `void-nebula-plasmaReef` on the stage and a LIVE `?debug=1` boot of the same served dd1d3f5 bundle had no nebula layer at all. Every other arena answered the same both ways. Rather than infer the cause, it was watched. Two live boots run SIDE BY SIDE on the same box under the same load for 40 s, polling the scene graph and the published fps once a second: oval (plasmaReef, `reducedDensity 0`) as the subject, line (deepEmber, `reducedDensity 1`) as the CONTROL — without which 'the reef left' is equally well explained by the box, the bundle or the harness. WHAT HAPPENED. Oval booted WITH `void-nebula-plasmaReef` on the stage and held it for three polls; at t+8.3 s the layer was gone, and it never came back in the remaining 32 s. Line booted with `void-nebula-deepEmber` and still had it at t+40 s, every one of the forty polls green. Both clients sat at the same frame rate throughout (oval 3.2 -> 1.9 fps, line 3.0 -> 1.9, median 2 fps each). The two after-40s frames corroborate: the oval frame is a bare star field, the line frame still carries visible warm coals bottom-left and right. THE MECHANISM, and it is designed: `Void.build()` computes `density = reduced ? nebula.reducedDensity : 1` then `drawSky = id !== 'none' && density > 0`, and plasmaReef is the ONLY sky whose `reducedDensity` is 0 — coalsack 1, deepEmber 1, ironVeil 0.5, patinaDrift 0.45. So when `VfxAutoQuality` engages (`DEFAULT_VFX_QUALITY`: smoothed fps at or under 30, held 3 s) the reef is the one sky that goes to nothing, and The Oval is the one arena of six that can be played with no sky at all. Freeze never throttles (`flags.freeze ? false : vfxQuality.sample(...)`), which is why the frozen frame kept it. THIS IS NOT A BUG AND NOT A REGISTRY FAULT — MAP_NEBULA.oval says plasmaReef and the build loads plasmaReef; a0-07 chose the drop deliberately ('under VfxAutoQuality the reef is the sky that drops, so a throttled phone stops paying for it entirely'). It is a consequence of the registry that the registry does not state, and it is filed so the Director can decide whether the developer should know that one of six arenas has a sky that can leave mid-match. SCOPE, honestly: this box is software WebGL running two contexts at once at a median 2 fps, nowhere near a real device. What is demonstrated is the MECHANISM and which sky it takes — not that any particular phone crosses the 30 fps line. A client that never drops below 30 fps never sees this.",
    verdict: 'verified',
  },
  {
    id: 'a1-07-grey-discs-are-the-rocks',
    title: "The soft grey discs on the default arena are the ASTEROIDS, not the backdrop — 10 of them survive with every void layer hidden, median 62.7 px across, 3.3x the largest bloom halo",
    area: 'match',
    image: 'images/a1-07-grey-discs-are-rocks.png',
    capturedAt: SHOT,
    buildSha: SHA,
    attestation:
      "THE REPORT THIS ROUND WAS CALLED FOR: 'it doesnt look right, perhaps the stars that are supposed to be there are underneath?', from live play, on soft grey discs in an otherwise empty field. The registry half is closed by `a1-07-octagon-sky-none`: on octagon, the DEFAULT arena, there is no `void-nebula-*` layer on the stage and hiding that prefix changes zero pixels. So the discs are not the sky. THIS ASKS WHAT THEY ARE, off the frame. The frame used has EVERY void layer but `void-ground` hidden — no sky, not one star, NOT ONE BLOOM HALO — so anything still standing in the empty field is a world object. A flood fill over everything brighter than Floor and neutral in hue (which already excludes the station's blue rings, the ore's yellow and the HUD text) finds 16 objects. SIX OF THEM ARE NAMED RATHER THAN QUIETLY COUNTED IN: one station body / halo ring (512x512 px), two station parts sitting inside that ring, and three arena wall bands (the 1-10 px x 635 px slivers that are ARENA_WALL_BANDS, the edge of the world). THE OTHER TEN ARE ROCKS: compact (elongation 1.0-2.1), neutral mid-grey (mean ink clustered rgb(51-64, 57-70, 64-78) — the rock family), with the lighter silhouette rim that makes them read as soft-edged at page scale. Their equivalent diameters run 16.8 to 74.2 CSS px, median 62.7. THE COMPARISON THE BRIEF ALREADY SET UP: the largest star is the `near` layer at `maxR 2.2` and its outer bloom halo is 4.3x that — 18.9 px across at ~6% alpha (`BLOOM.intensity[1] = 0.065`). The median disc here is 3.3x that halo AND OPAQUE rather than a 6% wash. The ruling-out in the brief holds, and this is what is left standing. It also fits the report's own wording: 'the stars that are supposed to be there are underneath' is exactly true of an opaque rock. VERDICT — INCONCLUSIVE, and deliberately so. What is proven is what is in THIS frame: on the default arena, with no sky and every star layer off, the empty field still contains ten soft-edged neutral-grey discs several times the size of the largest bloom, and they are the asteroids. What is NOT proven is that this is what the developer was looking at — nobody has matched their frame to a map, a build or a moment, and they may have been on one of the five arenas that does carry a sky. This is a lead for the Director to take back to them, not a closed answer.",
    verdict: 'inconclusive',
  },
];

const path = new URL('../manifest.json', import.meta.url);
const m = JSON.parse(readFileSync(path, 'utf8'));
for (const e of ENTRIES) {
  const i = m.findIndex((x) => x.id === e.id);
  if (i >= 0) m[i] = e;
  else m.push(e);
}
writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
console.log(`merged ${ENTRIES.length} a1-07 entries; manifest now has ${m.length} items`);
