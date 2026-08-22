/**
 * tests/adversarial/layout-reachable.ts — **what the running game can actually
 * put on one screen.** OWNER: QA Agent (a0-128).
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * a0-122 built the sweep as a cross-product: every state × every viewport ×
 * every element against every other one. A cross-product is the right shape for
 * finding a whole class at once, and it has one failure mode — **it can compose
 * a screen the game never draws.** The sweep did:
 *
 * > `match-alarm-wheel | phone-798x384 | build-wheel | alarm-arrow`
 *
 * That cell says the build wheel's halo covers the screen-edge arrow home. a0-125
 * measured the overlap to 3.3 px, reasoned carefully about the one pixel of band
 * between the wave clock and the wheel's footprint, and carried it as a pin
 * because no position fixes it. a0-127 then went to photograph it on the running
 * build and **could not**, because the wheel is only open inside
 * `STATION.dockRange` and the arrow is only drawn while home is off the inset
 * rect — two conditions on the same number that cannot both hold:
 *
 * > *"THE VERDICT IS ABOUT THE PIN, NOT ABOUT THE SCREEN: nothing in these two
 * > frames is drawn wrongly."*
 *
 * One real lane was spent measuring a frame that does not exist. This file is so
 * that cannot happen again.
 *
 * ── DERIVED, NOT DECLARED ───────────────────────────────────────────────────
 *
 * The brief offered two ways and named the trap in the cheap one: an exclusion
 * list is *"a second hand-kept truth that will rot exactly the way the map
 * previews' dot list did (a0-124)."* So there is **no exclusion list here and no
 * pair of ids is named as impossible anywhere in `tests/`.** Instead:
 *
 *  - A match frame is staged from a {@link MatchSituation} — where the local
 *    ship's own station is, whether BUILD is held, whether the alarm is up. The
 *    *world*, not the screen.
 *  - Whether the wheel is open is {@link wheelIsOpen}, which is the shipped
 *    `canOpenWheel` (`src/ui/build-wheel.ts`) fed the shipped `isDocked`
 *    (`src/sim/buildings.ts`).
 *  - Whether the arrow is drawn is {@link arrowIsDrawn}, which is the shipped
 *    `homeArrow` (`src/ui/alarm.ts`) and the two lines of `Hud.drawHomeArrow`
 *    that read it.
 *
 * Both read the SAME `home` offset. So the impossible frame is not excluded —
 * **it is unspellable**: there is no situation you can hand the census that puts
 * a wheel and an arrow on one screen, because the offset that opens the wheel is
 * the offset that hides the arrow. Change `STATION.dockRange` or
 * `ARROW_EDGE_INSET` in `src/` and this file follows without being edited, which
 * is the property the declared list could never have.
 *
 * The arithmetic, on the phone profile a0-127 shot:
 *
 * | | value | line |
 * |---|---|---|
 * | wheel opens within | `STATION.dockRange` = 160 u | `src/sim/buildings.ts` `isDocked` |
 * | arrow hidden within | `|dy| ≤ H/2 − inset` = 384/2 − 28 = **164** u | `src/ui/alarm.ts` `homeArrow`, `ARROW_EDGE_INSET` |
 *
 * 160 < 164, on the tightest of the four viewports, so the docked disc lies
 * strictly inside the on-screen rect. `./layout-overlap.test.ts` asserts that
 * inequality against the shipped constants rather than trusting this paragraph.
 *
 * ── AND WHAT A SITUATION MAY BE ─────────────────────────────────────────────
 *
 * The second half of "a frame the game can draw" is the world: the sweep used to
 * stand home **6000 units** from the ship to be sure the arrow clamped to an
 * edge, and no shipped arena is that big — the widest is 3200×2000 and the
 * farthest a ship can get from its own station on any of the six maps is 3067 u.
 * {@link arenaReach} answers that per direction, off `src/sim/maps.ts` and the
 * wall clamp in `src/sim/step.ts`, and {@link ARROW_STAGED_RANGE} is the one
 * separation that satisfies both ends of it.
 */

