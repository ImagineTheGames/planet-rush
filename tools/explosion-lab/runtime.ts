/**
 * tools/explosion-lab/runtime.ts — the lab's live end. OWNER: Art Agent.
 *
 * The developer, 2026-08-17: *"for the vfx, id like to see the live animation
 * playing, and not just frame by frame"*. They are right — an explosion is
 * motion, and six stills tell you a shape but not a feel, which is the thing
 * being approved. This file is what makes every candidate play; a0-69.
 *
 * ## It draws with the game's renderer, not with a lookalike
 *
 * Everything below the DOM plumbing is shipped code:
 *
 *  - the real {@link ParticlePool}, emitted into by the real candidate set
 *    (`./candidates`, whose "Today" rows are the shipped `explosion()`,
 *    `stationDeath()` and `asteroidBurst()`);
 *  - the real `pool.update` integrator;
 *  - the real {@link VfxLayer} — the game's ONLY particle draw path — over the
 *    real {@link SpriteTextureCache}, so the eleven particle looks are the same
 *    baked textures the client uploads, at the same `PARTICLE_TEXTURE_PX`, split
 *    across the same two containers with the same blend modes;
 *  - a real PixiJS `Renderer`, i.e. the same WebGL compositing.
 *
 * Nothing here re-implements particle motion or particle drawing in canvas2d.
 * That is not fastidiousness: `sky-preview`'s "game today" panel drew its own
 * approximation, drifted from the shipped client, and cost five rounds on the
 * star bloom. A lab that flatters an effect approves something the game cannot
 * draw.
 *
 * ## One renderer, nineteen canvases
 *
 * Nineteen `<canvas>` elements with nineteen WebGL contexts would exceed what a
 * browser keeps alive (Chrome evicts past ~16, oldest first — the top of the
 * page would go black while the bottom played). So there is **one** renderer,
 * off-screen, and each candidate's frame is rendered into it and blitted to that
 * candidate's own 2D canvas with `drawImage`. The pixels are the renderer's; the
 * blit is a copy, not a second drawing path.
 *
 * ## Determinism
 *
 * A candidate is emitted once, at t = 0, from a fresh `mulberry32(SEED)` — so a
 * replay is byte-identical to the viewing before it, and two candidates started
 * together stay in lockstep. Real time is *accumulated* and the pool is stepped
 * in whole {@link VFX_SHOWCASE_DT} increments, never by the raw frame delta: a
 * lab that ran differently on a 144 Hz monitor would approve one effect on the
 * developer's machine and a different one on the agent's.
 *
 * ## a0-86 — two panels per candidate, one motion, one texture set apart
 *
 * The colour round doubles the panels and doubles nothing else. Each candidate
 * gets a cold `Live` and a red one; the red one's pool is a `HeatPool` (`./heat`)
 * that maps the colour column as the candidate's own emit code writes into it,
 * and its `VfxLayer` is built over a SECOND {@link SpriteTextureCache} that was
 * seeded with the warm looks before the layer asked for them.
 *
 * That second cache is the whole mechanism, and it is worth being plain about
 * why it is a cache rather than a flag: `VfxLayer` bakes a kind's texture through
 * `cache.getBy('vfx:<name>:<size>', …)`, and `getBy` builds only on a miss. Seed
 * the key and the layer picks up the warm texture without a line of `src/`
 * changing and without the lab drawing particles by any path but the game's own.
 * Two caches, not one, because the cold panel beside it must still get the cold
 * texture under that same key.
 *
 * ## The DOM contract
 *
 * `../make-explosion-lab.ts` writes the markup this file binds to, from the same
 * `FAMILIES` array, and a mismatch throws rather than silently animating the
 * wrong panel:
 *
 *   `[data-live-cand="<id>"][data-live-fam="<key>"]`  one candidate's CARD
 *   `[data-live-treat="C"|"R"]`                       one treatment's panel in it
 *   `[data-act="play"|"replay"]`                      inside that candidate's card
 *   `[data-live-family="<key>"]`                      the family transport bar
 *   `[data-act="play-family"|"stop-family"|"loop"]`   inside that bar
 *
 * If any of it throws — no WebGL, a stale page against a newer bundle — the page
 * falls back to the filmstrips, which are plain SVG and always there.
 */

