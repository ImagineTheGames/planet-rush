/**
 * src/ui/healthbar.ts — health bars over combat entities.
 * OWNER: UI Engineer (GDD §2.2, §3.7).
 *
 * The developer, playing a live build: "enemies also don't show health bars and
 * they should." This is the HUD's over-ship hull bar (GDD §2.2 — "a narrow hull
 * bar in the owner's color floating over every ship") generalised to **every**
 * combat entity that carries HP: enemy ships, enemy turrets, hostile wave units,
 * and — per the v0.1.1 field request below — the **local player's own ship** too.
 * A bar tells you what you're shooting is nearly dead — or that a full-health
 * enemy just engaged.
 *
 * **The local ship (field request v0.1.1).** The first cut deliberately excluded
 * the local player's ship ("own ship keeps its existing HUD readout"). The
 * developer overruled that after playing: *in the heat of a fight they could not
 * see their own health.* So the own ship now gets a first-class bar too — same
 * sim-driven fill, but styled distinctly (player colour, slightly larger, an
 * identity outline) so it reads as "mine" at a glance. It is marked with the
 * {@link Combatant.local} flag by the caller, which is what separates it from the
 * player's *turrets*: those still get no bar (their planet's aggregate HP is the
 * top-right HOME readout, [[planet-hp]]). So "local, no bar" is now specifically
 * "a local entity that is **not** the flagged own ship."
 *
 * **What gets a bar** (the decision this module owns and unit-tests):
 *
 *  - A bar is drawn over a combat entity while it is **below full health OR
 *    currently in combat**, and hidden when it is full *and* out of combat — so
 *    the field stays clean (GDD §2.2: the HUD "shows only what the player acts
 *    on") and a bar always means "this is a fight." This holds for the own ship
 *    exactly as for enemies — a pristine, idle own ship shows nothing.
 *  - {@link Combatant.forceShow} overrides that for the own ship during a siege
 *    alarm: while your home is under attack you get to watch your hull even at
 *    full idle, because you are about to fly into that fight (GDD §2.2 — the
 *    alarm is the moment the whole design turns on).
 *  - **A local entity that is not the own ship gets no bar** — the player's own
 *    turrets read off the HOME HP readout ([[planet-hp]]), so ownership-by-local
 *    still suppresses them; only the `local`-flagged ship is exempt.
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

/** The LOCAL ship's bar is drawn slightly larger than an enemy's so it reads as
 *  "mine" at a glance (field request v0.1.1) — a touch longer and thicker, with
 *  an identity-colour outline the view adds. Still a hull read, not a HUD gauge. */
export const HEALTHBAR_LOCAL_WIDTH = 40;
export const HEALTHBAR_LOCAL_HEIGHT = 6;

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
 * One combat entity as the health-bar model sees it. Built by the caller from
 * sim state (a {@link Ship} or a {@link Turret}); the visibility decision reads
 * only the HP/combat/ownership fields, and `pos`/`radius` are passed straight
 * through to the view.
 *
 * `pos`/`radius` are **screen space, CSS px** — the caller projects world → screen
 * (via the renderer's camera projection) before handing them over, so the bar is
 * a fixed screen size and never scales with camera zoom. For the local ship the
 * caller passes the viewport centre, since the follow camera holds it there.
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
  /** True **only** for the camera-followed player's own ship (field request
   *  v0.1.1) — the one local-owned entity that now gets a bar, styled as "mine".
   *  Its own turrets are local by ownership but carry no `local` flag, so they
   *  stay bar-free. Absent/false for every enemy and hostile. */
  readonly local?: boolean;
  /** Force the bar on regardless of the damaged-or-in-combat rule. Set only for
   *  the own ship during a siege alarm, so the player can watch their hull as
   *  they scramble home even at full idle. Never set for enemies. */
  readonly forceShow?: boolean;
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
  /** The distinct-style flag: true for the local player's own-ship bar, which the
   *  view draws slightly larger with an identity outline so it reads as "mine"
   *  (field request v0.1.1). False for every enemy/hostile bar. */
  readonly local: boolean;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Whether `e` belongs to the local (camera-followed) player. Ownership, so the
 *  player's ship *and* turrets both answer true — but only the `local`-flagged
 *  ship is exempt from the no-bar rule (field request v0.1.1); their turrets read
 *  off the HOME HP readout ([[planet-hp]]) and stay bar-free. */
export function isLocalCombatant(e: { readonly owner: PlayerId }, localPlayer: PlayerId): boolean {
  return e.owner === localPlayer;
}

/**
 * Whether this entity shows a health bar this frame. The whole rule, in one
 * place so it can be unit-tested: alive, has HP, not a bar-suppressed local
 * entity, and either forced on (siege), damaged, or in combat.
 *
 * The own ship (`local`) now passes the local check and is judged by the same
 * damaged-or-in-combat rule as an enemy, plus `forceShow` for the siege alarm; a
 * local entity that is *not* the flagged ship (the player's own turrets) still
 * gets nothing.
 */
export function combatantGetsBar(e: Combatant, localPlayer: PlayerId): boolean {
  if (!e.alive) return false;
  if (e.maxHp <= 0) return false;
  // A local-owned entity gets a bar only if it is the flagged own ship.
  if (isLocalCombatant(e, localPlayer) && !e.local) return false;
  if (e.forceShow) return true;
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
      local: e.local === true,
    });
  }
  return bars;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