import type { MiningStation, Ship } from '../../src/sim/state';
import { isDocked } from '../../src/sim/buildings';
import { MAPS } from '../../src/sim/maps';
import { SHIP_RADIUS } from '../../src/sim/constants';
import { ARROW_EDGE_INSET, homeArrow } from '../../src/ui/alarm';
import type { HomeArrow } from '../../src/ui/alarm';
import { canOpenWheel } from '../../src/ui/build-wheel';
import type { BuildWheelSignals } from '../../src/ui/build-wheel';
import { pauseAllowsDownloadLog } from '../../src/ui/pause-menu';
import type { PauseScreen } from '../../src/ui/pause-menu';
import type { EndKind } from '../../src/ui/end-of-match';
import type { Frame } from './layout-model';

// ---------------------------------------------------------------------------
// The situation a match frame is staged from
// ---------------------------------------------------------------------------

/** A world offset in sim units — station centre minus ship centre. The follow
 *  camera holds the local ship at the visible viewport centre
 *  (`@platform/camera`), which is why the HUD may read this as a screen offset
 *  and `src/ui/hud.ts` `drawHomeArrow` does. */
export interface HomeOffset {
  readonly dx: number;
  readonly dy: number;
}

/**
 * The world facts one match frame is staged from — never the screen facts.
 *
 * This is the whole of a0-128 in one type. The census used to take `wheelOpen`
 * and `alarm` as independent booleans, and two independent booleans are exactly
 * four screens whether or not the game has four. Here the wheel and the arrow
 * are both *read off* `home`, so the census can only ask for screens the game
 * would agree to draw.
 */
export interface MatchSituation {
  /**
   * Where the local ship's OWN station is, relative to the ship. The one field
   * both the wheel and the arrow depend on, and the reason they cannot disagree.
   */
  readonly home: HomeOffset;
  /** The player is holding BUILD (`HudFrame.buildRequested`). */
  readonly buildRequested: boolean;
  /** The local ship is alive (`HudFrame.shipAlive`). */
  readonly shipAlive: boolean;
  /** The local station still has a core (`HudFrame.stationAlive`). */
  readonly stationAlive: boolean;
  /** `UnderAttackAlarm.active` — sustained damage to the local player's own
   *  station this tick (`src/ui/alarm.ts`, GDD §2.2). */
  readonly alarmFiring: boolean;
  /** The onboarding sentence up this frame, or `null` (GDD §2.10). */
  readonly prompt: string | null;
  /** Screen-space camera stop for the two nameplates, or `null` for none. */
  readonly plateAt: { readonly x: number; readonly y: number } | null;
}

/** A situation with the four "nothing unusual" fields filled in, so a builder
 *  states only what it is actually varying. */
export function situation(over: Partial<MatchSituation> = {}): MatchSituation {
  return {
    home: { dx: 0, dy: 0 },
    buildRequested: false,
    shipAlive: true,
    stationAlive: true,
    alarmFiring: false,
    prompt: null,
    plateAt: null,
    ...over,
  };
}

/**
 * How the game gets to the screen a frame models.
 *
 * Every swept frame carries one, and `./layout-overlap.test.ts` fails on a frame
 * that does not — a state staged without saying how a player reaches it is the
 * seed of the next D5. The non-match arms are thin on purpose: those screens are
 * one screen each, and every element on them is already placed by the shipped
 * layout function for that screen. The only place the census composes anything
 * is the match HUD, and that arm is the whole of this file.
 */
export type Stage =
  | { readonly kind: 'match'; readonly sit: MatchSituation }
  | { readonly kind: 'pause'; readonly screen: PauseScreen }
  | { readonly kind: 'entry'; readonly screen: 'doors' | 'keypad'; readonly refused: boolean }
  | { readonly kind: 'online'; readonly withAction: boolean }
  | { readonly kind: 'end'; readonly outcome: EndKind };

/** A swept frame and the situation it was staged from. `Frame` itself is
 *  unchanged, so `./layout-model` still knows nothing about the world. */
export interface StagedFrame extends Frame {
  readonly stage: Stage;
}

// ---------------------------------------------------------------------------
// The two conditions that used to be booleans
// ---------------------------------------------------------------------------

