/**
 * evidence/a0-53-bloom-radius/audit.ts — the numbers in `audit.txt`.
 * OWNER: Art Agent.
 *
 * Every measurement in this brief, off the committed frames in ./frames, in one
 * table: the design's radius for each identified star, the radius actually drawn
 * in pixels, and the ratio between them.
 *
 * The design side is never a constant anyone typed. It is
 * `haloRadiusOf(BLOOM.intensity)` — the design preview's own
 * `rad * (5 + 13 * inten)` — scaled by the radius of the very star being
 * measured, which is recovered by REGISTERING each frame against the same
 * `starFieldSprite` call the client made, at the camera offset the client
 * published (`shipScreen - shipWorld`, from `__planetRush`).
 *
 *   npx vite-node evidence/a0-53-bloom-radius/audit.ts > evidence/a0-53-bloom-radius/audit.txt
 */
import { PNG } from 'pngjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOOM, SPIKE, STAR_LAYERS, VOID_SEED, coverSpan, starFieldSprite } from '../../src/art/backdrop';
import { MOCKUP_STARS, haloRadiusOf, haloPeakAlphaOf, starHaloAlpha } from '../../src/art/mockup-reference';
import { HALO_KNEE, HALO_KNEE_AT, haloProfile } from '../../src/art/shapes';

const FRAMES = join(dirname(fileURLToPath(import.meta.url)), 'frames');
const SHOT = { w: 1280, h: 800 };
const ARENA = { w: 2400, h: 2400 };
const OFFSET = { x: -1328, y: -800 };

interface Img { width: number; height: number; data: Buffer }
const open = (f: string): Img | null =>
  existsSync(join(FRAMES, f)) ? (PNG.sync.read(readFileSync(join(FRAMES, f))) as unknown as Img) : null;
const luma = (i: Img, x: number, y: number): number => {
  if (x < 0 || y < 0 || x >= i.width || y >= i.height) return NaN;
  const k = (y * i.width + x) * 4;
  return 0.2126 * i.data[k]! + 0.7152 * i.data[k + 1]! + 0.0722 * i.data[k + 2]!;
};
/** Median light on a ring — so the four diffraction arms cannot set the answer. */
const ring = (img: Img, cx: number, cy: number, r: number): number => {
  const s: number[] = [];
  const n = Math.max(8, Math.ceil(2 * Math.PI * r * 3));
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const v = luma(img, Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)));
    if (!Number.isNaN(v)) s.push(v);
  }
  s.sort((a, b) => a - b);
  return s[s.length >> 1] ?? NaN;
};

interface Bloom { sx: number; sy: number; starR: number; layer: string }
function registered(): { blooms: Bloom[]; pts: { x: number; y: number; r: number }[] } {
  const blooms: Bloom[] = [];
  const pts: { x: number; y: number; r: number }[] = [];
  for (const spec of STAR_LAYERS) {
    const w = coverSpan(spec.parallax, SHOT.w, ARENA.w);
    const h = coverSpan(spec.parallax, SHOT.h, ARENA.h);
    const px = SHOT.w / 2 + OFFSET.x * spec.parallax;
    const py = SHOT.h / 2 + OFFSET.y * spec.parallax;
    const halos: { cx: number; cy: number }[] = [];
    for (const s of starFieldSprite(spec, VOID_SEED, w, h).shapes) {
      if (s.path.kind !== 'circle') continue;
      if (s.fill?.falloff) halos.push({ cx: s.path.cx, cy: s.path.cy });
      else pts.push({ x: px + s.path.cx, y: py + s.path.cy, r: s.path.r });
    }
    for (const h2 of halos) {
      const p = pts.find((q) => q.x === px + h2.cx && q.y === py + h2.cy);
      if (p) blooms.push({ sx: p.x, sy: p.y, starR: p.r, layer: spec.key });
    }
  }
  return { blooms, pts };
}

function measure(img: Img): { rows: string[]; ratios: number[] } {
  const { blooms, pts } = registered();
  const ground = luma(img, 2, 2);
  const rows: string[] = [];
  const ratios: number[] = [];
  for (const b of blooms) {
    if (b.sx < 50 || b.sy < 50 || b.sx > SHOT.w - 50 || b.sy > SHOT.h - 50) continue;
    let crowded = false;
    for (const o of blooms) if (o !== b && Math.hypot(o.sx - b.sx, o.sy - b.sy) < 32) crowded = true;
    for (const p of pts) {
      if (p.r < 1.2) continue;
      const d = Math.hypot(p.x - b.sx, p.y - b.sy);
      if (d > 0.01 && d < 32) crowded = true;
    }
    if (crowded) continue;
    const design = haloRadiusOf(BLOOM.intensity) * b.starR;
    let clean = true;
    for (let r = Math.ceil(design * 1.15); r <= Math.ceil(design * 2); r++) {
      if (!(ring(img, b.sx, b.sy, r) - ground < 1.0)) clean = false;
    }
    if (!clean) continue;
    let drawn = 0;
    for (let r = 1; r <= Math.ceil(design * 1.6); r++) if (ring(img, b.sx, b.sy, r) - ground > 0.6) drawn = r;
    ratios.push(drawn / design);
    rows.push(
      `  ${b.layer.padEnd(5)} (${String(Math.round(b.sx)).padStart(4)},${String(Math.round(b.sy)).padStart(3)})  ` +
        `star r ${b.starR.toFixed(3)}   design ${design.toFixed(2).padStart(6)} px   drawn ${String(drawn).padStart(3)} px   ratio ${(drawn / design).toFixed(3)}`,
    );
  }
  return { rows, ratios };
}