import { Container, Sprite, autoDetectRenderer, type Renderer } from 'pixi.js';

import { mulberry32 } from '@shared/types';
import { FLOOR } from '../../src/art/tokens';
import { SpriteTextureCache } from '../../src/art/textures';
import { PARTICLE_KINDS } from '../../src/art/vfx/kinds';
import { PARTICLE_TEXTURE_PX, VfxLayer } from '../../src/art/vfx/layer';
import type { ParticlePool } from '../../src/art/vfx/particles';
import { VFX_SHOWCASE_DT } from '../../src/art/vfx/showcase';
import { HEAT_SPRITES } from './heat';
import {
  FAMILIES,
  REF_ALPHA,
  SEED,
  TREATMENTS,
  optionId,
  poolFor,
  type Candidate,
  type Family,
  type Treatment,
} from './candidates';

/** Logical pixels across one live canvas. Every family uses the same box, so a
 *  comparison between two candidates is a comparison of the effects and not of
 *  the frames they were given. World extent per family still differs — that is
 *  what makes the scale true. */
const LIVE_PX = 400;

/** The device-pixel-ratio clamp the client itself uses (`src/main.ts`). Applied
 *  to the renderer, to the baked textures, and to every panel's backing store,
 *  so the blit between them is 1:1 and never resamples. */
const RESOLUTION = Math.min(window.devicePixelRatio || 1, 2);

/** Pixels across the baked reference-body texture. It is a ruler drawn once per
 *  family; 256 keeps a station (192 units across a 640-unit frame) from softening
 *  into the thing being reviewed. */
const REF_TEX_PX = 256;

/** Longest real interval one tick may advance the sim. A backgrounded tab
 *  returns with a multi-second delta; without this, an effect would silently
 *  fast-forward to its own end the moment the developer switched back. */
const MAX_FRAME = 0.25;

/** Fixed steps one tick may run. The ceiling that keeps a slow machine from
 *  spiralling: better to drop simulated time than to fall further behind. */
const MAX_STEPS = 16;

/** How long a finished candidate rests before a looping family re-fires it. An
 *  effect that snapped straight back would read as part of the effect. */
const LOOP_HOLD = 0.55;

/** One candidate in one treatment, wired to its canvas and its own pool. */
interface Live {
  readonly family: FamilyState;
  readonly candidate: Candidate;
  readonly treatment: Treatment;
  /** The candidate's card in the page — the scope every control is found in. */
  readonly card: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly clock: HTMLElement | null;
  /** The scene this candidate renders: ruler body, then the real VFX layer. */
  readonly stage: Container;
  readonly layer: VfxLayer;
  readonly pool: ParticlePool;
  playing: boolean;
  /** Simulated seconds since t = 0. Never the wall clock. */
  t: number;
  /** Real seconds banked but not yet worth a whole fixed step. */
  acc: number;
  /** Real seconds the pool has been empty — the loop's rest interval. */
  dead: number;
}

/**
 * One candidate's two treatments and the transport they share.
 *
 * The transport is per candidate rather than per panel on purpose: the round is
 * a colour comparison, and two colours played one after the other are one colour
 * played against a memory of the other. Both fire on the same instant.
 */
interface Pair {
  readonly card: HTMLElement;
  readonly playButton: HTMLElement | null;
  readonly members: Live[];
}

