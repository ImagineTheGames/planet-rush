/**
 * make-laser-lab.ts — dial the laser in, instead of going back and forth.
 *
 * The developer, after the first shot preview: *"i like lance, tracer, and beam
 * but they are all so faint to truly see... they could use a bit of bloom around
 * them, can you make one of those pages like we have with options where i can
 * choose one of the lasers, add bloom to it, change size, etc. so we can dial in
 * something instead of going back and forth"*.
 *
 * So: SHAPE x BLOOM x LENGTH x THICKNESS x CORE, every combination baked, switched
 * with CSS radio buttons. Still one static file — no server, no script tag,
 * nothing external.
 *
 * The trick that makes 324 combinations affordable is the same one the ore page
 * uses: the scene (sky, stars, station, rocks, ship) is drawn ONCE PER SKY and
 * the shots ride a transparent overlay on top. A star field is thousands of
 * shapes; five bolts are not.
 *
 * Everything except the shot is the game's own art code, through
 * `src/art/svg.ts` — the repo's review-sheet path, which shares `falloffProfile`
 * with the GPU ramp, so a bloom here and a bloom in the frame agree.
 *
 * Run: npx vite-node tools/make-laser-lab.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asteroidSprite } from '../src/art/asteroids';
import { stationSprite } from '../src/art/stations';
import { shipSprite } from '../src/art/ships';
import {
  NEBULAE, groundSprite, starFieldSprite, STAR_LAYERS, VOID_SEED, type NebulaId,
} from '../src/art/backdrop';
import { SHOT_TIER_COLORS } from '../src/art/vfx/shots';
import { circle, poly, sprite, fill, softFill, type Shape, type SpriteDef } from '../src/art/shapes';
import { spriteToGroup } from '../src/art/svg';
import { ShipClass } from '../src/shared/types';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/preview/laser-lab.html');

/** From src/sim/constants.ts — the sizes that keep this honest. */
const PROJECTILE_RADIUS = 4;
const SHIP_RADIUS = 12;
const STATION_RADIUS = 64;

const W = 900;
const H = 420;
const PPU = 1.25;

const SHOT_COLOR = SHOT_TIER_COLORS.own[1] ?? SHOT_TIER_COLORS.own[0]!;
const WHITE = 0xffffff;

// ---------------------------------------------------------------------------
// The knobs
// ---------------------------------------------------------------------------

type Shape3 = 'lance' | 'tracer' | 'beam' | 'pierce';
type Bloom = 'none' | 'subtle' | 'strong' | 'intense';
type Size3 = 'short' | 'std' | 'long';
type Thick = 'thin' | 'std' | 'thick';
type Core = 'warm' | 'hot' | 'white';

const SHAPES: { id: Shape3; label: string }[] = [
  { id: 'lance', label: 'Lance' }, { id: 'tracer', label: 'Tracer' }, { id: 'beam', label: 'Beam' },
  { id: 'pierce', label: 'Pierce' },
];
const BLOOMS: { id: Bloom; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'subtle', label: 'Subtle' },
  { id: 'strong', label: 'Strong' }, { id: 'intense', label: 'Intense' },
];
const LENGTHS: { id: Size3; label: string }[] = [
  { id: 'short', label: 'Short' }, { id: 'std', label: 'Standard' }, { id: 'long', label: 'Long' },
];
const THICKS: { id: Thick; label: string }[] = [
  { id: 'thin', label: 'Thin' }, { id: 'std', label: 'Standard' }, { id: 'thick', label: 'Thick' },
];
const CORES: { id: Core; label: string }[] = [
  { id: 'warm', label: 'Shot colour' }, { id: 'hot', label: 'Hot' }, { id: 'white', label: 'White-hot' },
];

/** Bloom: [peak alpha, radius multiple of the body's half-length]. Two knobs in
 *  one control, because a wide faint glow and a tight bright one are the same
 *  decision from the player's side: how far does this thing throw light. */
const BLOOM_SPEC: Record<Bloom, [number, number]> = {
  none: [0, 0], subtle: [0.22, 1.15], strong: [0.40, 1.35], intense: [0.62, 1.6],
};
const LEN_MULT: Record<Size3, number> = { short: 0.65, std: 1, long: 1.55 };
const THICK_MULT: Record<Thick, number> = { thin: 0.65, std: 1, thick: 1.6 };
const CORE_SPEC: Record<Core, [number, number]> = {
  warm: [SHOT_COLOR, 0.85], hot: [0xbfefff, 0.9], white: [WHITE, 0.98],
};

