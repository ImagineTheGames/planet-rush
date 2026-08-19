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
 * {@link Combatant.local} flag by the caller, which is what separates its
 * *larger* style from every other bar — including the player's own **turrets**.
 *
 * **Turrets show health when damaged (field request v0.2.2).** The first cut had
 * the player's own turrets read off the station's aggregate HOME HP readout and so
 * carry no bar. Playing a live build overruled that: *a turret taking fire is a
 * fight, and a turret is a thing you defend* — you want to see which of your
 * defences is nearly dead, not just an aggregate. So now **every** turret, yours
 * and the enemy's, gets a bar by the same damaged-or-in-combat rule as a ship,
 * flagged {@link Combatant.turret} by the caller. An enemy turret already read as
 * an enemy combatant; the change is that a *local* turret is no longer suppressed
 * by ownership. Its bar is the enemy-sized narrow bar in the **owner's colour**
 * (so a local turret is your player colour, smaller than the own-ship bar), never
 * the larger `local` own-ship style. And because a turret now slides around its
 * station's rim (sim orbit, P1), the caller projects the turret's live orbit
 * position each frame, so the bar rides along with it.
 *
 * **What gets a bar** (the decision this module owns and unit-tests):
 *
 *  - A bar is drawn over a combat entity while it is **below full health OR
 *    currently in combat**, and hidden when it is full *and* out of combat — so
 *    the field stays clean (GDD §2.2: the HUD "shows only what the player acts
 *    on") and a bar always means "this is a fight." This holds for the own ship
 *    and for every turret exactly as for enemy ships — a pristine, idle entity
 *    shows nothing.
 *  - {@link Combatant.forceShow} overrides that for the own ship during a siege
 *    alarm: while your home is under attack you get to watch your hull even at
 *    full idle, because you are about to fly into that fight (GDD §2.2 — the
 *    alarm is the moment the whole design turns on).
 *  - **Every turret gets a bar when damaged or in combat** — yours and the
 *    enemy's (field request v0.2.2), flagged {@link Combatant.turret}. A local
 *    turret is drawn in your player colour at the narrow enemy size, distinct
 *    from the larger own-ship `local` style.
 *  - **A local entity that is neither the own ship nor a turret gets no bar** —
 *    ownership-by-local still suppresses any such entity; only the `local`-flagged
 *    ship and `turret`-flagged turrets are exempt.
 *  - Dead entities and degenerate `maxHp <= 0` entities never get a bar.
 *
 * **Colour** is the owner's identity colour (style-guide §3 rule 2 — hull/HP bars
 * are one of the few places player colour is allowed), read through the same
 * roster resolver [[station-hp]] uses so a ship's trim and its bar can never
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
import type { Rect } from '@platform/layout-registry';
import { hullBarFill } from './instrument';
import { playerColor } from './station-hp';

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

/**
 * The smallest fill fraction a bar renders for a **living** entity — the
 * "a living thing never shows empty" rule (field report: an enemy read 0/70 but
 * wasn't dead). Death is `hp <= 0` in the sim; anything above that is alive, and
 * a living hull's bar keeps at least this sliver of owner colour so "empty" (and
 * "0") means exactly one thing: dead, and by then the entity is already gone.
 * A hair of hp (0.4/70 ≈ 0.006 raw) would otherwise draw an invisible fill that
 * reads as an empty track — the lie this floor removes. TUNABLE
 */