/** One family's shared transport state. */
interface FamilyState {
  readonly family: Family;
  loop: boolean;
  readonly members: Live[];
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

/** Nothing autoplays: the developer opens this page to make a decision, not to
 *  be ambushed by twelve simultaneous explosions. Boot only *readies* panels. */
async function boot(): Promise<void> {
  const resolution = RESOLUTION;
  const renderer: Renderer = await autoDetectRenderer({
    width: LIVE_PX,
    height: LIVE_PX,
    resolution,
    antialias: true,
    background: FLOOR,
    backgroundAlpha: 1,
    preference: 'webgl',
  });

  // The client's own cache, at the client's own device-pixel-ratio clamp
  // (`src/main.ts`). Eleven particle textures and three reference bodies, baked
  // once between all nineteen candidates.
  const cache = new SpriteTextureCache(renderer, resolution);
  // And the red one. `VfxLayer` bakes a kind through `getBy('vfx:<name>:<size>')`
  // and `getBy` builds only on a miss, so seeding those keys with the warm looks
  // is all it takes for the layer to draw the ember register — no fork of the
  // draw path, no branch in `src/`, the same eleven kinds through the same code.
  const heatCache = new SpriteTextureCache(renderer, resolution);
  for (const spec of PARTICLE_KINDS) {
    const warm = HEAT_SPRITES[spec.kind];
    if (warm) heatCache.getBy(`vfx:${spec.name}:${PARTICLE_TEXTURE_PX}`, () => warm, PARTICLE_TEXTURE_PX);
  }

  const states: FamilyState[] = [];
  const pairs: Pair[] = [];

  for (const family of FAMILIES) {
    const state: FamilyState = { family, loop: false, members: [] };
    for (const candidate of family.candidates) {
      const members = TREATMENTS.map((treatment) =>
        wire(state, candidate, treatment, treatment.heat ? heatCache : cache, cache),
      );
      const card = members[0]?.card;
      if (!card) throw new Error(`explosion lab: no treatments for ${family.key}/${candidate.id}`);
      state.members.push(...members);
      pairs.push({ card, playButton: card.querySelector<HTMLElement>('[data-act="play"]'), members });
    }
    bindFamily(state);
    states.push(state);
  }

  const all = states.flatMap((s) => s.members);
  /** A panel's card → the pair it belongs to, for the shared transport. */
  const pairOf = new Map<HTMLElement, Pair>(pairs.map((p) => [p.card, p]));
  let raf = 0;
  let last = 0;

  /** Advance every playing candidate off ONE clock, so a family fired together
   *  stays together. */
  const tick = (now: number): void => {
    raf = 0;
    const dt = last === 0 ? 0 : Math.min(MAX_FRAME, (now - last) / 1000);
    last = now;
    let any = false;
    for (const live of all) {
      if (!live.playing) continue;
      step(live, dt);
      any ||= live.playing;
    }
    if (any) raf = requestAnimationFrame(tick);
    else last = 0;
  };

  const pump = (): void => {
    if (raf === 0) {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };

  /** Step one candidate at the fixed timestep, then blit it. */
  const step = (live: Live, dt: number): void => {
    // Already over: the last particle retired on an earlier tick and the panel
    // is holding its final frame. Time stops here rather than running on — a
    // clock that kept counting through the rest would read as effect that was
    // still going, which is the one thing this page must not misreport.
    if (live.pool.count === 0) {
      live.dead += dt;
      if (live.family.loop) {
        if (live.dead >= LOOP_HOLD) start(live);
      } else halt(live);
      return;
    }

    live.acc += dt;
    let steps = 0;
    while (live.acc >= VFX_SHOWCASE_DT && steps < MAX_STEPS) {
      live.pool.update(VFX_SHOWCASE_DT);
      live.acc -= VFX_SHOWCASE_DT;
      live.t += VFX_SHOWCASE_DT;
      steps++;
    }
    // Behind by more than this tick can cover: drop the arrears rather than
    // chase them. Dropped time is visible as a stutter; chased time is a
    // different effect.
    if (steps === MAX_STEPS) live.acc = 0;
    paint(live);
    // The pool may have just emptied on this very step; the hold starts on the
    // next tick, with the final frame already on screen.
    live.dead = 0;
  };

  /** Draw one candidate's current pool state into its own canvas. */
  const paint = (live: Live): void => {
    live.layer.draw(live.pool);
    renderer.render(live.stage);
    live.ctx.drawImage(renderer.canvas as CanvasImageSource, 0, 0);
    if (live.clock) {
      live.clock.textContent = live.playing
        ? `${live.t.toFixed(2)}s · ${live.pool.count}p`
        : 'ready';
    }
    label(live);
  };

  /** A pair's button says what pressing it will do, whichever panel is running. */
  const label = (live: Live): void => {
    const pair = pairOf.get(live.card);
    if (!pair?.playButton) return;
    const any = pair.members.some((m) => m.playing);
    pair.playButton.textContent = any ? '❚❚ Pause both' : '▶ Play both';
  };

  /** (Re-)fire a candidate from t = 0 on a fresh stream off the same seed. */
  const start = (live: Live): void => {
    live.pool.clear();
    live.candidate.emit(live.pool, mulberry32(SEED));
    live.t = 0;
    live.acc = 0;
    live.dead = 0;
    live.playing = true;
    paint(live);
    pump();
  };

  /** Stop, and leave the panel showing whatever the last frame was. */
  const halt = (live: Live): void => {
    live.playing = false;
    live.acc = 0;
    label(live);
    if (live.clock) {
      // Paused and finished are different states and the readout says which:
      // "end" against a frame that still has particles in it would be a lie
      // about the effect's length, which is one of the things being judged.
      const at = `${live.t.toFixed(2)}s`;
      live.clock.textContent =
        live.t <= 0 ? 'ready' : live.pool.count > 0 ? `paused · ${at}` : `end · ${at}`;
    }
  };

  /** Empty the panel back to bare ground and the ruler body. */
  const idle = (live: Live): void => {
    live.pool.clear();
    live.t = 0;
    halt(live);
    live.layer.draw(live.pool);
    renderer.render(live.stage);
    live.ctx.drawImage(renderer.canvas as CanvasImageSource, 0, 0);
  };

  /** Resume a paused panel without re-emitting — Play after Pause is not Replay. */
  const resume = (live: Live): void => {
    if (live.pool.count > 0) {
      live.playing = true;
      label(live);
      pump();
    } else start(live);
  };

  for (const pair of pairs) {
    // Play/Pause acts on BOTH treatments at once, so the two colours are always
    // on the same frame of the same motion; Replay always goes back to t = 0.
    // Two viewings of one option have to be identical for a comparison to be a
    // comparison, and two panels have to be simultaneous for the same reason.
    pair.playButton?.addEventListener('click', () => {
      if (pair.members.some((m) => m.playing)) for (const m of pair.members) halt(m);
      else for (const m of pair.members) resume(m);
    });
    pair.card.querySelector('[data-act="replay"]')?.addEventListener('click', () => {
      for (const m of pair.members) start(m);
    });
  }

  for (const live of all) {
    // "Click it and that one plays" — the canvas is the biggest target there is,
    // and it is the one control that acts on a SINGLE option, which is how a
    // verdict takes a second look at exactly the one it is about to name.
    live.canvas.addEventListener('click', () => {
      if (live.playing) halt(live);
      else start(live);
    });
    idle(live);
  }

  for (const state of states) {
    const bar = document.querySelector(`[data-live-family="${state.family.key}"]`);
    // Every candidate at the same instant: the only way to judge six explosions
    // against each other.
    bar?.querySelector('[data-act="play-family"]')?.addEventListener('click', () => {
      for (const live of state.members) start(live);
    });
    bar?.querySelector('[data-act="stop-family"]')?.addEventListener('click', () => {
      for (const live of state.members) idle(live);
    });
    const loop = bar?.querySelector('[data-act="loop"]');
    loop?.addEventListener('change', () => {
      state.loop = (loop as HTMLInputElement).checked;
      // Turning Loop on mid-run should catch the ones that already finished.
      if (state.loop) for (const live of state.members) if (!live.playing) start(live);
    });
  }

  document.body.dataset['live'] = 'on';
}

/**
 * Build one option's panel: canvas, scene, pool, and the ruler body.
 *
 * `cache` is the treatment's own texture cache — cold or red — and `refCache` is
 * always the cold one, because the reference body is a RULER. Warming the ship
 * you are measuring against would put the treatment on both sides of the
 * comparison.
 */
function wire(
  state: FamilyState,
  candidate: Candidate,
  treatment: Treatment,
  cache: SpriteTextureCache,
  refCache: SpriteTextureCache,
): Live {
  const key = state.family.key;
  const id = optionId(candidate, treatment);
  const card = document.querySelector<HTMLElement>(
    `[data-live-cand="${candidate.id}"][data-live-fam="${key}"]`,
  );
  if (!card) throw new Error(`explosion lab: no card for ${key}/${candidate.id}`);
  const box = card.querySelector<HTMLElement>(`[data-live-treat="${treatment.key}"]`);
  if (!box) throw new Error(`explosion lab: no ${treatment.key} panel for ${key}/${id}`);
  const canvas = box.querySelector('canvas');
  if (!canvas) throw new Error(`explosion lab: no canvas for ${key}/${id}`);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error(`explosion lab: no 2d context for ${key}/${id}`);
  // Backing store at the same resolution the renderer draws at, so the blit is
  // a straight copy: `drawImage(source, 0, 0)` with no scale and no resample.
  canvas.width = Math.round(LIVE_PX * RESOLUTION);
  canvas.height = Math.round(LIVE_PX * RESOLUTION);

  const stage = new Container();
  // The frame IS world space, exactly as the filmstrip's viewBox is: `half` world
  // units from the centre to each edge, whatever that costs in pixels.
  stage.scale.set(LIVE_PX / (state.family.half * 2));
  stage.x = LIVE_PX / 2;
  stage.y = LIVE_PX / 2;

  // The reference body, at its shipped radius and its shipped look. A sprite's
  // texture is REF_TEX_PX across its full extent, and a sprite's extent is the
  // fraction of its own unit radius the art reaches to (1.95 for a station,
  // whose boom leaves the body) — so unit radius 1 lands on `refRadius` world
  // units at a scale of 2·r·extent / REF_TEX_PX.
  const ref = new Sprite(refCache.get(state.family.ref, REF_TEX_PX));
  ref.anchor.set(0.5);
  ref.scale.set((2 * state.family.refRadius * state.family.ref.extent) / REF_TEX_PX);
  ref.alpha = state.family.refAlpha ?? REF_ALPHA;

  const layer = new VfxLayer(cache);
  stage.addChild(ref, layer);

  return {
    family: state,
    candidate,
    treatment,
    card,
    canvas,
    ctx,
    clock: box.querySelector<HTMLElement>('.clock'),
    stage,
    layer,
    pool: poolFor(treatment),
    playing: false,
    t: 0,
    acc: 0,
    dead: 0,
  };
}

/** Nothing to bind yet beyond presence — asserted here so a missing transport
 *  bar fails at boot with a name, not silently on the first click. */
function bindFamily(state: FamilyState): void {
  if (!document.querySelector(`[data-live-family="${state.family.key}"]`)) {
    throw new Error(`explosion lab: no transport bar for family ${state.family.key}`);
  }
}

boot().catch((err: unknown) => {
  // The filmstrips are plain SVG and are already on the page, so a failure here
  // degrades to the a0-63 board rather than to six dead rectangles. a0-86 folded
  // them into a closed `<details>` — thirty-eight strips open at once is a page
  // nobody can scroll — so the fallback has to open them again, or the degraded
  // board would be a list of summaries.
  for (const d of document.querySelectorAll('details.stills')) (d as HTMLDetailsElement).open = true;
  document.body.dataset['live'] = 'off';
  const why = document.querySelector('#live-error');
  if (why) why.textContent = String(err instanceof Error ? err.message : err);
  console.error('[explosion-lab] live playback unavailable', err);
});