/** Base geometry per shape: [tailBack, headFwd, halfThickness, headHalf]. */
const BASE: Record<Shape3, [number, number, number, number]> = {
  lance: [-5.4, 3.0, 0.34, 0.5],
  tracer: [-8.0, 1.6, 0.30, 0.55],
  beam: [-10.0, 2.0, 0.16, 0.26],
  // PIERCE — the developer's own combination: 'i like the white tip from tracer,
  // but i like the lines from beam'. Beam's hairline body and reach, carrying
  // tracer's head: the head half-width is 0.58 against beam's 0.26, so the tip
  // is more than twice the body's thickness and reads as the hot end of a line
  // rather than a slightly brighter part of it. It keeps tracer's tail fade too,
  // which is what makes a still frame say which way it is going.
  pierce: [-10.5, 2.2, 0.16, 0.58],
};

function capsule(back: number, fwd: number, hw: number, steps = 8): number[] {
  const p: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * Math.PI;
    p.push(+(fwd + Math.cos(a) * hw).toFixed(4), +(Math.sin(a) * hw).toFixed(4));
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (i / steps) * Math.PI;
    p.push(+(back + Math.cos(a) * hw).toFixed(4), +(Math.sin(a) * hw).toFixed(4));
  }
  return p;
}

/** One laser, fully specified. Authored along +X; unit 1 = the collision radius. */
function laser(shape: Shape3, bloom: Bloom, len: Size3, thick: Thick, core: Core): { def: SpriteDef; extent: number } {
  const [b0, f0, hw0, head0] = BASE[shape];
  const lm = LEN_MULT[len];
  const tm = THICK_MULT[thick];
  const back = b0 * lm, fwd = f0 * lm, hw = hw0 * tm, headHw = head0 * tm;
  const [coreColor, coreAlpha] = CORE_SPEC[core];
  const [bloomAlpha, bloomMult] = BLOOM_SPEC[bloom];

  const half = (fwd - back) / 2;
  const mid = (fwd + back) / 2;
  const out: Shape[] = [];

  // Bloom first — it is light spilling off the body, so the body sits on top of
  // it. Elliptical, along the shot: a round glow on a line reads as a ball
  // wearing a streak, which is the thing this whole page is trying to leave.
  if (bloomAlpha > 0) {
    const gx = half * bloomMult + 1.2;
    const gy = Math.max(hw * 3.2, 0.9) * (1 + (bloomMult - 1) * 0.5);
    out.push(poly(
      capsule(mid - gx, mid + gx, gy, 12),
      softFill(SHOT_COLOR, 'vfx', bloomAlpha, { cx: mid, cy: 0, rx: gx, ry: gy, angle: 0 }),
    ));
  }

  // The body, then the head.
  //
  // TRACER fades: a dim tail behind a brighter forward half, which is what makes
  // a still frame read as motion. PIERCE must NOT do that — the developer asked
  // for "the white tip from tracer, but the lines from beam", and the first
  // attempt gave it tracer's two-segment fade, which reads as a smudge rather
  // than a line ("pierce does not have the lines like beam"). A LINE is one
  // continuous body at one alpha; the moment it is drawn as two overlapping
  // segments at different alphas, the eye stops reading an edge.
  //
  // So pierce takes beam's body verbatim and only the HEAD differs.
  if (shape === 'tracer') {
    out.push(poly(capsule(back, mid, hw * 0.75, 6), fill(SHOT_COLOR, 'vfx', 0.45)));
    out.push(poly(capsule(mid * 0.5, fwd, hw, 6), fill(SHOT_COLOR, 'vfx', 0.85)));
  } else {
    out.push(poly(capsule(back, fwd, hw, 6), fill(SHOT_COLOR, 'vfx', 0.9)));
  }
  // The hot head. Its LENGTH is tied to its own width, not to the body's, for
  // the shapes whose point is a tip: at 0.22 of a long body a "tip" becomes a
  // bright bar most of the shot's length, which is the opposite of "the white
  // tip from tracer, but the lines from beam". Lance keeps the proportional
  // head — on a lance the hot section IS a section, not a point.
  const headLen = shape === 'lance'
    ? Math.abs(fwd - back) * 0.22
    : Math.min(Math.abs(fwd - back) * 0.22, headHw * 2.4);
  out.push(poly(capsule(fwd - headLen, fwd, headHw, 6), fill(coreColor, 'vfx', coreAlpha)));
  out.push(circle(fwd, 0, headHw * 0.85, fill(coreColor, 'vfx', Math.min(1, coreAlpha + 0.05))));

  const extent = Math.max(Math.abs(back), Math.abs(fwd)) * (bloomAlpha > 0 ? bloomMult : 1) + 1.5;
  return { def: sprite(`laser/${shape}-${bloom}-${len}-${thick}-${core}`, extent, out), extent };
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const ROCKS = [
  { x: 250, y: -110, r: 34, seed: 3, stage: 0 },
  { x: 120, y: 120, r: 24, seed: 11, stage: 1 },
  { x: -300, y: 90, r: 30, seed: 19, stage: 0 },
];
const FIRE_ANGLE = -0.34;
const SHIP_AT = { x: -250, y: -10 };
const SHOT_STEPS = [90, 170, 250, 330, 410];

function place(def: SpriteDef, x: number, y: number, radiusPx: number, rot = 0): string {
  const size = radiusPx * 2;
  const cx = W / 2 + x * PPU;
  const cy = H / 2 + y * PPU;
  const deg = (rot * 180) / Math.PI;
  return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${deg.toFixed(2)})">${spriteToGroup(def, size, -size / 2, -size / 2)}</g>`;
}

