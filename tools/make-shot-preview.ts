/**
 * make-shot-preview.ts — what the shot would look like as a LASER, in a scene.
 *
 * The developer: *"can you make a visual preview of what it would look like to
 * change the shot balls to laser instead (line)... lets make a web preview
 * static web page to look at it"*.
 *
 * A projectile is judged in flight, at 4 world units, on a dark ground, against
 * the ship that fired it — not on a swatch. So every element except the
 * candidate shot is the game's own art code (`shipSprite`, `stationSprite`,
 * `asteroidSprite`, the sky and star builders), rendered through
 * `src/art/svg.ts`, the repo's own review-sheet path.
 *
 * Static output: one self-contained .html, inline SVG, no server, no script tag.
 *
 * Run: npx vite-node tools/make-shot-preview.ts
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
import { shotSprite } from '../src/art/vfx/shots';
import { PALETTE } from '../src/art/palette';
import { circle, poly, sprite, fill, softFill, type Shape, type SpriteDef } from '../src/art/shapes';
import { spriteToGroup } from '../src/art/svg';
import { ShipClass } from '../src/shared/types';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/preview/shot-as-laser.html');

/** From src/sim/constants.ts — the sizes that make this comparison honest. */
const PROJECTILE_RADIUS = 4;
const SHIP_RADIUS = 12;
const STATION_RADIUS = 64;

const W = 900;
const H = 420;
const PPU = 1.25;

/** a0-46 retired the per-rung colour ladder — colour is the SIDE now, so this
 *  lab's reference colour is simply own fire's plasma (`SHOT_SIDE_COLOR.own`). */
const SHOT_COLOR = PALETTE.plasma;

// ---------------------------------------------------------------------------
// Candidates — all authored along +X, unit radius 1 = the collision radius
// ---------------------------------------------------------------------------

/** A capsule from (-back,0) to (+fwd,0), half-thickness `hw`, as a polygon. */
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

interface Candidate { key: string; name: string; note: string; def: SpriteDef; extent: number }

/** The soft bloom every candidate keeps: a shot must be findable in a busy frame. */
const glow = (rx: number, ry: number, alpha = 0.30): Shape =>
  poly(capsule(-rx, rx, ry, 10), softFill(SHOT_COLOR, 'vfx', alpha, { cx: 0, cy: 0, rx, ry, angle: 0 }));

const CANDIDATES: Candidate[] = [
  {
    key: 'ball',
    // a0-46: this slot used to be "BALL — what ships today", a soft glow disc at
    // r 1.16 over a bright core at r 0.62. The ball no longer ships — `shotSprite`
    // IS the picked laser now — so the slot reads what it actually draws, at the
    // sprite's own extent rather than the disc's. The disc it was comparing
    // against is gone; this page is kept as the record of how the choice was
    // framed, and `laser-lab.html` is where the choice itself was made.
    name: 'SHIPPED — the PIERCE bolt (a0-46)',
    note: 'shotSprite(): the developer’s pick, as `src/art/vfx/shots.ts` actually bakes it — blunt round head tapering back into a hairline trail, white core inside a plasma sheath. The candidates below are the exploration that led here.',
    def: shotSprite('own', 1),
    extent: shotSprite('own', 1).extent,
  },
  {
    key: 'bolt',
    name: 'BOLT — short capsule, 3:1',
    note: 'The smallest change that reads as travel. Same mass of light, stretched along flight. Still obviously a projectile, not a beam.',
    def: sprite('shot/bolt', 3.4, [
      glow(3.0, 1.05),
      poly(capsule(-1.7, 1.7, 0.55), fill(SHOT_COLOR, 'vfx', 0.95)),
      circle(1.2, 0, 0.42, fill(0xffffff, 'vfx', 0.8)),
    ]),
  },
  {
    key: 'lance',
    name: 'LANCE — long, 8:1, hot head',
    note: 'Reads unmistakably as a laser. The white head is where the damage is; the tail says where it came from.',
    def: sprite('shot/lance', 8.6, [
      glow(8.0, 0.95, 0.26),
      poly(capsule(-5.4, 3.0, 0.34), fill(SHOT_COLOR, 'vfx', 0.9)),
      poly(capsule(0.4, 3.0, 0.5), fill(0xffffff, 'vfx', 0.85)),
      circle(3.0, 0, 0.38, fill(0xffffff, 'vfx', 0.95)),
    ]),
  },
  {
    key: 'tracer',
    name: 'TRACER — bright head, fading tail',
    note: 'The head is the projectile and the tail is afterglow, so speed reads even in a still frame. Longest silhouette per unit of light.',
    def: sprite('shot/tracer', 11.0, [
      glow(10.0, 0.8, 0.18),
      poly(capsule(-8.0, 0.0, 0.22), fill(SHOT_COLOR, 'vfx', 0.45)),
      poly(capsule(-3.2, 1.6, 0.34), fill(SHOT_COLOR, 'vfx', 0.85)),
      circle(1.6, 0, 0.55, fill(0xffffff, 'vfx', 0.95)),
    ]),
  },
  {
    key: 'beam',
    name: 'BEAM — thin continuous line',
    note: 'A hairline with a wide soft bloom. Cheapest silhouette, and the one most likely to disappear against a bright nebula.',
    def: sprite('shot/beam', 12.0, [
      glow(11.0, 0.62, 0.22),
      poly(capsule(-10.0, 2.0, 0.16), fill(SHOT_COLOR, 'vfx', 0.9)),
      poly(capsule(-1.0, 2.0, 0.26), fill(0xffffff, 'vfx', 0.8)),
    ]),
  },
];

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