/**
 * Is the build wheel open this frame?
 *
 * The shipped gate, called rather than restated: `canOpenWheel` is
 * `requested && shipAlive && stationAlive && docked` (`src/ui/build-wheel.ts`),
 * and `docked` is the sim's own `isDocked` — `dist² ≤ STATION.dockRange²`,
 * centre to centre (`src/sim/buildings.ts`), which is the same call
 * `src/main.ts:3879` makes before it hands the HUD its frame.
 *
 * The two casts are the same compromise the census makes for
 * `nameplateClusterClearance`: `isDocked` reads three fields of a `Ship` and one
 * of a `MiningStation`, and building the other forty would be modelling the sim
 * rather than asking it.
 */
export function wheelIsOpen(sit: MatchSituation): boolean {
  const ship = { alive: sit.shipAlive, pos: { x: 0, y: 0 } } as unknown as Ship;
  const station = { pos: { x: sit.home.dx, y: sit.home.dy } } as unknown as MiningStation;
  const signals = {
    requested: sit.buildRequested,
    docked: isDocked(ship, station),
    shipAlive: sit.shipAlive,
    stationAlive: sit.stationAlive,
  } as unknown as BuildWheelSignals;
  return canOpenWheel(signals);
}

/**
 * The arrow home for this situation, in screen space, or `null` when the game
 * would not draw one.
 *
 * **`Hud.drawHomeArrow`'s two rectangles, both of them** — and they are
 * *"genuinely different on an ultrawide (a0-74)"*, which is that method's own
 * comment and the reason this takes two arguments:
 *
 *  - **Is home already on screen?** Asked of the WHOLE viewport, *"because the
 *    world is full-bleed: a station drawn out in the gutter is a station the
 *    player can see."* `null` here is `drawHomeArrow`'s
 *    `if (visible.onScreen) return;` — and it is the half that makes the wheel
 *    and the arrow mutually exclusive.
 *  - **Where does the arrow go?** Clamped to the CONTENT BOX, *"because an arrow
 *    is only a tell if it is read, and the far edge of a 32:9 display is where
 *    the whole second report says the player is not looking"* — then shifted into
 *    screen space by the box's `x`, exactly as the view does.
 *
 * The `box` argument is a0-128's second correction to the census. Before it, the
 * model rode the arrow along the SCREEN edge on every viewport, which is the
 * game's answer on the two where the box is the screen and 440 px / 960 px wrong
 * on the two where it is not: on the 32:9 at a due-east bearing the sweep drew
 * the arrow at x 3812 and the game draws it at x 2844.5. That is the same defect
 * class as D5 one level down — a rect nobody could photograph — and it cut the
 * expensive way, because the readouts the a0-116/a0-125 yield must clear are
 * content-box furniture the screen-edge arrow mostly missed. Corrected, the
 * arrow reaches the minimap on 58 frames rather than 43, and the shipped yield
 * still holds on every one of them.
 *
 * Omit `box` and this is the visibility question alone, which is all the
 * reachability oracle needs.
 *
 * The ship sits at the centre of each rect because the follow camera puts it
 * there and the box is centred (`@platform/camera`, `@ui/viewport` `contentBox`).
 */
export function arrowHome(
  sit: MatchSituation,
  vp: { readonly width: number; readonly height: number },
  box?: { readonly x: number; readonly width: number; readonly height: number },
): HomeArrow | null {
  if (!sit.alarmFiring) return null;
  const centre = { x: vp.width / 2, y: vp.height / 2 };
  const home = { x: centre.x + sit.home.dx, y: centre.y + sit.home.dy };
  const visible = homeArrow(centre, home, vp, ARROW_EDGE_INSET);
  if (visible.onScreen) return null;
  if (!box) return visible;
  const boxCentre = { x: box.width / 2, y: box.height / 2 };
  const boxHome = { x: boxCentre.x + sit.home.dx, y: boxCentre.y + sit.home.dy };
  const inBox = homeArrow(boxCentre, boxHome, { width: box.width, height: box.height }, ARROW_EDGE_INSET);
  return { ...inBox, x: inBox.x + box.x };
}