const svgWrap = (inner: string, cls: string): string =>
  `<svg class="${cls}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/** Everything that does NOT change with the knobs — once per sky. */
function backdropSvg(skyId: NebulaId): string {
  const spec = NEBULAE[skyId];
  const parts: string[] = [spriteToGroup(groundSprite(W, H), Math.max(W, H), 0, 0)];
  const skyDef = sprite(`sky/${skyId}`, Math.max(W, H) / 2, spec.build(VOID_SEED, W, H, 1, W, H));
  const skyG = spriteToGroup(skyDef, Math.max(W, H), (W - Math.max(W, H)) / 2, (H - Math.max(W, H)) / 2);
  const starG = STAR_LAYERS
    .map((l) => spriteToGroup(starFieldSprite(l, VOID_SEED, W, H), Math.max(W, H), (W - Math.max(W, H)) / 2, (H - Math.max(W, H)) / 2))
    .join('');
  parts.push(spec.occludes ? starG + skyG : skyG + starG);
  parts.push(place(stationSprite(1, 0), -60, 150, STATION_RADIUS * PPU));
  for (const r of ROCKS) parts.push(place(asteroidSprite({ seed: r.seed, crackStage: r.stage }), r.x, r.y, r.r * PPU));
  parts.push(place(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 0 }), SHIP_AT.x, SHIP_AT.y, SHIP_RADIUS * PPU, FIRE_ANGLE));
  return svgWrap(parts.join(''), `bg bg-${skyId}`);
}

/** Just the burst, transparent, stacked over the backdrop. */
function shotsSvg(shape: Shape3, bloom: Bloom, len: Size3, thick: Thick, core: Core): string {
  const { def, extent } = laser(shape, bloom, len, thick, core);
  const inner = SHOT_STEPS.map((d) => {
    const x = SHIP_AT.x + Math.cos(FIRE_ANGLE) * d;
    const y = SHIP_AT.y + Math.sin(FIRE_ANGLE) * d;
    return place(def, x, y, PROJECTILE_RADIUS * PPU * extent, FIRE_ANGLE);
  }).join('');
  return svgWrap(inner, `sh s-${shape}-${bloom}-${len}-${thick}-${core}`);
}

const SKIES: NebulaId[] = ['patinaDrift', 'coalsack', 'plasmaReef'];

// ---------------------------------------------------------------------------
// Radios + the CSS that switches without a line of script
// ---------------------------------------------------------------------------

const radios = [
  ...SKIES.map((s, i) => `<input type="radio" name="sky" id="k-sky-${s}"${i === 0 ? ' checked' : ''}>`),
  ...SHAPES.map((s) => `<input type="radio" name="shape" id="k-shape-${s.id}"${s.id === 'lance' ? ' checked' : ''}>`),
  ...BLOOMS.map((b) => `<input type="radio" name="bloom" id="k-bloom-${b.id}"${b.id === 'strong' ? ' checked' : ''}>`),
  ...LENGTHS.map((l) => `<input type="radio" name="len" id="k-len-${l.id}"${l.id === 'std' ? ' checked' : ''}>`),
  ...THICKS.map((t) => `<input type="radio" name="thick" id="k-thick-${t.id}"${t.id === 'std' ? ' checked' : ''}>`),
  ...CORES.map((c) => `<input type="radio" name="core" id="k-core-${c.id}"${c.id === 'white' ? ' checked' : ''}>`),
].join('\n');

const rules: string[] = [];
for (const s of SKIES) rules.push(`#k-sky-${s}:checked ~ .stagewrap .bg-${s}{opacity:1}`);
const layers: string[] = SKIES.map(backdropSvg);
for (const sh of SHAPES) for (const b of BLOOMS) for (const l of LENGTHS) for (const t of THICKS) for (const c of CORES) {
  layers.push(shotsSvg(sh.id, b.id, l.id, t.id, c.id));
  rules.push(
    `#k-shape-${sh.id}:checked ~ #k-bloom-${b.id}:checked ~ #k-len-${l.id}:checked ~ #k-thick-${t.id}:checked ~ #k-core-${c.id}:checked ~ .stagewrap .s-${sh.id}-${b.id}-${l.id}-${t.id}-${c.id}{opacity:1}`,
  );
}
for (const [g, ids] of [['sky', SKIES as string[]], ['shape', SHAPES.map((x) => x.id)],
  ['bloom', BLOOMS.map((x) => x.id)], ['len', LENGTHS.map((x) => x.id)],
  ['thick', THICKS.map((x) => x.id)], ['core', CORES.map((x) => x.id)]] as [string, string[]][]) {
  for (const id of ids) {
    rules.push(`#k-${g}-${id}:checked ~ .controls label[for="k-${g}-${id}"]{background:#7fdcff;color:#06121a;border-color:#7fdcff}`);
  }
}

