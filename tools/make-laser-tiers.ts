/**
 * make-laser-tiers.ts — the picked laser, up the damage ladder.
 *
 * The developer, having locked Pierce / Intense / Short / Thin / Hot:
 * *"how will these look with the 3 upgrade levels for damage?"*
 *
 * There are **four** rungs, not three: `SHOT_TIER_COLORS` carries base + three
 * upgrades for each family. All four are drawn at once, on one screen, as four
 * parallel bursts — because the question is not "is Mk III pretty", it is
 * "can I tell Mk III from Mk II mid-fight", and that is only answerable side by
 * side.
 *
 * Both families, because enemy fire climbs the same ladder and the two must not
 * converge: an enemy Mk I and an own Mk III meeting in the middle of the palette
 * would be the worst possible outcome of a tier ramp.
 *
 * Settings are LOCKED to the developer's pick. This page is not for re-opening
 * that choice; `laser-lab.html` is.
 *
 * Run: npx vite-node tools/make-laser-tiers.ts
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
import { SHOT_TIERS, type ShotFamily } from '../src/art/vfx/shots';
import { PALETTE } from '../src/art/palette';
import { circle, poly, sprite, fill, softFill, type Shape, type SpriteDef } from '../src/art/shapes';
import { spriteToGroup } from '../src/art/svg';
import { ShipClass } from '../src/shared/types';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/preview/laser-tiers.html');

const PROJECTILE_RADIUS = 4;
const SHIP_RADIUS = 12;
const STATION_RADIUS = 64;
const W = 960;
const H = 520;
const PPU = 1.25;

/**
 * COLOUR IS THE SIDE, NOT THE TIER (developer ruling, 2026-08-14):
 * *"all friendlies should have that same blue and all enemies red... even in
 * team mode... in ffa its all red obviously"*.
 *
 * So the tier ramp in  is NOT used here. Every friendly shot
 * is plasma blue and every hostile shot is threat red, in FFA and in Teams alike
 * — a teammate's fire is friendly fire and reads as yours. What separates the
 * rungs is GIRTH, below.
 */
const SIDE_COLOR: Record<ShotFamily, number> = { own: PALETTE.plasma, enemy: PALETTE.threatRed };

/**
 * TIER IS GIRTH, GROWING FROM THE TIP (developer ruling, same message):
 * *"add some girth that comes from the tip, and it gets more prominent depending
 * on the mk... so mk iv looks like almost like a ball with a trail"*.
 *
 * The head's half-width multiplier per rung. The BODY never thickens — it stays
 * the 0.104 hairline at every tier, which is what keeps the trail a trail. Only
 * the head swells, so Mk I is a needle and Mk IV is a ball dragging a line.
 * At Mk IV the head is ~13x the body's thickness, which is the ratio that reads
 * as "ball with a trail" rather than "slightly fatter laser".
 */
const TIER_GIRTH = [1.0, 1.7, 2.6, 3.9];

/**
 * TIER IS ALSO TRAIL LENGTH (developer, same session): *"perhaps make the
 * trails length also be influenced by the mk's so mk iv uses what it has now and
 * we decrease the lengths down to mk 1 so its shorter"*.
 *
 * A multiplier on the TAIL only — the head's position never moves, so the bolt
 * grows backwards out of its own tip rather than sliding along the firing line.
 * Mk IV is 1.0, i.e. exactly what was approved; the rungs below it are shorter.
 *
 * Two channels now carry the rung — girth at the head and length at the tail —
 * and they climb together, so a rung is legible from either end of the bolt.
 * That redundancy is deliberate: at a glance in a firefight the head is what you
 * see, and in a long burst strung across the screen the trail is.
 */
const TIER_TRAIL = [0.5, 0.68, 0.84, 1.0];

/** THE LOCKED PICK — Pierce · Intense · Short · Thin · Hot. */
const BASE: [number, number, number, number] = [-10.5, 2.2, 0.16, 0.58];
const LEN = 0.65;
const THICK = 0.65;
const HEAD_COLOR = 0xeaf9ff; // near-white core, not a tint
const HEAD_ALPHA = 0.9;
const BLOOM_ALPHA = 0.62;
const BLOOM_MULT = 1.6;

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

/**
 * A spindle from `x0` to `x1`: starts at the body's half-width, swells to
 * `hwMax` at 40% of its length, then tapers to a point at `x1`.
 *
 * This is the shape that separates "laser" from "pill". A capsule has two
 * identical ends and reads as an object threaded onto the line; a spindle grows
 * out of the line and closes to a point, so the eye reads the line concentrating
 * into a head. The asymmetry IS the direction.
 */
