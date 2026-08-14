/**
 * evidence/a0-45-star-temperature-colour/spike-on-main.ts — **what the cross
 * actually measures, on whichever tree it is run in.**
 *
 * Run: `npx vite-node evidence/a0-45-star-temperature-colour/spike-on-main.ts <label>`
 * — the label names the output file, so the two trees do not overwrite each
 * other (`spike-main.txt`, `spike-a0-45.txt`).
 *
 * The a0-45 brief states the spike defect as *"`starAlpha(mag) × 0.55` = 0.55,
 * 5.2× too bright, spike : halo 2.72"*. That is the right defect and the right
 * fix, and the multipliers are the arithmetic with the star at α 1.0. No star in
 * the field reaches α 1.0 — `MOCKUP_STARS.alpha.max` is 0.5 — so this reads the
 * numbers off the generator instead of off the formula, on both trees:
 *
 * ```sh
 * git worktree add /tmp/a045-main main
 * ln -s "$PWD/node_modules" /tmp/a045-main/node_modules
 * mkdir -p /tmp/a045-main/evidence/a0-45-star-temperature-colour
 * cp evidence/a0-45-star-temperature-colour/spike-on-main.ts /tmp/a045-main/evidence/a0-45-star-temperature-colour/
 * (cd /tmp/a045-main && npx vite-node evidence/a0-45-star-temperature-colour/spike-on-main.ts main)
 * ```
 *
 * It reads only `starFieldSprite`'s output — a stroke's alpha and width, and the
 * fill alpha of the halo it belongs to — so it runs unchanged on `main` (where
 * `SPIKE.intensity` still exists) and on this branch (where it does not).
 */

import { STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';
import { MOCKUP_PANEL, MOCKUP_STARS } from '../../src/art/mockup-reference';

const P = MOCKUP_PANEL;

const out: string[] = [];
const say = (s = ''): void => {
  out.push(s);
  // eslint-disable-next-line no-console
  console.log(s);
};

/** Every (halo, its two arms) pair the three layers draw over one screenful. */
function crosses(): { halo: number; spike: number; width: number }[] {
  const pairs: { halo: number; spike: number; width: number }[] = [];
  for (const layer of STAR_LAYERS) {
    let halo = 0;
    for (const s of starFieldSprite(layer, VOID_SEED, P.w, P.h).shapes) {
      if (s.path.kind === 'circle' && s.fill?.falloff) {
        halo = s.fill.alpha;
        continue;
      }
      if (s.stroke && halo > 0) pairs.push({ halo, spike: s.stroke.alpha, width: s.stroke.width });
    }
  }
  return pairs;
}

const pairs = crosses();
const spikes = pairs.map((p) => p.spike);
const halos = pairs.map((p) => p.halo);
const ratios = pairs.map((p) => p.spike / p.halo);
const widths = [...new Set(pairs.map((p) => p.width))];
const design = 0.22 * MOCKUP_STARS.bloom.intensity;

say('the diffraction cross, measured off `starFieldSprite` (a0-45)');
say('=============================================================');
say();
say(`  arms drawn over one ${P.w}×${P.h} panel   ${pairs.length}`);
say(`  spike alpha                          ${Math.min(...spikes).toFixed(4)}–${Math.max(...spikes).toFixed(4)}`);
say(`  halo alpha                           ${Math.min(...halos).toFixed(4)}–${Math.max(...halos).toFixed(4)}`);
say(`  spike : halo                         ${Math.min(...ratios).toFixed(2)}–${Math.max(...ratios).toFixed(2)}`);
say(`  stroke width, px                     ${widths.map((w) => w.toFixed(2)).join(', ')}`);
say();
say(`  the design's cross                   ${design.toFixed(4)}  (0.22 × ${MOCKUP_STARS.bloom.intensity})`);
say(`  the design's halo                    ${MOCKUP_STARS.bloom.peakAlpha}  (0.42 × ${MOCKUP_STARS.bloom.intensity})`);
say(`  the design's spike : halo            ${(0.22 / 0.42).toFixed(2)}  — a flare INSIDE a glow`);
say(`  the design's lineWidth               0.70`);
say();
say(
  `  this tree is ${(Math.max(...spikes) / design).toFixed(2)}× the design at its brightest, ` +
    `${(Math.min(...spikes) / design).toFixed(2)}× at its faintest`,
);
say(
  `  the brief states 5.2× / spike:halo 2.72, which is α 1.0 × 0.55 against the halo;` +
    ` no star reaches α 1.0 (alpha.max ${MOCKUP_STARS.alpha.max})`,
);

const label = process.argv[2] ?? 'a0-45';
const fs = await import('node:fs');
fs.writeFileSync(new URL(`./spike-${label}.txt`, import.meta.url), `${out.join('\n')}\n`);