/** Whether the screen-edge arrow is drawn at all this frame. */
export function arrowIsDrawn(
  sit: MatchSituation,
  vp: { readonly width: number; readonly height: number },
): boolean {
  return arrowHome(sit, vp) !== null;
}

// ---------------------------------------------------------------------------
// What the arena can produce
// ---------------------------------------------------------------------------

/** Every live station centre on every shipped map, with that map's bounds — the
 *  board positions a match can actually start from (`src/sim/maps.ts`). Built
 *  once: `MapDef.stations` is pure geometry and RNG-free (GDD §4.8), so the seed
 *  is a formality and the player count is the only thing that moves a placement. */
const HOMES: ReadonlyArray<{ x: number; y: number; w: number; h: number }> = (() => {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const map of MAPS) {
    for (let count = 2; count <= 8; count++) {
      for (const placement of map.stations(1, count, map.bounds)) {
        if (placement.derelict) continue;
        out.push({
          x: placement.station.x,
          y: placement.station.y,
          w: map.bounds.width,
          h: map.bounds.height,
        });
      }
    }
  }
  return out;
})();

/**
 * The farthest a ship can be from its own station in the direction `(dx, dy)`,
 * over every shipped map and every player count.
 *
 * The station is where the map puts it and the ship is free, so this is the ray
 * from a station to the arena wall — and the wall is `src/sim/step.ts`'s own
 * clamp, `pos ∈ [radius, bounds − radius]`, at `SHIP_RADIUS`.
 *
 * This is the second half of "a frame the game can draw", and it is not
 * hypothetical: the census used to stand home 6000 u away to be certain the
 * arrow clamped to an edge, and the largest number this function ever returns is
 * 3067.
 */
export function arenaReach(dx: number, dy: number): number {
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 0;
  // The ship travels opposite the offset: `home - ship` grows as the ship
  // retreats from its station.
  const ux = -dx / len;
  const uy = -dy / len;
  const r = SHIP_RADIUS;
  let best = 0;
  for (const home of HOMES) {
    let t = Infinity;
    if (Math.abs(ux) > 1e-12) t = Math.min(t, ux > 0 ? (home.w - r - home.x) / ux : (r - home.x) / ux);
    if (Math.abs(uy) > 1e-12) t = Math.min(t, uy > 0 ? (home.h - r - home.y) / uy : (r - home.y) / uy);
    if (t > best) best = t;
  }
  return Math.max(0, best);
}

/**
 * The ship-to-home separation the alarm states stage, in world units.
 *
 * Bracketed at both ends by numbers this file derives rather than chosen for
 * roundness, and `./layout-overlap.test.ts` asserts both brackets so the day one
 * of them moves is the day this number is re-taken:
 *
 *  - **≥ 1958.7** — the largest separation any of the four viewports needs to
 *    put home off its inset rect. The binding case is the 32:9 at a corner
 *    bearing: `hypot(3840/2 − 28, 1080/2 − 28)` = 1960.1, and the worst bearing
 *    the sweep actually samples lands at 1958.7.
 *  - **≤ 2048.0** — the smallest {@link arenaReach} over the 360 sampled
 *    bearings, i.e. the tightest direction any shipped map can still produce.
 *
 * 2000 is the only round number in that window, and the window is 89 units wide.
 */
export const ARROW_STAGED_RANGE = 2000;

/** The home offset for an alarm frame at `bearing`, at {@link ARROW_STAGED_RANGE}. */
export function homeAway(bearing: number): HomeOffset {
  return {
    dx: Math.cos(bearing) * ARROW_STAGED_RANGE,
    dy: Math.sin(bearing) * ARROW_STAGED_RANGE,
  };
}

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

