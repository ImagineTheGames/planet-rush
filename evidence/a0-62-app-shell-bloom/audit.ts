/**
 * evidence/a0-62-app-shell-bloom/audit.ts — the halo's reach, per device-pixel
 * ratio, off the real app shell. OWNER: Art Agent.
 *
 * The brief's instrument: *"sample outward from the brightest star and record
 * how far luminance stays above the ground. State the halo's reach in pixels
 * per configuration."*
 *
 * Every frame is REGISTERED before it is measured — the same `starFieldSprite`
 * call the client made, placed at the camera offset the client published
 * (`shipScreen − shipWorld`, from `__planetRush`, recorded beside each frame).
 * So a measured blob is identified rather than guessed at, and its design
 * radius is `haloRadiusOf(BLOOM.intensity) × the radius of THAT star` — the
 * design preview's own rule, never a constant typed in here.
 *
 * Reach is reported in **CSS pixels**: a frame at `deviceScaleFactor 2` is
 * 2560×1600 device pixels of the same 1280×800 CSS view, so device radii are
 * divided by the ratio and the four rows are directly comparable. Luminance is
 * NOT scaled — alpha compositing is resolution-independent, so a correct halo
 * traces the same luma-versus-CSS-radius curve at every ratio.
 *
 *   npx vite-node evidence/a0-62-app-shell-bloom/audit.ts > evidence/a0-62-app-shell-bloom/audit.txt
 */
import { PNG } from 'pngjs';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BLOOM, STAR_LAYERS, VOID_SEED, coverSpan, starFieldSprite } from '../../src/art/backdrop';
import { haloRadiusOf } from '../../src/art/mockup-reference';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRAMES = join(HERE, 'frames');
/** The frozen desktop boot, in CSS pixels, and `octagon`'s arena. */
const SHOT = { w: 1280, h: 800 };
const ARENA = { w: 2400, h: 2400 };

interface Img {
  width: number;
  height: number;
  data: Buffer;
}
const open = (f: string): Img | null =>
  existsSync(join(FRAMES, f)) ? (PNG.sync.read(readFileSync(join(FRAMES, f))) as unknown as Img) : null;

const luma = (i: Img, x: number, y: number): number => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= i.width || yi >= i.height) return NaN;
  const k = (yi * i.width + xi) * 4;
  return 0.2126 * i.data[k]! + 0.7152 * i.data[k + 1]! + 0.0722 * i.data[k + 2]!;
};

/** Median light on the ring of radius `r` DEVICE pixels — a median, so the four
 *  diffraction arms (a few per cent of any ring) cannot set the answer. */
const ring = (img: Img, cx: number, cy: number, r: number): number => {
  const s: number[] = [];
  const n = Math.max(8, Math.ceil(2 * Math.PI * r * 3));
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const v = luma(img, cx + r * Math.cos(a), cy + r * Math.sin(a));
    if (!Number.isNaN(v)) s.push(v);
  }
  s.sort((a, b) => a - b);
  return s[s.length >> 1] ?? NaN;
};

interface Bloom {
  /** Centre in CSS pixels. */
  sx: number;
  sy: number;
  /** The star's OWN radius — what the design's rule scales. */
  starR: number;
  layer: string;
}

/** Every bloomed star the client drew, in CSS pixels, at the offset it drew at. */
function registered(offset: { x: number; y: number }): {
  blooms: Bloom[];
  pts: { x: number; y: number; r: number }[];
} {
  const blooms: Bloom[] = [];
  const pts: { x: number; y: number; r: number }[] = [];
  for (const spec of STAR_LAYERS) {
    const w = coverSpan(spec.parallax, SHOT.w, ARENA.w);
    const h = coverSpan(spec.parallax, SHOT.h, ARENA.h);
    const px = SHOT.w / 2 + offset.x * spec.parallax;
    const py = SHOT.h / 2 + offset.y * spec.parallax;
    const halos: { cx: number; cy: number }[] = [];
    for (const s of starFieldSprite(spec, VOID_SEED, w, h).shapes) {
      if (s.path.kind !== 'circle') continue;
      if (s.fill?.falloff) halos.push({ cx: s.path.cx, cy: s.path.cy });
      else pts.push({ x: px + s.path.cx, y: py + s.path.cy, r: s.path.r });
    }
    for (const halo of halos) {
      const p = pts.find((q) => q.x === px + halo.cx && q.y === py + halo.cy);
      if (p) blooms.push({ sx: p.x, sy: p.y, starR: p.r, layer: spec.key });
    }
  }
  return { blooms, pts };
}

