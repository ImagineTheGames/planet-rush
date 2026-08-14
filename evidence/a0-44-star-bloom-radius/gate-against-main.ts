/**
 * evidence/a0-44-star-bloom-radius/gate-against-main.ts — **the gate, run the
 * other way.** OWNER: Art Agent.
 *
 * `backdrop.test.ts` asserts *"the halo is wider than its own spikes"*, and a
 * gate that cannot fail is not a gate (LESSONS §24). The test refuses main's
 * numbers inline, as constants; this runs the same five predicates against
 * **main's own source**, so the refusal is a measurement rather than a quotation.
 *
 * ```sh
 * npx vite-node evidence/a0-44-star-bloom-radius/gate-against-main.ts       # this branch: 5/5 pass
 *
 * git worktree add /tmp/a044-main main
 * ln -s "$PWD/node_modules" /tmp/a044-main/node_modules
 * mkdir -p /tmp/a044-main/evidence/a0-44-star-bloom-radius
 * cp evidence/a0-44-star-bloom-radius/gate-against-main.ts \
 *    /tmp/a044-main/evidence/a0-44-star-bloom-radius/
 * (cd /tmp/a044-main && npx vite-node evidence/a0-44-star-bloom-radius/gate-against-main.ts)
 * ```
 *
 * It reads the two constants through `./backdrop`'s own re-exports and builds a
 * real star layer, so it needs nothing that a0-44 added and drops into a `main`
 * worktree unchanged. Exits non-zero if any predicate fails.
 */

import { BLOOM, SPIKE, STAR_LAYERS, VOID_SEED, starFieldSprite } from '../../src/art/backdrop';

const bloom = BLOOM as { radius: number; intensity: number; peakAlpha?: number };
const spike = SPIKE as { length: number };

interface Check {
  readonly name: string;
  readonly got: string;
  readonly ok: boolean;
}

const checks: Check[] = [];
const check = (name: string, ok: boolean, got: string): void => {
  checks.push({ name, ok, got });
};

check(
  'the halo is wider than its own spikes',
  bloom.radius > spike.length,
  `halo ${bloom.radius} r vs spike ${spike.length} r`,
);
check(
  'the halo radius IS the design’s rule, 5 + 13 × intensity',
  bloom.radius === 5 + 13 * bloom.intensity,
  `${bloom.radius} against ${5 + 13 * bloom.intensity}`,
);
check(
  'the spike arm IS the design’s rule, haloRadius × 0.62',
  Math.abs(spike.length - bloom.radius * 0.62) < 1e-9,
  `${spike.length} against ${(bloom.radius * 0.62).toFixed(4)}`,
);
check(
  'the halo’s peak alpha is absolute, 0.42 × intensity',
  bloom.peakAlpha !== undefined && Math.abs(bloom.peakAlpha - 0.42 * bloom.intensity) < 1e-9,
  bloom.peakAlpha === undefined
    ? 'no peak alpha at all — the halo is a fraction of its star’s'
    : `${bloom.peakAlpha}`,
);

// …and on the shapes the game actually builds, not only on the constants.
const layer = STAR_LAYERS.find((l) => l.key === 'mid')!;
let escaped = 0;
let arms = 0;
let halo: { cx: number; cy: number; r: number } | null = null;
for (const s of starFieldSprite(layer, VOID_SEED, 2400, 1600).shapes) {
  if (s.path.kind === 'circle' && s.fill?.falloff) {
    halo = { cx: s.path.cx, cy: s.path.cy, r: s.path.r };
    continue;
  }
  if (s.stroke && halo && s.path.kind === 'poly') {
    arms++;
    for (let i = 0; i < s.path.points.length; i += 2) {
      if (Math.hypot(s.path.points[i]! - halo.cx, s.path.points[i + 1]! - halo.cy) >= halo.r) {
        escaped++;
        break;
      }
    }
  }
}
check(
  'no spike arm reaches past the halo it belongs to',
  escaped === 0,
  `${escaped} of ${arms} arms escape their own halo`,
);

const rows = checks.map((c) => `  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(52)} ${c.got}`);
const failed = checks.filter((c) => !c.ok).length;
// eslint-disable-next-line no-console
console.log(`\n${rows.join('\n')}\n\n  ${checks.length - failed}/${checks.length} pass\n`);
process.exitCode = failed > 0 ? 1 : 0;