const ROCKS = [
  { x: 250, y: -110, r: 34, seed: 3, stage: 0 },
  { x: 120, y: 120, r: 24, seed: 11, stage: 1 },
  { x: -300, y: 90, r: 30, seed: 19, stage: 0 },
];
/** A firing line: the ship at the left, the rock it is shooting at on the right,
 *  and shots strung along the path at the spacing a real burst has. */
const FIRE_ANGLE = -0.34; // radians, ship to rock
const SHIP_AT = { x: -250, y: -10 };
const SHOT_STEPS = [90, 170, 250, 330, 410];

/**
 * Place a sprite CENTRED on (x, y) in world units, optionally rotated.
 *
 * `spriteToGroup(def, size, tx, ty)` takes tx/ty as the sprite box's TOP-LEFT
 * (it adds `size/2` itself), and has no rotation. So the box is asked for at
 * `-size/2` and this wrapper supplies the translate and the rotate — which is
 * also the only way a directional shot can point down its own firing line.
 */
function place(def: SpriteDef, x: number, y: number, radiusPx: number, rot = 0): string {
  const size = radiusPx * 2;
  const cx = W / 2 + x * PPU;
  const cy = H / 2 + y * PPU;
  const deg = (rot * 180) / Math.PI;
  return `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${deg.toFixed(2)})">${spriteToGroup(def, size, -size / 2, -size / 2)}</g>`;
}

function sceneSvg(cand: Candidate, skyId: NebulaId): string {
  const spec = NEBULAE[skyId];
  const parts: string[] = [spriteToGroup(groundSprite(W, H), Math.max(W, H), W / 2, H / 2)];

  const skyDef = sprite(`sky/${skyId}`, Math.max(W, H) / 2, spec.build(VOID_SEED, W, H, 1, W, H));
  const skyG = spriteToGroup(skyDef, Math.max(W, H), W / 2, H / 2);
  const starG = STAR_LAYERS
    .map((l) => spriteToGroup(starFieldSprite(l, VOID_SEED, W, H), Math.max(W, H), W / 2, H / 2))
    .join('');
  parts.push(spec.occludes ? starG + skyG : skyG + starG);

  parts.push(place(stationSprite(1, 0), -60, 150, STATION_RADIUS * PPU));
  for (const r of ROCKS) {
    parts.push(place(asteroidSprite({ seed: r.seed, crackStage: r.stage }), r.x, r.y, r.r * PPU));
  }
  parts.push(place(shipSprite({ shipClass: ShipClass.Vanguard, playerId: 0 }), SHIP_AT.x, SHIP_AT.y, SHIP_RADIUS * PPU, FIRE_ANGLE));

  // The shots themselves, at the projectile's real radius, rotated onto the
  // firing line. `extent` differs per candidate (a lance overhangs its own
  // collision circle), so the drawn size is extent × the collision radius —
  // exactly what the renderer does with `SHOT_ART_SCALE`.
  const ext = cand.extent ?? 1;
  for (const d of SHOT_STEPS) {
    const x = SHIP_AT.x + Math.cos(FIRE_ANGLE) * d;
    const y = SHIP_AT.y + Math.sin(FIRE_ANGLE) * d;
    parts.push(place(cand.def, x, y, PROJECTILE_RADIUS * PPU * ext, FIRE_ANGLE));
  }

  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${cand.name}">${parts.join('')}</svg>`;
}