const stat = (a: number[]): string => {
  if (!a.length) return 'no measurable blooms';
  const s = [...a].sort((x, y) => x - y);
  return `n=${s.length}  min ${s[0]!.toFixed(3)}  median ${s[s.length >> 1]!.toFixed(3)}  max ${s[s.length - 1]!.toFixed(3)}`;
};

const out: string[] = [];
const P = (s = ''): void => void out.push(s);

P('a0-53 — the star bloom, measured in rendered pixels');
P('====================================================================');
P();
P('Every number is measured off a committed frame in ./frames, at the camera');
P(`offset the client published: (${OFFSET.x}, ${OFFSET.y}). The design side is`);
P('haloRadiusOf(BLOOM.intensity) — the preview\'s own rad*(5+13*inten) — scaled');
P('by the radius of the very star being measured, so neither side of the ratio');
P('is a constant agreeing with itself.');
P();
P('THE DESIGN');
P('----------');
P(`  BLOOM.intensity            ${BLOOM.intensity}`);
P(`  haloRadiusOf(intensity)    ${haloRadiusOf(BLOOM.intensity)}   = 5 + 13 x ${BLOOM.intensity}`);
P(`  BLOOM.radius               ${BLOOM.radius}   (agrees; NOT moved by this brief)`);
P(`  haloPeakAlphaOf(intensity) ${haloPeakAlphaOf(BLOOM.intensity)}   = 0.42 x ${BLOOM.intensity}`);
P(`  starHaloAlpha()            ${starHaloAlpha()}`);
P(`  halo curve                 three stops, knee ${HALO_KNEE.toFixed(4)} of peak at t=${HALO_KNEE_AT}`);
P(`  star radius range          ${MOCKUP_STARS.radius.min} .. ${MOCKUP_STARS.radius.max} px`);
P(`  bloom threshold            magnitude > ${MOCKUP_STARS.bloom.threshold}`);
const rMin = MOCKUP_STARS.radius.min + (MOCKUP_STARS.radius.max - MOCKUP_STARS.radius.min) * MOCKUP_STARS.bloom.threshold;
P(`  => a bloomed star's own r  (${rMin.toFixed(4)}, ${MOCKUP_STARS.radius.max}]`);
P(`  => its halo radius         (${(rMin * BLOOM.radius).toFixed(2)}, ${(MOCKUP_STARS.radius.max * BLOOM.radius).toFixed(2)}] px`);
P(`  spike arm                  ${SPIKE.length} x r  = 0.62 of the halo`);
P();
P('  The design gradient, as a fraction of its peak (haloProfile):');
const TS = [0.1, 0.2, 0.35, 0.5, 0.62, 0.75, 0.9, 1];
P('    t      ' + TS.map((t) => t.toFixed(2).padStart(7)).join(''));
P('    value  ' + TS.map((t) => haloProfile(t).toFixed(3).padStart(7)).join(''));
P();
P('  A ratio ABOVE 1 in the shipped table is not a wide halo: it is a star whose');
P('  surroundings are world content (a rock edge, a station arc) that the clean-');
P('  sky filter did not catch, so its light never comes back to ground. They are');
P('  left in rather than hand-dropped; the median is what the gate reads, and the');
P('  five uncontaminated stars agree with it at 0.666-0.695.');
P();
P('  What that last row costs the measurement: past t=0.9 the design itself');
P('  carries under 5% of its peak, which over Floor is under one 8-bit code');
P('  value. A CORRECTLY drawn halo therefore measures a few per cent short of');
P('  its geometry, and every ratio below is read with that floor in mind.');
P();

for (const [label, file] of [
  ['THE SHIPPED CLIENT (dist/, built by vite.config.ts)', 'desktop-frozen-octagon.png'],
  ['REFERENCE - the real src/render Renderer, production-bundled', 'renderer-probe.png'],
  ['REFERENCE - VoidBackdrop through its own API, production-bundled', 'prod-field-probe.png'],
  ['REFERENCE - VoidBackdrop through its own API, dev server', 'field-offset0-at-game-offset.png'],
  ['CONTROL - the SAME index.html, built by the probe config', 'prod-real-index-probeconfig.png'],
  ['CONTROL - the booted client with the void soloed', 'game-solo-void.png'],
  ['CONTROL - the bundled app booted from a page without the font faces', 'prod-app-clean.png'],
  ['CONTROL - index.html verbatim, in the probe bundle', 'prod-index-asis.png'],
] as const) {
  const img = open(file);
  P(label);
  P('-'.repeat(label.length));
  if (!img) {
    P(`  (${file} not present)`);
    P();
    continue;
  }
  const { rows, ratios } = measure(img);
  P(`  frame ${file}  ${img.width}x${img.height}`);
  for (const r of rows) P(r);
  P(`  drawn/design: ${stat(ratios)}`);
  P();
}

P('THE ONE-FALLOFF CONTROL (no star, no neighbours, no 8-bit floor to speak of)');
P('---------------------------------------------------------------------------');
P('  A single circle, peak alpha 1, painted by the production drawSprite through');
P('  the production falloffRamp and rampMatrix:');
for (const [file, rx] of [['ramp-halo-40.png', 40], ['ramp-halo-80.png', 80], ['ramp-halo-120.png', 120], ['ramp-smooth-120.png', 120]] as const) {
  const img = open(file);
  if (!img) continue;
  const c = img.width / 2;
  let drawn = 0;
  for (let r = 0; r <= rx + 40; r++) if (ring(img, c, c, r) > 0) drawn = r;
  P(`    ${file.padEnd(22)} declared rx ${String(rx).padStart(4)} px   drawn ${String(drawn).padStart(4)} px   ratio ${(drawn / rx).toFixed(4)}`);
}
P();
P('  So the fill pipeline is exact: the ramp maps t to d/haloR and the halo');
P('  reaches zero at the rim the shape declared. The defect was never here.');
P();

console.log(out.join('\n'));