/**
 * One element whose presence on a frame is a **decision**, with the shipped
 * predicate that makes it.
 *
 * Deliberately not every element. A rule here earns its place by being something
 * the census could get wrong: `controls-strip` is `showControlsStrip(isTouch)`
 * at its only call site and re-deriving it here would compare a function to
 * itself with no input space to explore. These seven are the ones the census
 * *composes* — the places where, before a0-128, a builder set a boolean and
 * nothing checked it against the game.
 *
 * The match rules read the same helpers the census does, so on the day this file
 * ships they agree by construction. That is the point rather than a weakness:
 * the assertion exists to fail the day somebody hand-sets `wheelOpen: true`
 * again, and the non-tautological half of the claim — that the docked disc lies
 * strictly inside the on-screen rect on every viewport — is proved against
 * `STATION.dockRange` and `ARROW_EDGE_INSET` in the test itself.
 */
interface DrawRule {
  /** For the report and the failure message. */
  readonly what: string;
  /** Which painted ids this rule speaks for. */
  matches(id: string): boolean;
  /** Whether the game draws it, given how the frame is staged. `null` for a
   *  stage this rule has nothing to say about. */
  drawn(stage: Stage, vp: { width: number; height: number }): boolean | null;
}

const RULES: readonly DrawRule[] = [
  {
    what: 'the Build & Upgrade wheel — `canOpenWheel` on the sim’s own `isDocked` (GDD §2.5)',
    matches: (id) => id === 'build-wheel',
    drawn: (stage) => (stage.kind === 'match' ? wheelIsOpen(stage.sit) : null),
  },
  {
    what: 'the under-attack frame — `Hud.updateAlarm`’s `alarmGroup.visible = active` (GDD §2.2)',
    matches: (id) => id.startsWith('alarm-frame-'),
    drawn: (stage) => (stage.kind === 'match' ? stage.sit.alarmFiring : null),
  },
  {
    what: 'the screen-edge arrow home — the alarm is up AND home is off the inset rect (GDD §2.2)',
    matches: (id) => id === 'alarm-arrow',
    drawn: (stage, vp) => (stage.kind === 'match' ? arrowIsDrawn(stage.sit, vp) : null),
  },
  {
    what: 'the corner DOWNLOAD LOG offer on the pause stack — `pauseAllowsDownloadLog` (a0-97)',
    matches: (id) => id === 'playtest-download-log-button',
    drawn: (stage) => (stage.kind === 'pause' ? pauseAllowsDownloadLog(stage.screen) : null),
  },
  {
    what: 'the refusal panel on an entry screen — drawn only after a refused HOST/JOIN (a0-114)',
    matches: (id) => id.startsWith('pr-connect-trace-'),
    drawn: (stage) => (stage.kind === 'entry' ? stage.refused : null),
  },
  {
    what: 'BACK TO MENU on an online overlay — an error offers it, a reconnect does not',
    matches: (id) => id === 'connection-action',
    drawn: (stage) => (stage.kind === 'online' ? stage.withAction : null),
  },
];

/**
 * Every way this frame disagrees with what the game would draw for its stage —
 * empty for a frame the game can draw.
 *
 * Both directions, because both are defects of the instrument: an element the
 * game would not draw is a a0-128 (a finding nobody can act on), and an element
 * the game WOULD draw and the census left out is the quieter half — an element
 * left out of a sweep reads exactly like an element that passed.
 */
export function unreachable(frame: StagedFrame, vp: { width: number; height: number }): string[] {
  const out: string[] = [];
  for (const rule of RULES) {
    const want = rule.drawn(frame.stage, vp);
    if (want === null) continue;
    const have = frame.painted.some((p) => rule.matches(p.id));
    if (want === have) continue;
    out.push(
      `${frame.state} | ${frame.viewport} — ${have ? 'painted' : 'left out'} where the game ` +
        `${want ? 'draws' : 'does not draw'} it: ${rule.what}`,
    );
  }
  if (frame.stage.kind === 'match') {
    const { home } = frame.stage.sit;
    const separation = Math.hypot(home.dx, home.dy);
    const reach = arenaReach(home.dx, home.dy);
    if (separation > reach + 1e-6) {
      out.push(
        `${frame.state} | ${frame.viewport} — staged with home ${separation.toFixed(1)} u from the ` +
          `ship, and no shipped map can put it further than ${reach.toFixed(1)} u in that ` +
          `direction (src/sim/maps.ts bounds, src/sim/step.ts wall clamp at SHIP_RADIUS)`,
      );
    }
  }
  return out;
}
