/**
 * make-explosion-lab.ts — nineteen deaths, on one page, playing.
 *
 * The developer, 2026-08-16: *"when stations die all audio cuts off you dont hear
 * like an explosion effect, it would also be cool to see an actual explosion
 * effect can you make some prototype ones for us to approve on a web page"* —
 * and then, on scope: *"i want it both for ships and stations... and asteroids
 * should have them as well but more dust based perhaps?"*
 *
 * And, 2026-08-17, on the board a0-63 produced: *"for the vfx, id like to see the
 * live animation playing, and not just frame by frame"*. The filmstrip was a
 * compromise, not the ask. An explosion is motion; six stills tell you a shape
 * but not a *feel*, and feel is the thing being approved. So a0-69 rebuilt this
 * generator around a page where every candidate **plays** — the candidate set,
 * the names and the three families are untouched.
 *
 * It produces `docs/art-direction/explosion-lab.html` and **nothing in `src/`
 * changes behaviour**. A follow-up brief ports whichever ids come back.
 *
 * ## The page has two halves, and they are the same nineteen effects
 *
 * - **Live**, on top: a real PixiJS renderer driving the real {@link VfxLayer}
 *   over a real {@link ParticlePool}. See `./explosion-lab/runtime.ts`.
 * - **Stills**, underneath and smaller: the six-frame filmstrip a0-63 baked, at
 *   0.05 / 0.15 / 0.35 / 0.6 / 1.0 / 1.5 s. Kept for two reasons — a single
 *   instant is still the way to judge one instant, and if the bundle ever fails
 *   to run the page shows something rather than nineteen dead rectangles.
 *
 * Both halves emit from **one** candidate set (`./explosion-lab/candidates.ts`),
 * so the live panel and its own stills cannot disagree.
 *
 * ## One file, nothing beside it
 *
 * The studio dashboard serves an ART board by reading that single `.html` and
 * nothing else (`dashboard/server.mjs`: `/art/board/<name>` → `readFileSync`).
 * A sibling `.js` would be a 404 inside the iframe and the board would render
 * blank; the page also has to open straight off disk, with no dev server, like
 * every other board in that folder. So the runtime is **bundled and inlined**:
 * esbuild, minified, one IIFE, written into a `<script>` tag below. There are no
 * external URLs on the page at all — not a font, not a script, not an image.
 *
 * ## Why the output is a single line
 *
 * The a0-69 gate reads the committed file and asserts
 * `grep -civE 'src="http|href="http|import .from .https'` is exactly `1` — a
 * count of lines that carry no external URL, which only a **one-line document**
 * can satisfy. So {@link collapse} folds the page to one line before it is
 * written. That is a mechanical requirement of the gate, not a taste: the board
 * is a generated artefact and THIS file is the readable source of it.
 *
 * The bundle cannot simply have its newlines folded with the rest of the page —
 * PixiJS carries its GLSL and WGSL shader sources in template literals, where a
 * newline is a preprocessor line ending and a space is a syntax error. So the
 * bundle is carried as a **string literal** (newlines escaped, byte for byte)
 * and handed to indirect `eval`, which evaluates in global scope under the
 * bundle's own `"use strict"` — exactly the semantics an inline classic script
 * would have given it.
 *
 * ## What is real, and what is drawn here
 *
 * The live half is shipped code end to end: the real `ParticlePool`, the real
 * `PARTICLE` kinds and `particleKind` colours, the real emitters (the "Today"
 * rows are literally `explosion()`, `stationDeath()` and `asteroidBurst()`), the
 * real `pool.update`, and the real `VfxLayer` — the game's only particle draw
 * path — over the real `SpriteTextureCache` on a real WebGL renderer.
 *
 * The *stills* are drawn as SVG from the same pool state, because a filmstrip is
 * baked at build time in node where there is no GPU. That is a snapshot of the
 * same numbers through the same sprite definitions, not a second simulation.
 *
 * Run: npx vite-node tools/make-explosion-lab.ts
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mulberry32 } from '@shared/types';
import { hex } from '../src/art/palette';
import { shapeToSvg, spriteToGroup } from '../src/art/svg';
import { FLOOR } from '../src/art/tokens';
import type { SpriteDef } from '../src/art/shapes';
import { fadeAt, PARTICLE_KINDS, particleKind, particleSprite } from '../src/art/vfx/kinds';
import { ParticlePool } from '../src/art/vfx/particles';
import { VFX_SHOWCASE_DT } from '../src/art/vfx/showcase';
import {
  ALPHA_FLOOR,
  FAMILIES,
  FRAME_STEPS,
  FRAME_TIMES,
  LAB_POOL_CAPACITY,
  REF_ALPHA,
  SEED,
  type Candidate,
  type Family,
} from './explosion-lab/candidates';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Where the board lands, and why it lands twice.
 *
 * `docs/art-direction/` is the one that matters and it is not a preference: the
 * studio dashboard's ART page lists `workspace/docs/art-direction/*.html` and
 * nothing else, so a board written only to `assets/preview/` (where
 * `laser-lab.html` lives) never appears there and has to be handed over as a file
 * path. The developer asked directly — *"is it going to show up on the art page
 * for me to see?"* — and an unseen review surface is a review that does not
 * happen.
 *
 * The second copy is written because `assets/preview/` is where every earlier
 * lab lives and someone will look for it there. Both are written by this
 * generator from the same string, so they cannot drift into two boards.
 */