/** A bloom is measurable only on empty sky: no neighbour close enough to add
 *  light (a MODEL question) and nothing but backdrop out past its own reach (a
 *  PIXEL question, asked of the annulus beyond the design radius). */
function measurable(img: Img, dpr: number, offset: { x: number; y: number }): Bloom[] {
  const { blooms, pts } = registered(offset);
  const ground = luma(img, 2, 2);
  const out: Bloom[] = [];
  for (const b of blooms) {
    if (b.sx < 50 || b.sy < 50 || b.sx > SHOT.w - 50 || b.sy > SHOT.h - 50) continue;
    let crowded = false;
    for (const o of blooms) if (o !== b && Math.hypot(o.sx - b.sx, o.sy - b.sy) < 32) crowded = true;
    for (const p of pts) {
      if (p.r < 1.2) continue; // a faint star adds under one code value
      const d = Math.hypot(p.x - b.sx, p.y - b.sy);
      if (d > 0.01 && d < 32) crowded = true;
    }
    if (crowded) continue;
    const design = haloRadiusOf(BLOOM.intensity) * b.starR;
    let clean = true;
    for (let r = Math.ceil(design * 1.15); r <= Math.ceil(design * 2); r++) {
      if (!(ring(img, b.sx * dpr, b.sy * dpr, r * dpr) - ground < 1.0)) clean = false;
    }
    if (clean) out.push(b);
  }
  return out;
}

/** How far out from a star luminance stays above the ground, in CSS pixels.
 *  Stepped in whole CSS pixels so the four ratios read on one scale. */
function reach(img: Img, b: Bloom, dpr: number, ground: number, limit: number): number {
  let out = 0;
  for (let r = 1; r <= limit; r++) {
    if (ring(img, b.sx * dpr, b.sy * dpr, r * dpr) - ground > 0.6) out = r;
  }
  return out;
}

/** The radial profile, for the audit's own eyes: luma above ground at each CSS
 *  radius out to the design's rim and a little past it. */
function profile(img: Img, b: Bloom, dpr: number, ground: number, to: number): string {
  const cells: string[] = [];
  for (let r = 2; r <= to; r += 2) {
    const d = ring(img, b.sx * dpr, b.sy * dpr, r * dpr) - ground;
    cells.push(`${r}:${d.toFixed(1)}`);
  }
  return cells.join('  ');
}

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1] ?? NaN;

function table(name: string, file: string): void {
  const img = open(`${file}.png`);
  if (!img) {
    console.log(`  (${file}.png absent)`);
    console.log('');
    return;
  }
  const metaFile = join(FRAMES, `${file}.json`);
  const meta = existsSync(metaFile)
    ? (JSON.parse(readFileSync(metaFile, 'utf8')) as {
        dpr: number;
        cameraOffset: { x: number; y: number };
        canvas: { backing: { w: number; h: number }; css: { w: number; h: number }; dpr: number };
      })
    : null;
  if (!meta) {
    console.log(`  (${file}.json absent — the frame cannot be registered)`);
    console.log('');
    return;
  }
  const dpr = meta.dpr;
  const ground = luma(img, 2, 2);
  console.log(`${name}`);
  console.log(`${'-'.repeat(name.length)}`);
  console.log(
    `  frame ${file}.png  ${img.width}x${img.height} device px` +
      `  =  ${meta.canvas.css.w}x${meta.canvas.css.h} css @ dpr ${dpr}` +
      `   ground luma ${ground.toFixed(1)}`,
  );
  if (img.width !== Math.round(SHOT.w * dpr)) {
    console.log(`  !! the frame is not ${SHOT.w} css px wide at this ratio — registration would be wrong`);
    console.log('');
    return;
  }

  const blooms = measurable(img, dpr, meta.cameraOffset);
  const rows: { b: Bloom; design: number; drawn: number; ratio: number }[] = [];
  for (const b of blooms) {
    const design = haloRadiusOf(BLOOM.intensity) * b.starR;
    const drawn = reach(img, b, dpr, ground, Math.ceil(design * 1.6));
    rows.push({ b, design, drawn, ratio: drawn / design });
  }
  rows.sort((p, q) => q.b.starR - p.b.starR);
  for (const r of rows) {
    console.log(
      `  ${r.b.layer.padEnd(5)} (${String(Math.round(r.b.sx)).padStart(4)},${String(Math.round(r.b.sy)).padStart(3)})` +
        `  star r ${r.b.starR.toFixed(3)}   design ${r.design.toFixed(2)} px` +
        `   REACH ${String(r.drawn).padStart(3)} px   ratio ${r.ratio.toFixed(3)}`,
    );
  }
  if (rows.length) {
    const m = median(rows.map((r) => r.ratio));
    console.log(
      `  reach/design: n=${rows.length}  min ${Math.min(...rows.map((r) => r.ratio)).toFixed(3)}` +
        `  median ${m.toFixed(3)}  max ${Math.max(...rows.map((r) => r.ratio)).toFixed(3)}`,
    );
    // The brightest star in the frame, sampled outward — the brief's own read.
    const brightest = rows[0]!;
    console.log(
      `  brightest star (${Math.round(brightest.b.sx)},${Math.round(brightest.b.sy)}), luma above ground by css radius:`,
    );
    console.log(`    ${profile(img, brightest.b, dpr, ground, Math.ceil(brightest.design * 1.3))}`);
  } else {
    console.log('  (no bloom on clean sky — nothing measurable in this frame)');
  }
  console.log('');
}

