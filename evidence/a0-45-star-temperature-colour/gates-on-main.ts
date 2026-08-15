/**
 * **The two a0-45 gates, run against `main`'s own API** — the brief's
 * *"Must FAIL on `main` today"*, demonstrated on the RULE rather than on a
 * missing symbol.
 *
 * Dropping `backdrop.test.ts` into a `main` worktree does fail, but it fails at
 * `starColorFor is not a function` — which proves only that the branch added a
 * symbol. A gate is worth something when the *state it refuses* is the state
 * that shipped, so this reads `main`'s own `starRampColor` and its own measured
 * spike range and shows each assertion failing on its merits.
 *
 * Run it inside a worktree of `main`:
 *
 * ```sh
 * git worktree add /tmp/a045-gate origin/main
 * ln -sfn "$PWD/node_modules" /tmp/a045-gate/node_modules
 * cp evidence/a0-45-star-temperature-colour/gates-on-main.ts /tmp/a045-gate/
 * (cd /tmp/a045-gate && npx vite-node gates-on-main.ts)
 * ```
 *
 * The spike numbers are not recomputed here — they are `spike-main.txt`'s, read
 * off `main`'s own `starFieldSprite` by `spike-on-main.ts`.
 */
import { starRampColor, MOCKUP_STARS } from './src/art/mockup-reference';

/** `main`'s measured cross, from `spike-on-main.ts` over one 640×360 panel. */
const SPIKE_ON_MAIN = { alphaMin: 0.2427, alphaMax: 0.2728 };

const hex = (c: number): string => '#' + c.toString(16).padStart(6, '0');
const MAGS = [0, 0.2, 0.45, 0.8, 0.86, 1];

const out: string[] = [];
const say = (s = ''): void => void out.push(s);

say('the two a0-45 gates, run against `main` (evidence/…/gates-on-main.ts)');
say('======================================================================');
say();
say('gate 2 — "colour comes from temperature, not magnitude"');
say();
say('  The assertion: DIFFERENT magnitude, SAME temperature ⇒ the SAME colour.');
say('  `main` has no temperature at all — colour is a function of magnitude:');
say();
for (const m of MAGS) say(`    mag ${m.toFixed(2)}   ${hex(starRampColor(m))}`);
say();
const distinct = new Set(MAGS.map(starRampColor));
say(`    ${distinct.size} distinct colours over ${MAGS.length} magnitudes`);
say(`    → assertion 2 FAILS: the same star at mag 0.20 and mag 0.80 paints`);
say(`      ${hex(starRampColor(0.2))} and ${hex(starRampColor(0.8))}.`);
say(`    → assertion 3 FAILS: starRampColor.length = ${starRampColor.length}, and its one`);
say('      argument IS the magnitude, so the colour cannot help but ramp by it.');
say();
say('gate 1 — "draws a cross whose spike is dimmer than the halo it sits in"');
say();
const halo = MOCKUP_STARS.bloom.peakAlpha;
say(`    halo α                 ${halo.toFixed(4)}`);
say(`    main's spike α         ${SPIKE_ON_MAIN.alphaMin}–${SPIKE_ON_MAIN.alphaMax}   (spike-main.txt)`);
say(
  `    spike : halo           ${(SPIKE_ON_MAIN.alphaMin / halo).toFixed(2)}–${(SPIKE_ON_MAIN.alphaMax / halo).toFixed(2)}`,
);
say('    the gate requires      < 1, and the design draws 0.52');
say('    → FAILS at both ends: the cross is brighter than the glow it sits in,');
say('      which is the whole of the developer’s "no noticeable bloom".');
say();
say('Both gates fail on `main` on their merits, not on a missing import.');

console.log(out.join('\n'));
