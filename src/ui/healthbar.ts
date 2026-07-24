/**
 * src/ui/healthbar.ts — health bars over non-local combat entities.
 * OWNER: UI Engineer (GDD §2.2, §3.7).
 *
 * The developer, playing a live build: "enemies also don't show health bars and
 * they should." This is the HUD's over-ship hull bar (GDD §2.2 — "a narrow hull
 * bar in the owner's color floating over every ship") generalised to **every**
 * non-local combat entity: enemy ships, enemy turrets, and any hostile wave unit
 * that carries HP. A bar tells you what you're shooting is nearly dead — or that
 * a full-health enemy just engaged.
 *
 * **What gets a bar** (the decision this module owns and unit-tests):
 *
 *  - A bar is drawn over a combat entity while it is **below full health OR
 *    currently in combat**, and hidden when it is full *and* out of combat — so
 *    the field stays clean (GDD §2.2: the HUD "shows only what the player acts
 *    on") and a bar always means "this is a fight."
 *  - **Never over the local player's own ship.** The player reads their own hull
 *    from the HUD (the ore/planet readouts, GDD §2.2), so a bar there would be
 *    redundant clutter over the one entity the camera is glued to. "Local" is by
 *    ownership: an entity owned by the camera-followed player is local, which
 *    also keeps the player's *own* turrets bar-free — their planet's aggregate
 *    HP is the top-right readout ([[planet-hp]]), and their turrets cluster on
 *    that same on-screen home.
 *  - Dead entities and degenerate `maxHp <= 0` entities never get a bar.
 *
 * **Colour** is the owner's identity colour (style-guide §3 rule 2 — hull/HP bars
 * are one of the few places player colour is allowed), read through the same
 * roster resolver [[planet-hp]] uses so a ship's trim and its bar can never
 * disagree. Threat red is deliberately **not** used here: red is *your* danger
 * (the under-attack alarm, your critical core), never a neutral tell over someone
 * else's ship (style-guide §2), so a low-HP enemy simply shows a short bar in its
 * owner's colour — no red.
 *
 * This module is **pure and PixiJS-free**: it decides visibility and fill from
 * sim HP/combat state and passes through the (already screen-projected) position
 * the pooled view draws at. The view is the thin Pixi half in
 * {@link ./healthbar-view}; positions arrive in screen space so the bars are
 * fixed-size and **scale-independent of camera zoom** (GDD field report), the
 * same discipline as the rest of the screen-space HUD.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import { playerColor } from './planet-hp';

// ---------------------------------------------------------------------------
// Geometry (CSS px; the Application handles devicePixelRatio) — the bar is
// "narrow" (GDD §2.2), small enough to keep the field readable behind a brawl.
// ---------------------------------------------------------------------------

/** Bar length, CSS px — a short hull read at arm's length, not a HUD gauge. */
export const HEALTHBAR_WIDTH = 28;
/** Bar thickness, CSS px. */
export const HEALTHBAR_HEIGHT = 4;
/** Clearance between the entity's sprite (its screen radius) and the bar above
 *  it, CSS px, so the bar floats clear of the hull rather than on it. */
export const HEALTHBAR_GAP = 5;

/**
 * How far below full a fraction may sit and still count as "full". Ships do not
 * repair (GDD §2.5) and turret HP steps in whole hits, so exact equality would
 * do — but a hair of float dust must never flicker a bar onto a pristine enemy,
 * which would read as "in combat" when nothing is happening.
 */
export const HEALTHBAR_FULL_EPSILON = 1e-6;

// ---------------------------------------------------------------------------
// The model I/O
// ---------------------------------------------------------------------------

/**
 * One non-local combat entity as the health-bar model sees it. Built by the
 * caller from sim state (a {@link Ship} or a {@link Turret}); the visibility
 * decision reads only the HP/combat/ownership fields, and `pos`/`radius` are
 * passed straight through to the view.
 *
 * `pos`/`radius` are **screen space, CSS px** — the caller projects world → screen
 * (via the renderer's camera projection) before handing them over, so the bar is
 * a fixed screen size and never scales with camera zoom.
 */
export interface Combatant {
  /** The entity's owner slot. `-1` (or any non-slot value) for an un-owned
   *  hostile wave unit — always non-local, and it degrades to steel below. */
  readonly owner: PlayerId;
  /** Current HP (ship hull, or turret HP). */
  readonly hp: number;
  /** Full HP for this entity. `<= 0` ⇒ no bar (degenerate). */
  readonly maxHp: number;
  /** False while dead / awaiting respawn / eliminated — a corpse gets no bar. */
  readonly alive: boolean;
  /** True while the entity is actively fighting this tick (a ship firing its
   *  beam, a turret tracking or loosing a shot). Shows a bar even at full HP, so
   *  a fresh attacker is not invisible until it takes a hit. */
  readonly inCombat: boolean;
  /** Entity centre in screen space (already projected by the caller), CSS px. */
  readonly pos: Vec2;
  /** Entity radius in screen space, CSS px — the bar hangs above by this. */
  readonly radius: number;
}

/** One bar to draw: everything the pooled view needs, nothing it must re-derive. */
export interface HealthBar {
  /** Owner slot — for the view/test to reason about identity if it wants to. */
  readonly owner: PlayerId;
  /** Fill fraction 0..1 — the length of the coloured part of the bar. */
  readonly fraction: number;
  /** The owner's identity colour (style-guide §3), from the ratified roster. */
  readonly color: number;
  /** Entity centre, screen px — the view centres the bar here and offsets it up. */
  readonly x: number;
  readonly y: number;
  /** Entity screen radius, so the view can float the bar clear of the sprite. */
  readonly radius: number;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Whether `e` belongs to the local (camera-followed) player — the one entity
 *  class that never gets a bar. Ownership, so the player's ship *and* turrets are
 *  both covered without enumerating entity kinds. */
export function isLocalCombatant(e: { readonly owner: PlayerId }, localPlayer: PlayerId): boolean {
  return e.owner === localPlayer;
}

/**
 * Whether this entity shows a health bar this frame. The whole rule, in one
 * place so it can be unit-tested: alive, non-local, has HP, and either damaged
 * or in combat.
 */
export function combatantGetsBar(e: Combatant, localPlayer: PlayerId): boolean {
  if (!e.alive) return false;
  if (e.maxHp <= 0) return false;
  if (isLocalCombatant(e, localPlayer)) return false;
  const fraction = clamp01(e.hp / e.maxHp);
  return fraction < 1 - HEALTHBAR_FULL_EPSILON || e.inCombat;
}

/**
 * Turn a frame's combat entities into the bars to draw. Pure: it filters by
 * {@link combatantGetsBar} and maps HP → fill fraction and owner → colour,
 * passing the screen position through untouched. The order of the output follows
 * the input, which is all a pooled view needs.
 */
export function healthBarModel(
  entities: readonly Combatant[],
  localPlayer: PlayerId,
): HealthBar[] {
  const bars: HealthBar[] = [];
  for (const e of entities) {
    if (!combatantGetsBar(e, localPlayer)) continue;
    bars.push({
      owner: e.owner,
      fraction: clamp01(e.hp / e.maxHp),
      color: playerColor(e.owner),
      x: e.pos.x,
      y: e.pos.y,
      radius: e.radius,
    });
  }
  return bars;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