console.log('a0-62 — the star bloom, measured off the REAL app shell, per device-pixel ratio');
console.log('='.repeat(78));
console.log('');
console.log('Frames are the shipped `index.html` + `src/main.ts`, built by the app\'s own');
console.log('vite.config.ts and served by `vite preview`, driven at four deviceScaleFactors');
console.log('(evidence/a0-62-app-shell-bloom/capture.mjs). Same 1280x800 CSS viewport, same');
console.log('frozen boot (?debug=1&freeze=1 => octagon, whose sky is NONE), same camera');
console.log('offset (-1328,-800) at every ratio. Reach is in CSS px so the rows compare.');
console.log('');
console.log('THE DESIGN (unchanged by this brief)');
console.log('------------------------------------');
console.log(`  BLOOM.intensity            ${BLOOM.intensity}`);
console.log(`  haloRadiusOf(intensity)    ${haloRadiusOf(BLOOM.intensity).toFixed(2)}   = 5 + 13 x intensity`);
console.log(`  BLOOM.radius               ${BLOOM.radius.toFixed(2)}   (agrees; NOT moved by this brief)`);
console.log(`  BLOOM.peakAlpha            ${BLOOM.peakAlpha.toFixed(4)}`);
console.log('  a bloomed star own r       (2.1630, 2.45]  =>  halo radius (24.31, 27.54] css px');
console.log('');
console.log('A reach of 0 css px is a star with NO halo at all: a point (and its diffraction');
console.log('cross, which is stroked geometry rather than a gradient) on bare ground.');
console.log('');

const dprFrames = readdirSync(FRAMES)
  .filter((f) => /-dpr[0-9_]+\.png$/.test(f))
  .map((f) => f.replace(/\.png$/, ''))
  .filter((f) => existsSync(join(FRAMES, `${f}.json`)))
  .sort();

const label = (f: string): string => {
  const m = /^(.*)-dpr([0-9_]+)$/.exec(f);
  const dpr = m ? m[2]!.replace('_', '.') : '?';
  const tag = m ? m[1]! : f;
  const what: Record<string, string> = {
    app: 'THE SHIPPED APP SHELL, AS THE DEVELOPER SEES IT (before the fix)',
    fixed: 'THE SHIPPED APP SHELL, AFTER THE FIX',
    probecfg: 'THE SAME index.html, BUILT BY a0-53 PROBE CONFIG (before the fix)',
  };
  return `${what[tag] ?? tag.toUpperCase()} — deviceScaleFactor ${dpr}`;
};

console.log('THE FOUR RATIOS, AND THE FIX');
console.log('============================');
console.log('');
for (const f of dprFrames.filter((f) => f.startsWith('app-'))) table(label(f), f);
for (const f of dprFrames.filter((f) => f.startsWith('fixed-'))) table(label(f), f);

// ---------------------------------------------------------------------------
// The mechanism, read off the GPU
// ---------------------------------------------------------------------------

const ramp = (f: string): { rows: { texel: string; authored: number[]; readBack: number[] }[] } | null =>
  existsSync(join(HERE, f)) ? JSON.parse(readFileSync(join(HERE, f), 'utf8')) : null;