function spindle(xBack: number, xFront: number, hwBack: number, hwFront: number, steps = 16): number[] {
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const top: number[] = [];
  const bot: number[] = [];
  // The blunt front: a half-round cap of radius `hwFront`, so the leading end
  // stays a pill end.
  for (let i = 0; i <= steps / 2; i++) {
    const a = -Math.PI / 2 + (i / (steps / 2)) * Math.PI;
    top.push(+(xFront + Math.cos(a) * hwFront).toFixed(4), +(Math.sin(a) * hwFront).toFixed(4));
  }
  // The taper: from the head's full width at the front, back to exactly the
  // trail's half-width. Smoothstep so the join into the line has no shoulder.
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = xFront - (xFront - xBack) * t;
    const w = hwFront + (hwBack - hwFront) * smooth(t);
    bot.push(+x.toFixed(4), +w.toFixed(4));
  }
  // Mirror the taper along the bottom, then close.
  const out: number[] = [];
  for (let i = bot.length - 2; i >= 0; i -= 2) out.push(bot[i]!, +(-bot[i + 1]!).toFixed(4));
  out.push(...top);
  for (let i = 0; i < bot.length; i += 2) out.push(bot[i]!, bot[i + 1]!);
  return out;
}

/** The picked laser in one side's colour. The BODY is the same hairline at every
 *  rung; only the head's girth climbs. */
function pierce(family: ShotFamily, tier: number): { def: SpriteDef; extent: number } {
  const bodyColor = SIDE_COLOR[family];
  const girth = TIER_GIRTH[Math.min(tier, TIER_GIRTH.length - 1)]!;
  const [b0, f0, hw0, head0] = BASE;
  const trail = TIER_TRAIL[Math.min(tier, TIER_TRAIL.length - 1)]!;
  // Only the TAIL scales — `fwd` is untouched, so the head stays put and the
  // bolt grows backwards out of it.
  const back = b0 * LEN * trail, fwd = f0 * LEN, hw = hw0 * THICK;
  const headHw = head0 * THICK * girth;
  const half = (fwd - back) / 2;
  const mid = (fwd + back) / 2;
  const out: Shape[] = [];

  // The trail's bloom — along the line, unchanged by tier. It is the TRAIL.
  const gx = half * BLOOM_MULT + 1.2;
  const gy = Math.max(hw * 3.2, 0.9) * 1.3;
  out.push(poly(capsule(mid - gx, mid + gx, gy, 12),
    softFill(bodyColor, 'vfx', BLOOM_ALPHA, { cx: mid, cy: 0, rx: gx, ry: gy, angle: 0 })));

  // The head's own bloom, ROUND and scaled by the rung. This is the half that
  // makes a high tier read as a ball: a round glow around a round head, against
  // an elongated glow around the line behind it.
  const hg = headHw * 2.3;
  out.push(circle(fwd, 0, hg,
    softFill(bodyColor, 'vfx', 0.28 + 0.14 * (girth - 1), { cx: fwd, cy: 0, rx: hg, ry: hg, angle: 0 })));

  // The coloured sheath: the trail, and the head grown out of it.
  out.push(poly(capsule(back, fwd, hw, 6), fill(bodyColor, 'vfx', 0.9)));

  // The head — a SPINDLE, not a capsule.
  //
  // The previous version drew it as a capsule: constant width, round cap at each
  // end. That is the definition of a pill, and the developer said so — *"this
  // doesnt look like a laser shot, it looks like pill"*. A capsule reads as an
  // OBJECT because both of its ends are the same; energy does not have two ends.
  //
  // A spindle swells out of the line and comes back to a point at the tip, so it
  // reads as the line concentrating rather than as a bead threaded onto it. It
  // still gains girth with the rung — at Mk IV it is wide enough to read as a
  // ball — but it is never a shape with a flat back and a round front.
  out.push(poly(spindle(fwd - headHw * 3.2, fwd, hw, headHw), fill(bodyColor, 'vfx', 0.95)));

  // THE WHITE CORE — the thing that actually makes a bolt read as a laser, and
  // what every reference does: a hot near-white core running the FULL length,
  // inside a saturated coloured sheath, the whole thing composited additively so
  // overlaps blow out. Earlier attempts coloured the body and tinted only the
  // tip, which is why it read as "a coloured object" rather than as light.
  out.push(poly(spindle(fwd - headHw * 3.2, fwd, hw * 0.5, headHw * 0.52),
    fill(HEAD_COLOR, 'vfx', HEAD_ALPHA)));
  out.push(poly(capsule(back * 0.92, fwd - headHw * 0.6, hw * 0.5, 6),
    fill(HEAD_COLOR, 'vfx', 0.75)));

  const extent = Math.max(Math.abs(back) * BLOOM_MULT, Math.abs(fwd) + hg) + 1.5;
  return { def: sprite(`pierce/${family}/${tier}`, extent, out), extent };
}