export const HEALTHBAR_MIN_FILL = 0.06;

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
   *  weapon, a turret tracking or loosing a shot). Shows a bar even at full HP, so
   *  a fresh attacker is not invisible until it takes a hit. */
  readonly inCombat: boolean;
  /** Entity centre in screen space (already projected by the caller), CSS px. */
  readonly pos: Vec2;
  /** Entity radius in screen space, CSS px — the bar hangs above by this. */
  readonly radius: number;
  /** True **only** for the camera-followed player's own ship (field request
   *  v0.1.1) — the one entity drawn in the larger "mine" style. A local turret is
   *  local by ownership but carries no `local` flag, so it gets the narrow bar in
   *  the player colour, not the own-ship style. Absent/false for every enemy and
   *  hostile. */
  readonly local?: boolean;
  /** True for a turret — a station-mounted defence, yours or an enemy's (field
   *  request v0.2.2). A turret gets a bar by the same damaged-or-in-combat rule as
   *  a ship; the flag is what lifts a *local* turret out of the ownership
   *  suppression (own turrets used to read off the HOME HP readout and show
   *  nothing). Absent/false for ships. The caller projects the turret's live orbit
   *  position into {@link pos} each frame, so the bar tracks the sliding turret. */
  readonly turret?: boolean;
  /** Force the bar on regardless of the damaged-or-in-combat rule. Set only for
   *  the own ship during a siege alarm, so the player can watch their hull as
   *  they scramble home even at full idle. Never set for enemies. */
  readonly forceShow?: boolean;
}

/** One bar to draw: everything the pooled view needs, nothing it must re-derive. */
export interface HealthBar {
  /** Owner slot — for the view/test to reason about identity if it wants to. */
  readonly owner: PlayerId;
  /** Fill fraction 0..1 — the length of the coloured part of the bar. Floored to
   *  {@link HEALTHBAR_MIN_FILL} while the entity is alive so a living hull never
   *  renders as an empty track (field report — full-empty means dead). */
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
  /** The compact current/max HP readout drawn beside the bar — `"68/70"` (field
   *  request v0.2.4). Whenever the bar shows, the number shows; it is built from
   *  the SAME sim hp as {@link fraction}, so the number and the fill can never
   *  drift. The view pools the Text (no per-frame allocation). */
  readonly hpText: string;
}

/**
 * The compact `"68/70"` current/max HP readout drawn beside a health bar (field
 * request v0.2.4) — the same treatment the station core got in
 * {@link ./station-hp} `coreHpReadout`, now for every ship and turret so there is
 * one health-bar component and one rule. Current HP **ceils** for a living
 * entity (field report — a living thing never displays 0: 0.4 hp reads `"1"`, not
 * `"0"`, because the floored readout made a ship at 0.4 hull read `0/70` and lied
 * that it was dead). Ship hull and turret HP step in whole hits, so only a live
 * siege makes them fractional; ceiling that fraction keeps the number honest at
 * the boundary that matters. Current is clamped into `[0, max]`; max is rounded
 * whole. `hp <= 0` (exactly dead) is the only thing that reads `0`, and a wrecked
 * or degenerate entity reads `"0/0"`, never a negative or a NaN.
 *
 * This is a *readout*, not a rate — the "no numbers but cost on the wheel" rule
 * (build-wheel.ts) is about the Build wheel; an HP bar has always been allowed to
 * state health (GDD §2.2), and it now states the exact number the way the core does.
 */
export function hpReadout(hp: number, maxHp: number): string {
  const max = Math.max(0, Number.isFinite(maxHp) ? Math.round(maxHp) : 0);
  return `${livingWhole(hp, max)}/${max}`;
}

/**
 * Current HP as the whole number a readout shows: a living entity (`hp > 0`)
 * **ceils** so it never rounds down to a lie — 0.4 → 1 — and clamps to `max`;
 * exactly-dead (`hp <= 0`) and non-finite hp are the only `0`. This is the one
 * "living things never display 0" rule the ship/turret readout and the station
 * core readout ([[station-hp]] `coreHpReadout`) both apply.
 */