console.log('THE MECHANISM — the ramp texture, read back off the GPU of the running client');
console.log('=============================================================================');
console.log('');
console.log('probe-ramp.mjs paints the falloff ramp 1:1 over opaque black through the');
console.log('client\'s own renderer and reads the pixels back, in both boot orders. Over');
console.log('opaque black a correctly premultiplied ramp reads back rgb = a.');
console.log('');
const good = ramp('ramp-good.json');
const bad = ramp('ramp-bad.json');
if (good && bad) {
  console.log('  texel   authored   read back (correct order)   read back (the collapse)   a^2/255');
  for (let i = 0; i < good.rows.length; i++) {
    const a = good.rows[i]!.authored[0]!;
    console.log(
      `  ${good.rows[i]!.texel.padStart(5)}   ${String(a).padStart(8)}   ` +
        `${String(good.rows[i]!.readBack[0]).padStart(24)}   ` +
        `${String(bad.rows[i]!.readBack[0]).padStart(23)}   ${((a * a) / 255).toFixed(1).padStart(7)}`,
    );
  }
  console.log('');
  console.log('  The collapsed column IS a^2/255 to the code value. The ramp is premultiplied');
  console.log('  TWICE, so every soft fill paints f^2 where the design says f, and the halo');
  console.log('  falls under one 8-bit code value past ~10 px. Flat fills and the diffraction');
  console.log('  cross never sample the ramp, which is why the star and its spikes survive');
  console.log('  untouched — the developer\'s photograph exactly.');
  console.log('');
  console.log('  UNPACK_PREMULTIPLY_ALPHA_WEBGL is global GL state. pixi 8.6.6 sets it in one');
  console.log('  place only — glUploadImageResource, for image/canvas sources — and');
  console.log('  glUploadBufferImageResource (the ramp, a BufferImageSource) never touches it.');
  console.log('  So the ramp inherited whatever the last font atlas left behind. A page with');
  console.log('  no image texture on it at all — every probe in a0-22/44/45/53, sky-preview,');
  console.log('  the unit suite — leaves it false and draws the halo correctly. That is why');
  console.log('  four rounds of correct measurements coexisted with a broken game.');
  console.log('');
}

// ---------------------------------------------------------------------------
// The hypotheses this round disproved, each by measurement
// ---------------------------------------------------------------------------

console.log('WHAT THE VARIABLE IS NOT — each measured, not argued');
console.log('====================================================');
console.log('');
console.log('All rows below are 1280x800 at dpr 1, same camera offset, before the fix.');
console.log('');
const CONTROLS: { file: string; what: string }[] = [
  { file: 'rendererprobe-today', what: 'a0-53 renderer-probe, rebuilt today (the correct reference)' },
  { file: 'probecfg-dpr1', what: 'the REAL index.html built by a0-53 probe config' },
  { file: 'field-build1', what: 'VoidBackdrop through its own API, built once' },
  { file: 'field-rebuild', what: 'VoidBackdrop, configure() destroy-and-replay (resize path)' },
  { file: 'freshwaitsel0-dpr1', what: 'the app, boot order A (an early canvas query)' },
  { file: 'fresh0-dpr1', what: 'the app, boot order B (nothing else changed)' },
  { file: 'when-f060-dpr1', what: 'the app, 60 frames after the freeze' },
  { file: 'solo-full-dpr1', what: 'the app, whole scene' },
  { file: 'solo-no-ui-dpr1', what: 'the app, world only (HUD and overlays hidden)' },
];
for (const c of CONTROLS) {
  const img = open(`${c.file}.png`);
  if (!img || img.width !== SHOT.w) {
    console.log(`  ${c.what.padEnd(58)} (frame absent)`);
    continue;
  }
  const ground = luma(img, 2, 2);
  const rows = measurable(img, 1, { x: -1328, y: -800 }).map((b) => {
    const design = haloRadiusOf(BLOOM.intensity) * b.starR;
    return reach(img, b, 1, ground, Math.ceil(design * 1.6)) / design;
  });
  const m = rows.length ? median(rows) : NaN;
  console.log(
    `  ${c.what.padEnd(58)} reach/design median ${Number.isNaN(m) ? ' n/a ' : m.toFixed(3)}  (n=${rows.length})`,
  );
}
console.log('');
console.log('  - deviceScaleFactor is NOT the variable: 1, 1.5, 2 and 3 collapse identically.');
console.log('  - The build configuration is NOT the variable, and a0-53\'s control does not');
console.log('    reproduce: the same index.html built by the probe config is collapsed too,');
console.log('    while renderer-probe.html inside that SAME bundle is correct.');
console.log('  - The configure() rebuild path is NOT the variable.');
console.log('  - Frame count, fonts.ready and the scene contents are NOT the variable: the');
console.log('    two boot orders differ by one early DOM query and nothing else, and they');
console.log('    reproduced 6/6 collapsed against 6/6 correct.');