const ROCKS = [
  { x: 300, y: -180, r: 32, seed: 3, stage: 0 },
  { x: 330, y: 150, r: 26, seed: 11, stage: 1 },
];
/** Four parallel firing lines, one per rung, so the rungs are compared and not
 *  merely displayed. Left labels are drawn in HTML beside the stage. */
const LANE_Y = [-150, -50, 50, 150];
const SHOT_X = [-260, -160, -60, 40, 140];

function place(def: SpriteDef, x: number, y: number, radiusPx: number, rot = 0): string {
  const size = radiusPx * 2;
  const cx = W / 2 + x * PPU;
  const cy = H / 2 + y * PPU;
  const deg = (rot * 180) / Math.PI;
  return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${deg.toFixed(2)})">${spriteToGroup(def, size, -size / 2, -size / 2)}</g>`;
}

const svgWrap = (inner: string, cls: string): string =>
  `<svg class="${cls}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

function backdropSvg(skyId: NebulaId): string {
  const spec = NEBULAE[skyId];
  const S = Math.max(W, H);
  const parts: string[] = [spriteToGroup(groundSprite(W, H), S, (W - S) / 2, (H - S) / 2)];
  const skyDef = sprite(`sky/${skyId}`, S / 2, spec.build(VOID_SEED, W, H, 1, W, H));
  const skyG = spriteToGroup(skyDef, S, (W - S) / 2, (H - S) / 2);
  const starG = STAR_LAYERS.map((l) => spriteToGroup(starFieldSprite(l, VOID_SEED, W, H), S, (W - S) / 2, (H - S) / 2)).join('');
  parts.push(spec.occludes ? starG + skyG : skyG + starG);
  parts.push(place(stationSprite(1, 0), 380, 40, STATION_RADIUS * PPU));
  for (const r of ROCKS) parts.push(place(asteroidSprite({ seed: r.seed, crackStage: r.stage }), r.x, r.y, r.r * PPU));
  for (const y of LANE_Y) parts.push(place(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 0 }), -350, y, SHIP_RADIUS * PPU));
  return svgWrap(parts.join(''), `bg bg-${skyId}`);
}

/** All four rungs at once, one per lane. */
function tiersSvg(family: ShotFamily): string {
  const inner = SHOT_TIERS.map((t, lane) => {
    const { def, extent } = pierce(family, t);
    return SHOT_X.map((x) => place(def, x, LANE_Y[lane]!, PROJECTILE_RADIUS * PPU * extent)).join('');
  }).join('');
  return svgWrap(inner, `sh s-${family}`);
}

const SKIES: NebulaId[] = ['patinaDrift', 'coalsack', 'plasmaReef'];
const FAMILIES: ShotFamily[] = ['own', 'enemy'];

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
const swatches = FAMILIES.map((f) => `
  <div class="swatchrow s-${f}-sw">
    ${SHOT_TIERS.map((t) => {
      const g = TIER_GIRTH[Math.min(t, TIER_GIRTH.length - 1)]!;
      const px = Math.round(7 * g);
      return `<div class="sw"><i style="background:${hex(SIDE_COLOR[f])};width:${px}px;height:${px}px"></i><b>Mk ${['I', 'II', 'III', 'IV'][t]}</b><span>tip x${g} · trail x${TIER_TRAIL[Math.min(t, TIER_TRAIL.length - 1)]}</span></div>`;
    }).join('')}
  </div>`).join('');

const radios = [
  ...SKIES.map((s, i) => `<input type="radio" name="sky" id="t-sky-${s}"${i === 0 ? ' checked' : ''}>`),
  ...FAMILIES.map((f, i) => `<input type="radio" name="fam" id="t-fam-${f}"${i === 0 ? ' checked' : ''}>`),
].join('\n');

const rules: string[] = [];
for (const s of SKIES) rules.push(`#t-sky-${s}:checked ~ .stage .stagewrap .bg-${s}{opacity:1}`);
for (const f of FAMILIES) {
  rules.push(`#t-fam-${f}:checked ~ .stage .stagewrap .s-${f}{opacity:1}`);
  rules.push(`#t-fam-${f}:checked ~ .swatches .s-${f}-sw{display:flex}`);
}
for (const s of SKIES) rules.push(`#t-sky-${s}:checked ~ .controls label[for="t-sky-${s}"]{background:#7fdcff;color:#06121a;border-color:#7fdcff}`);
for (const f of FAMILIES) rules.push(`#t-fam-${f}:checked ~ .controls label[for="t-fam-${f}"]{background:#7fdcff;color:#06121a;border-color:#7fdcff}`);