export function livingWhole(hp: number, max: number): number {
  if (!Number.isFinite(hp) || hp <= 0) return 0;
  return Math.min(max, Math.ceil(hp));
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

/** Whether `e` belongs to the local (camera-followed) player. Ownership, so the
 *  player's ship *and* turrets both answer true — the `local`-flagged ship gets
 *  the larger own-ship bar and (field request v0.2.2) a `turret`-flagged local
 *  turret gets the narrow player-colour bar; only a local entity that is neither
 *  is suppressed. */
export function isLocalCombatant(e: { readonly owner: PlayerId }, localPlayer: PlayerId): boolean {
  return e.owner === localPlayer;
}

/**
 * Whether this entity shows a health bar this frame. The whole rule, in one
 * place so it can be unit-tested: alive, has HP, not a bar-suppressed local
 * entity, and either forced on (siege), damaged, or in combat.
 *
 * The own ship (`local`) and every turret (`turret`, field request v0.2.2) pass
 * the local check and are judged by the same damaged-or-in-combat rule as an
 * enemy, plus `forceShow` for the own ship's siege alarm; only a local entity
 * that is neither the flagged ship nor a turret still gets nothing.
 */
export function combatantGetsBar(e: Combatant, localPlayer: PlayerId): boolean {
  if (!e.alive) return false;
  if (e.maxHp <= 0) return false;
  // A local-owned entity gets a bar only if it is the flagged own ship or a
  // turret (field request v0.2.2 — all turrets show health when damaged).
  if (isLocalCombatant(e, localPlayer) && !e.local && !e.turret) return false;
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
      fraction: livingFraction(e.hp, e.maxHp),
      color: playerColor(e.owner),
      x: e.pos.x,
      y: e.pos.y,
      radius: e.radius,
      local: e.local === true,
      hpText: hpReadout(e.hp, e.maxHp),
    });
  }
  return bars;
}

/**
 * Where one bar's **track** sits on screen: centred on its entity's x, floated
 * {@link HEALTHBAR_GAP} above the entity's screen radius, in the size that bar's
 * style calls for (the local own-ship bar is the larger one — field request
 * v0.1.1). Screen space, CSS px, since the model's positions already are.
 *
 * Split out of {@link ./healthbar-view} (a0-101) so the geometry of a hull bar is
 * a value the layout tests can hold, rather than four locals inside a draw loop:
 * the view culls on this rect, draws the steel on it, and fills it through
 * {@link ./instrument} `hullBarFill` — the one function that decides which way a
 * hull bar empties. Same track, same direction, ships and turrets alike.
 */
export function healthBarTrack(bar: HealthBar): Rect {
  const width = bar.local ? HEALTHBAR_LOCAL_WIDTH : HEALTHBAR_WIDTH;
  const height = bar.local ? HEALTHBAR_LOCAL_HEIGHT : HEALTHBAR_HEIGHT;
  const bottom = bar.y - bar.radius - HEALTHBAR_GAP;
  return { x: bar.x - width / 2, y: bottom - height, width, height };
}

/**
 * The **drawn fill** of one over-entity bar — the coloured part, anchored at its
 * track's left edge so the bar empties rightward ({@link ./instrument}
 * `hullBarFill`, the one rule every hull bar on the screen takes).
 *
 * `fraction` arrives already floored by {@link livingFraction}, so a living hull
 * keeps its sliver here without this function knowing anything about hp.
 */
export function healthBarFill(bar: HealthBar): Rect {
  return hullBarFill(healthBarTrack(bar), bar.fraction);
}

/**
 * The bar's fill fraction: the true HP fraction, clamped to `[0, 1]`, but floored
 * to {@link HEALTHBAR_MIN_FILL} while the entity is **alive** (`hp > 0`) so a
 * living hull never draws an empty track (field report — a living thing never
 * shows empty; full-empty is death, exactly). `hp <= 0` stays `0`: a corpse is
 * filtered out upstream by {@link combatantGetsBar}, and a mid-explosion negative
 * hp reads as the empty it is.
 */
export function livingFraction(hp: number, maxHp: number): number {
  const raw = clamp01(hp / maxHp);
  return raw > 0 ? Math.max(HEALTHBAR_MIN_FILL, raw) : 0;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