/** One shot, big, so the shape itself can be read. */
function detailSvg(cand: Candidate): string {
  const w = 420, h = 120, size = 380;
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${spriteToGroup(cand.def, size, w / 2 - size / 2, h / 2 - size / 2)}</svg>`;
}

const SKIES: NebulaId[] = ['patinaDrift', 'coalsack', 'plasmaReef'];

const blocks = CANDIDATES.map((c) => `
  <section class="block">
    <div class="head"><b>${c.name}</b><span>${c.note}</span></div>
    <div class="detail">${detailSvg(c)}</div>
    <div class="scenes">
      ${SKIES.map((s) => `<figure><figcaption>${NEBULAE[s].name}</figcaption><div class="cell">${sceneSvg(c, s)}</div></figure>`).join('')}
    </div>
  </section>`).join('');

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Shot as laser</title>
<style>
  :root{--ink:#c8d2e0;--dim:#7e8894;--line:#1c2634;--bg:#07090d;--hot:#7fdcff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}
  header{padding:22px 26px 18px;border-bottom:1px solid var(--line)}
  h1{margin:0 0 8px;font-size:20px;font-weight:600}
  p.sub{margin:0;color:var(--dim);font-size:13px;line-height:1.55;max-width:78ch}
  code{font-family:ui-monospace,monospace;font-size:12px;color:#8fd0e8}
  .block{padding:22px 26px;border-bottom:1px solid var(--line)}
  .head{margin-bottom:12px}
  .head b{font-family:ui-monospace,monospace;font-size:13px;letter-spacing:.09em;color:var(--hot);display:block;margin-bottom:4px}
  .head span{color:var(--dim);font-size:12.5px}
  .detail{border:1px solid var(--line);border-radius:10px;background:#05070b;display:inline-block;margin-bottom:12px;line-height:0}
  .scenes{display:flex;gap:16px;overflow-x:auto;padding-bottom:6px}
  figure{margin:0;flex:0 0 auto}
  figcaption{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.12em;
             text-transform:uppercase;color:var(--dim);margin-bottom:6px}
  .cell{border:1px solid var(--line);border-radius:10px;overflow:hidden;background:#000;line-height:0}
  .cell svg{display:block;max-width:100%;height:auto}
  footer{padding:18px 26px 34px;color:var(--dim);font-size:12.5px;line-height:1.6;max-width:80ch}
  footer b{color:var(--ink)}
</style></head><body>
<header>
  <h1>Shot as a laser — five candidates, in the scene</h1>
  <p class="sub">
    Static page: no server, no script. Everything except the shot is the game's own art code
    (<code>shipSprite</code>, <code>stationSprite</code>, <code>asteroidSprite</code>, the sky and star
    builders), through <code>src/art/svg.ts</code>. Shots are drawn at the projectile's real collision
    radius of <b>4 world units</b> beside a <b>12-unit</b> ship, strung along one firing line at burst
    spacing. Three skies each, because a shot has to stay readable against all of them.
  </p>
</header>
${blocks}
<footer>
  <b>What to weigh.</b> A round shot carries no direction, so a player cannot tell incoming from
  outgoing without watching it move — that is the case for a line. Against it: length costs
  readability in a crowded frame, and the <b>BEAM</b> is the one most likely to vanish over a bright
  Plasma Reef. <b>BOLT</b> is the conservative change and <b>LANCE</b> the one that actually reads
  "laser". Whatever wins, the enemy family gets the same treatment in its own colour, and the
  direction it points is new information the frame did not carry before.
</footer>
</body></html>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`wrote ${OUT} (${(html.length / 1024).toFixed(0)} KB)`);