const OUTPUTS = [
  resolve(HERE, '../docs/art-direction/explosion-lab.html'),
  resolve(HERE, '../assets/preview/explosion-lab.html'),
];

/**
 * The ceiling the whole file has to stay under.
 *
 * It loads inside an iframe on a page the developer opens often, so this is a
 * real budget rather than tidiness, and it is asserted here so a regression
 * fails the generator instead of the review.
 */
const SIZE_BUDGET = 4_000_000;

/** Logical pixels across one live canvas. Mirrors `LIVE_PX` in the runtime — the
 *  CSS box and the backing store have to agree, and the runtime owns the store. */
const LIVE_PX = 440;

// ---------------------------------------------------------------------------
// Simulate — the real pool, the real update loop, a fixed timestep
// ---------------------------------------------------------------------------

/** One particle as it stood on one frame. */
interface Snap {
  readonly kind: number;
  readonly x: number;
  readonly y: number;
  readonly rot: number;
  readonly r: number;
  readonly a: number;
}

/** Run one candidate and snapshot it at each of {@link FRAME_STEPS}. */
function filmstrip(candidate: Candidate, half: number): Snap[][] {
  const pool = new ParticlePool(LAB_POOL_CAPACITY);
  const rng = mulberry32(SEED);
  candidate.emit(pool, rng);

  const frames: Snap[][] = [];
  const last = FRAME_STEPS[FRAME_STEPS.length - 1] ?? 0;
  let next = 0;
  for (let step = 0; step <= last; step++) {
    if (step > 0) pool.update(VFX_SHOWCASE_DT);
    while (next < FRAME_STEPS.length && FRAME_STEPS[next] === step) {
      frames.push(capture(pool, half));
      next++;
    }
  }
  return frames;
}