const group = (title: string, g: string, items: { id: string; label: string }[]): string =>
  `<div class="group"><span>${title}</span>${items.map((i) => `<label for="k-${g}-${i.id}">${i.label}</label>`).join('')}</div>`;

const controls = `
  <div class="controls">
    ${group('Shape', 'shape', SHAPES)}
    ${group('Bloom', 'bloom', BLOOMS)}
    ${group('Length', 'len', LENGTHS)}
    ${group('Thickness', 'thick', THICKS)}
    ${group('Core', 'core', CORES)}
    ${group('Sky', 'sky', SKIES.map((s) => ({ id: s, label: NEBULAE[s].name })))}
  </div>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laser lab</title>
<style>
  :root{--ink:#c8d2e0;--dim:#7e8894;--line:#1c2634;--bg:#07090d;--hot:#7fdcff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
  header{padding:20px 24px 10px}
  h1{margin:0 0 7px;font-size:19px;font-weight:600}
  p.sub{margin:0;color:var(--dim);font-size:12.5px;line-height:1.55;max-width:80ch}
  code{font-family:ui-monospace,monospace;font-size:11.5px;color:#8fd0e8}
  input[type=radio]{position:absolute;opacity:0;pointer-events:none}
  .controls{display:flex;flex-wrap:wrap;gap:20px;padding:14px 24px 18px}
  .group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .group>span{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
              text-transform:uppercase;color:var(--dim);margin-right:2px}
  label{font-family:ui-monospace,monospace;font-size:11.5px;padding:6px 11px;border-radius:8px;
        border:1px solid #24384f;color:var(--ink);cursor:pointer;user-select:none}
  label:hover{border-color:#3d6b93}
  .stagewrap{position:relative;margin:0 24px 26px;border:1px solid var(--line);border-radius:10px;
             overflow:hidden;background:#000;aspect-ratio:${W} / ${H};max-width:${W}px}
  .stagewrap svg{position:absolute;inset:0;width:100%;height:100%;opacity:0}
  footer{padding:0 24px 34px;color:var(--dim);font-size:12.5px;line-height:1.6;max-width:80ch}
  footer b{color:var(--ink)}
${rules.join('\n')}
</style></head><body>
${radios}
<header>
  <h1>Laser lab — dial it in</h1>
  <p class="sub">
    Static file, no server, no script: the controls are CSS radio buttons and every combination is
    baked. Everything except the shot is the game's own art code, through <code>src/art/svg.ts</code>.
    Shots are drawn at the projectile's real collision radius of <b>4 world units</b> beside a
    <b>12-unit</b> ship, five along one firing line at burst spacing.
  </p>
</header>
${controls}
<div class="stagewrap">
${layers.join('\n')}
</div>
<footer>
  <b>Bloom</b> is peak alpha and reach together — <code>subtle</code> 0.22, <code>strong</code> 0.40,
  <code>intense</code> 0.62 — drawn with the same <code>falloffProfile</code> the GPU ramp uses, so
  what you pick here is what the frame paints. The glow is elliptical along the shot on purpose: a
  round glow on a line reads as a ball wearing a streak, which is the thing this is trying to leave.
  <b>Watch Plasma Reef</b> — it is the brightest sky and the one where a thin beam disappears; if a
  setting survives there it survives everywhere.
</footer>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB) — ${layers.length} layers, ${rules.length} rules`);