const layers = [...SKIES.map(backdropSvg), ...FAMILIES.map(tiersSvg)];

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Laser tiers</title>
<style>
  :root{--ink:#c8d2e0;--dim:#7e8894;--line:#1c2634;--bg:#07090d;--hot:#7fdcff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
  header{padding:20px 24px 8px}
  h1{margin:0 0 7px;font-size:19px;font-weight:600}
  p.sub{margin:0;color:var(--dim);font-size:12.5px;line-height:1.55;max-width:82ch}
  code{font-family:ui-monospace,monospace;font-size:11.5px;color:#8fd0e8}
  input[type=radio]{position:absolute;opacity:0;pointer-events:none}
  .controls{display:flex;flex-wrap:wrap;gap:20px;padding:14px 24px 14px}
  .group{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
  .group>span{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
              text-transform:uppercase;color:var(--dim);margin-right:2px}
  label{font-family:ui-monospace,monospace;font-size:11.5px;padding:6px 11px;border-radius:8px;
        border:1px solid #24384f;color:var(--ink);cursor:pointer;user-select:none}
  .stage{display:flex;gap:12px;margin:0 24px}
  .lanes{display:flex;flex-direction:column;justify-content:space-around;padding:6px 0;flex:0 0 auto}
  .lanes div{font-family:ui-monospace,monospace;font-size:11px;color:var(--dim);letter-spacing:.1em}
  .stagewrap{position:relative;flex:1 1 auto;border:1px solid var(--line);border-radius:10px;
             overflow:hidden;background:#000;aspect-ratio:${W} / ${H};max-width:${W}px}
  .stagewrap svg{position:absolute;inset:0;width:100%;height:100%;opacity:0}
  .swatches{padding:16px 24px 4px}
  .swatchrow{display:none;gap:18px;flex-wrap:wrap}
  .sw{display:flex;align-items:center;gap:8px;font-family:ui-monospace,monospace;font-size:11px}
  .sw i{width:16px;height:16px;border-radius:4px;display:inline-block;border:1px solid #2a3a4d}
  .sw b{color:var(--ink);font-weight:600}
  .sw span{color:var(--dim)}
  footer{padding:14px 24px 34px;color:var(--dim);font-size:12.5px;line-height:1.6;max-width:82ch}
  footer b{color:var(--ink)}
${rules.join('\n')}
</style></head><body>
${radios}
<header>
  <h1>Laser tiers — the picked shot up the damage ladder</h1>
  <p class="sub">
    Locked to your pick: <b>Pierce · Intense · Short · Thin · Hot</b>. There are <b>four</b> rungs —
    base plus the three DAMAGE upgrades — and all four fire at once, one per lane, because the
    question is whether you can tell them apart mid-fight, not whether each looks good alone.
    Everything except the shot is the game's own art code.
  </p>
</header>
<div class="controls">
  <div class="group"><span>Family</span>${FAMILIES.map((f) => `<label for="t-fam-${f}">${f === 'own' ? 'Your fire' : 'Enemy fire'}</label>`).join('')}</div>
  <div class="group"><span>Sky</span>${SKIES.map((s) => `<label for="t-sky-${s}">${NEBULAE[s].name}</label>`).join('')}</div>
</div>
<div class="stage">
  <div class="lanes"><div>Mk I</div><div>Mk II</div><div>Mk III</div><div>Mk IV</div></div>
  <div class="stagewrap">
${layers.join('\n')}
  </div>
</div>
<div class="swatches">${swatches}</div>
<footer>
  <b>What to check.</b> The tip is held at <code>#bfefff</code> on every rung on purpose — the thing
  that climbs is the <b>line</b>, so the tip stays a fixed landmark to read the body against. If two
  adjacent rungs are hard to separate here, they will be impossible in a firefight, and the fix is
  the tier palette in <code>SHOT_TIER_COLORS</code>, not this shape. Check <b>enemy fire</b> too: own
  and enemy ladders must not converge in the middle, or a Mk I coming at you reads like a Mk III of
  your own.
</footer>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB) — ${layers.length} layers`);