/** The visible particles, exactly as `layer.ts` would hand them to the GPU. */
function capture(pool: ParticlePool, half: number): Snap[] {
  const out: Snap[] = [];
  for (let i = 0; i < pool.count; i++) {
    const kind = pool.kind[i]!;
    const a = pool.alpha[i]! * fadeAt(kind, pool.progress(i));
    if (a < ALPHA_FLOOR) continue;
    const r = pool.radiusAt(i);
    const x = pool.x[i]!;
    const y = pool.y[i]!;
    // Wholly outside the frame: it is honest to drop it, and it is bytes.
    if (Math.abs(x) - r > half || Math.abs(y) - r > half) continue;
    // Every candidate paints kinds in their own palette colour — no emitter here
    // tints — so the SVG sprite's baked fills ARE the tint. Assert it rather than
    // promise it: a tinted particle would silently render the wrong colour.
    if (pool.color[i] !== (particleKind(kind).color >>> 0)) {
      throw new Error(`particle kind ${kind} carries a tint this page cannot draw`);
    }
    out.push({ kind, x, y, rot: pool.rot[i]!, r, a });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Draw
// ---------------------------------------------------------------------------

function n(v: number): string {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Every particle look, once, as a referenceable `<g>` in unit space. */
const kindDefs = PARTICLE_KINDS.map(
  (spec) => `<g id="pk-${spec.name}">${particleSprite(spec.kind).shapes.map(shapeToSvg).join('')}</g>`,
).join('');

const KIND_NAME = new Map<number, string>(PARTICLE_KINDS.map((s) => [s.kind as number, s.name]));

/**
 * Place a sprite so its unit radius is `r` world units, centred on the origin.
 *
 * `spriteToGroup` scales by `size / (extent * 2)`, and a sprite's extent is the
 * fraction of its own unit radius the ART reaches to — 1.95 for a station, whose
 * boom leaves the body. So the size that makes unit radius 1 land on `r` world
 * units is `2 * r * extent`, not `2 * r`. The runtime scales its reference
 * `Sprite` by the same expression, against the baked texture's own size.
 */
function refGroup(def: SpriteDef, r: number): string {
  const size = 2 * r * def.extent;
  return spriteToGroup(def, size, -size / 2, -size / 2);
}

/** The three reference bodies, defined once and `<use>`d by all 114 frames. */
const refDefs = (): string =>
  FAMILIES.map((f) => `<g id="ref-${f.key}">${refGroup(f.ref, f.refRadius)}</g>`).join('');

/** One frame, in world coordinates — the viewBox IS world space. */
function frameSvg(family: Family, snaps: Snap[]): string {
  const half = family.half;
  const matter: string[] = [];
  const light: string[] = [];
  for (const s of snaps) {
    const name = KIND_NAME.get(s.kind) ?? 'spark';
    const rot = (s.rot * 180) / Math.PI;
    const t = `translate(${n(s.x)} ${n(s.y)}) rotate(${n(rot)}) scale(${n(s.r)})`;
    const el = `<use href="#pk-${name}" transform="${t}" opacity="${n(s.a)}"/>`;
    (particleKind(s.kind).additive ? light : matter).push(el);
  }
  return (
    `<svg class="fr" viewBox="${n(-half)} ${n(-half)} ${n(half * 2)} ${n(half * 2)}" ` +
    'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">' +
    `<rect x="${n(-half)}" y="${n(-half)}" width="${n(half * 2)}" height="${n(half * 2)}" fill="${hex(FLOOR)}"/>` +
    `<use href="#ref-${family.key}" opacity="${n(family.refAlpha ?? REF_ALPHA)}"/>` +
    // Matter under light, and light composited additively — the same two-container
    // split, in the same order, that `layer.ts` puts on the GPU.
    `<g>${matter.join('')}</g>` +
    `<g class="add">${light.join('')}</g>` +
    '</svg>'
  );
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * One candidate: the live panel, its transport, then the stills.
 *
 * The `data-live-*` attributes are the contract `runtime.ts` binds against, and
 * it throws by name if one is missing rather than animating the wrong panel.
 */
function candidateRow(family: Family, candidate: Candidate): string {
  const strips = filmstrip(candidate, family.half);
  const peak = strips.reduce((m, f) => Math.max(m, f.length), 0);
  const tags = [
    candidate.today ? '<b class="tag today">TODAY</b>' : '',
    candidate.departure ? '<b class="tag depart">DEPARTURE</b>' : '',
  ].join('');
  const frames = strips
    .map((f, i) => `<figure>${frameSvg(family, f)}<figcaption>${FRAME_TIMES[i]}s</figcaption></figure>`)
    .join('');
  return `<article class="cand" id="c-${candidate.id}" data-live-fam="${family.key}" data-live-cand="${candidate.id}">
  <div class="hd"><span class="id">${candidate.id}</span><h3>${esc(candidate.name)}</h3>${tags}
    <span class="peak">${peak} particles at its peak frame</span></div>
  <p class="line">${esc(candidate.line)}</p>
  <div class="live">
    <canvas width="${LIVE_PX}" height="${LIVE_PX}" title="Click to play ${esc(candidate.name)}"></canvas>
    <div class="tx">
      <button class="btn" type="button" data-act="play">▶ Play</button>
      <button class="btn" type="button" data-act="replay">↻ Replay</button>
      <span class="clock">ready</span>
    </div>
  </div>
  <details class="stills" open>
    <summary>Stills — ${FRAME_TIMES.map((t) => `${t}s`).join(' · ')}</summary>
    <div class="strip">${frames}</div>
  </details>
</article>`;
}

function familySection(family: Family): string {
  const scale = `${n(family.half * 2)} world units across`;
  const count = family.candidates.length;
  return `<section class="fam" id="f-${family.key}">
  <h2>${esc(family.title)}</h2>
  <p class="ask">${esc(family.ask)}</p>
  <p class="meta">Frame: <b>${scale}</b>. ${esc(family.refNote)} The body is drawn at ${Math.round(
    (family.refAlpha ?? REF_ALPHA) * 100,
  )}% as a <b>ruler</b> — it is there for scale, not because it is still standing.</p>
  <div class="famtx" data-live-family="${family.key}">
    <button class="btn big" type="button" data-act="play-family">▶ Play family</button>
    <button class="btn" type="button" data-act="stop-family">■ Stop</button>
    <label class="loopbox"><input type="checkbox" data-act="loop"> Loop</label>
    <span class="hint">All ${count} at the same instant — the only honest way to judge
      ${count} deaths against each other. Loop is off until you ask for it: an effect that is fine
      once and irritating on the tenth loop has told you something.</span>
  </div>
  ${family.candidates.map((c) => candidateRow(family, c)).join('\n')}
</section>`;
}

// ---------------------------------------------------------------------------
// Bundle — the runtime, inlined, because a board is exactly one file
// ---------------------------------------------------------------------------

/**
 * Bundle `explosion-lab/runtime.ts` to a single minified IIFE.
 *
 * Aliases mirror `vite.config.ts` so the runtime imports `@shared/types` the way
 * every other module in this repo does. `platform: 'browser'` and the NODE_ENV
 * define are what let PixiJS drop its development branches.
 */
async function bundleRuntime(): Promise<string> {
  const out = await build({
    entryPoints: [resolve(HERE, 'explosion-lab/runtime.ts')],
    bundle: true,
    minify: true,
    format: 'iife',
    target: 'es2022',
    platform: 'browser',
    write: false,
    legalComments: 'none',
    logLevel: 'warning',
    alias: {
      '@shared': resolve(HERE, '../src/shared'),
      '@platform': resolve(HERE, '../src/platform'),
      '@render': resolve(HERE, '../src/render'),
    },
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const file = out.outputFiles[0];
  if (!file) throw new Error('esbuild produced no output for the explosion-lab runtime');
  // Inside a classic <script> the parser stops at the first `</script`, and
  // `<!--` opens a comment-like token. Neither can survive in the source text.
  const js = file.text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
  if (/<\/script/i.test(js) || js.includes('<!--')) {
    throw new Error('runtime bundle still contains a script-terminating sequence');
  }
  return js;
}

/**
 * The runtime as a `<script>` that survives being folded onto one line.
 *
 * `JSON.stringify` escapes every newline in the bundle, so the shader sources
 * PixiJS keeps in template literals arrive at the parser byte-identical.
 * Indirect `eval` — the `(0, eval)` form — evaluates in global scope, which is
 * what an inline classic script does; the bundle's own `"use strict"` prologue
 * then applies to it exactly as it would have there.
 *
 * U+2028 and U+2029 are line terminators to a pre-ES2019 parser and are escaped
 * rather than trusted, because a board is opened in whatever browser is to hand.
 */
function runtimeScript(js: string): string {
  const literal = JSON.stringify(js)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<script>(0,eval)(${literal})</script>`;
}

/**
 * Fold the page onto one line (see the module doc for the gate that requires it).
 *
 * Every run of whitespace containing a newline becomes a single SPACE, never
 * nothing: HTML prose wraps mid-sentence in the template below, and joining
 * `on the` to `game's own Floor` with no space would silently corrupt the copy.
 * A space is also always legal between CSS declarations and inside a tag.
 */
function collapse(page: string): string {
  return page.replace(/[ \t]*\n\s*/g, ' ').trim();
}

const runtime = await bundleRuntime();
const sections = FAMILIES.map(familySection).join('\n');

const ids = FAMILIES.map(
  (f) => `<b>${esc(f.title)}</b> — ${f.candidates.map((c) => `${c.id} ${esc(c.name)}`).join(' · ')}`,
).join('<br>');

/** Where the bundle is spliced in, AFTER the page has been folded to one line —
 *  the bundle's own newlines are escaped and must not be touched by the fold. */
const RUNTIME_SLOT = '%%RUNTIME%%';

const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Planet Rush — Explosion lab: ships, stations, asteroids</title>
<!--
  a0-63 / a0-69 · The explosion lab. GENERATED — edit tools/make-explosion-lab.ts
  (and tools/explosion-lab/) and re-run \`npx vite-node tools/make-explosion-lab.ts\`,
  never this file.

  Everything on this page came out of the game's own particle system: the real
  ParticlePool, the real PARTICLE kinds and their particleKind() colours, the
  real pool.update() loop, stepped at VFX_SHOWCASE_DT (1/60) off a seeded
  mulberry32 — never the wall clock. Today's three effects are the shipped
  explosion(), stationDeath() and asteroidBurst() called directly.

  The live panels draw through the real VfxLayer — the client's only particle
  draw path — on a real PixiJS WebGL renderer, bundled into the single <script>
  at the foot of this file. One file, no siblings: the dashboard serves a board
  by reading this .html and nothing else.

  Nothing in src/ changed. This page is the decision; the port is a follow-up.
-->
<style>
  :root{
    --vacuum:#0D1015; --floor:#070910; --panel:#141A22; --rule:#252D3A; --hair:#1c2430;
    --text:#DCE3EC; --muted:#8B95A5; --steel:#7E8894; --plasma:#4DC3FF;
    --yellow:#F2D24B; --red:#B23A3A; --patina:#4FA08B;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--vacuum);color:var(--text);
    font-family:"Oxanium","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;
    font-size:14px;line-height:1.6}
  header{padding:30px 34px 8px;border-bottom:1px solid var(--rule)}
  h1{margin:0 0 10px;font-family:"Audiowide","Oxanium",system-ui,sans-serif;
     font-size:23px;font-weight:400;letter-spacing:.02em}
  h2{margin:0 0 6px;font-family:"Audiowide","Oxanium",system-ui,sans-serif;
     font-size:17px;font-weight:400;letter-spacing:.04em;color:var(--plasma)}
  h3{margin:0;font-size:15px;font-weight:600;letter-spacing:.01em}
  p{margin:0 0 10px;max-width:104ch}
  .sub{color:var(--muted);font-size:13px}
  code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;color:#8fd0e8}
  .fam{padding:26px 34px 10px;border-bottom:1px solid var(--rule)}
  .ask{color:var(--text)}
  .meta{color:var(--muted);font-size:12.5px}
  .cand{margin:18px 0 26px;padding:14px 16px 10px;background:var(--panel);
        border:1px solid var(--hair);border-radius:10px}
  .hd{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .id{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;
      border:1px solid var(--plasma);border-radius:6px;color:var(--plasma);
      font-family:ui-monospace,monospace;font-size:14px;font-weight:700}
  .tag{font-family:ui-monospace,monospace;font-size:10px;letter-spacing:.14em;
       padding:3px 7px;border-radius:4px;font-weight:700}
  .today{background:#1d3243;color:#8fd0e8;border:1px solid #2c5570}
  .depart{background:#3a2020;color:#e0a0a0;border:1px solid #6a3535}
  .peak{margin-left:auto;color:var(--muted);font-size:11.5px;
        font-family:ui-monospace,monospace}
  .line{margin:8px 0 12px;color:var(--muted);font-size:13px;max-width:104ch}

  /* --- The live panel: the thing being approved --------------------------- */
  .live{margin:0 0 14px;width:${LIVE_PX}px}
  .live canvas{display:block;width:${LIVE_PX}px;height:${LIVE_PX}px;background:var(--floor);
    border:1px solid #2b3644;border-radius:6px;cursor:pointer}
  .live canvas:hover{border-color:var(--plasma)}
  .tx{display:flex;align-items:center;gap:10px;margin-top:8px}
  .clock{font-family:ui-monospace,monospace;font-size:11.5px;color:var(--muted)}
  .btn{font-family:"Oxanium",system-ui,sans-serif;font-size:13px;color:var(--text);
    background:#1b2430;border:1px solid #33415a;border-radius:6px;padding:6px 12px;
    cursor:pointer;letter-spacing:.02em}
  .btn:hover{background:#22303f;border-color:var(--plasma);color:#cfeeff}
  .btn.big{font-size:14px;padding:8px 16px;border-color:#3f5f7a}
  .famtx{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0 4px;
    padding:10px 12px;background:#101720;border:1px solid var(--hair);border-radius:8px}
  .loopbox{font-size:13px;color:var(--muted);display:inline-flex;align-items:center;gap:6px;
    cursor:pointer}
  .hint{color:var(--muted);font-size:12px;max-width:70ch}

  /* --- The stills, kept and smaller --------------------------------------- */
  .stills{margin:0 0 4px}
  .stills summary{color:var(--muted);font-size:12px;cursor:pointer;
    font-family:ui-monospace,monospace;letter-spacing:.04em}
  .strip{display:flex;gap:6px;flex-wrap:nowrap;overflow-x:auto;padding:8px 0 6px}
  figure{margin:0;flex:0 0 auto}
  figcaption{margin-top:3px;text-align:center;color:var(--muted);
             font-family:ui-monospace,monospace;font-size:10px}
  svg.fr{display:block;width:128px;height:128px;background:var(--floor);
         border:1px solid var(--hair);border-radius:4px}
  /* Additive light over matter, exactly as layer.ts blends it on the GPU.
     \`screen\` first so a browser without plus-lighter still composites light. */
  svg.fr g.add{mix-blend-mode:screen;mix-blend-mode:plus-lighter}
  .defs{position:absolute;width:0;height:0;overflow:hidden}

  /* --- The fallback, when the bundle cannot run --------------------------- */
  .nolive{display:none;margin:14px 34px 0;padding:12px 14px;border-radius:8px;
    background:#2a1c1c;border:1px solid #6a3535;color:#e6c3c3;font-size:13px}
  body[data-live="off"] .nolive{display:block}
  body[data-live="off"] .live,body[data-live="off"] .famtx{display:none}
  #live-error{font-family:ui-monospace,monospace;font-size:12px;color:#f0b0b0}

  footer{padding:26px 34px 46px;color:var(--muted);font-size:13px;max-width:104ch}
  footer b{color:var(--text)}
  .roster{margin-top:10px;line-height:2}
</style>
</head>
<body>
<svg class="defs" xmlns="http://www.w3.org/2000/svg"><defs>${kindDefs}${refDefs()}</defs></svg>

<header>
  <h1>Explosion lab</h1>
  <p class="sub">
    Nineteen candidates across three families, and <b>every one of them plays</b>. Press
    <b>▶ Play</b> on a candidate — or click its canvas — and that death runs at true scale on the
    game's own Floor, against its reference body. <b>▶ Play family</b> fires all of them at the same
    instant, which is the only honest way to judge six explosions against each other. In every family
    the <b>first candidate is today's effect</b>, labelled <b class="tag today">TODAY</b>.
  </p>
  <p class="sub">
    <b>Everything here is the game's own particle system, drawn by the game's own renderer.</b> Real
    <code>ParticlePool</code>, real <code>PARTICLE</code> kinds in their real colours, the real update
    loop, and the real <code>VfxLayer</code> — the client's only particle draw path — on a real WebGL
    renderer. Today's three rows are literally <code>explosion()</code>, <code>stationDeath()</code>
    and <code>asteroidBurst()</code>. Nothing in <code>src/</code> changed: <b>this page is the
    decision, the port is the follow-up.</b>
  </p>
  <p class="sub">
    <b>Replay is exact.</b> Each candidate is emitted from a seeded <code>mulberry32</code> and stepped
    at a fixed 1/60, so two viewings of one candidate are identical and a comparison is a comparison —
    on a 60 Hz monitor and on a 144 Hz one alike. Nothing autoplays.
  </p>
  <p class="sub">
    <b>Scale is true.</b> Each frame is world space — the ship, the facility and the rock are the shipped
    sprites at their shipped radii, on the game's own Floor <code>#070910</code>, and nothing is scaled up
    to photograph better. That is why the station frames look emptier: a station's shockwave is 288 units
    wide and the frame has to be big enough to hold it.
  </p>
  <p class="sub">
    <b>The stills are still here</b>, under each live panel and smaller:
    <b>${FRAME_TIMES.map((t) => `${t}s`).join(' · ')}</b>. A single instant is the way to judge a single
    instant, and they are plain SVG, so they show even if the live half cannot run.
  </p>
  <p class="sub"><b>Answer with a letter per family</b> — "B, J, N" is a complete answer. Every
    candidate carries a fixed id so the verdict can be recorded against it.</p>
</header>

<div class="nolive">
  <b>Live playback is unavailable in this browser</b> — the filmstrips below are the whole page for now.
  <br><span id="live-error"></span>
</div>

${sections}

<footer>
  <b>How to read a strip.</b> Left to right: ${FRAME_TIMES.map((t) => `${t}s`).join(', ')}. The particle
  count on the right of each header is the busiest frame, against a pool capacity of 1600 shared with
  everything else on screen — so it is also the cost.
  <br><br>
  <b>What is deliberately not here.</b> No candidate invents a colour, a blend mode or a particle look:
  all nineteen are built from the eleven shipped kinds, which is what makes a pick a tuning rather than a
  rewrite. The ore glints in the asteroid family are signal yellow, which is legal and load-bearing —
  ore is one of the two things that colour is allowed to mean.
  <br><br>
  <b>The station family's stance.</b> G, H, I, J and K all keep the shipped one: no sparkle added, the
  weight and duration of the collapse varied instead. <b>L is a labelled departure</b> — it is what a
  firework at station scale looks like, so that declining it is a decision rather than an omission.
  <div class="roster"><b>The full roster, by id:</b><br>${ids}</div>
</footer>
${RUNTIME_SLOT}
</body>
</html>
`;

// Fold first, splice second. A replacer FUNCTION is what carries the bundle in
// verbatim: `$&` and `$'` occur all over minified JavaScript and a string
// replacement would interpret them as capture-group references.
const html = `${collapse(page).replace(RUNTIME_SLOT, () => runtimeScript(runtime))}\n`;

if (html.includes('\n', 0) && html.indexOf('\n') !== html.length - 1) {
  throw new Error('explosion-lab.html is not one line — the no-external-URL gate counts lines');
}
if (html.length >= SIZE_BUDGET) {
  throw new Error(
    `explosion-lab.html is ${html.length} bytes, over the ${SIZE_BUDGET}-byte board budget`,
  );
}

for (const out of OUTPUTS) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html);
}

const total = FAMILIES.reduce((sum, f) => sum + f.candidates.length, 0);
console.log(
  `wrote ${OUTPUTS.length} copies (${(html.length / 1024).toFixed(0)} KB each, of which ` +
    `${(runtime.length / 1024).toFixed(0)} KB is the inlined runtime) — ${total} candidates live, ` +
    `${total * FRAME_TIMES.length} stills\n  ${OUTPUTS.join('\n  ')}`,
);
