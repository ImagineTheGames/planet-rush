/**
 * tests/adversarial/layout-overlap.test.ts — **the standing gate.** OWNER: QA
 * Agent (a0-122).
 *
 * Six overlap defects shipped in four days:
 *
 * | brief  | what was covering what                                            |
 * |--------|-------------------------------------------------------------------|
 * | a0-97  | the pause SETTINGS screen's DONE plate, under the DOWNLOAD LOG button |
 * | a0-100 | the objective prompt drawn through the build wheel, 318 px of it   |
 * | a0-114 | a refused HOST drawing RETRY and DOWNLOAD LOG onto the doors       |
 * | a0-115 | a rival nameplate drawn through the word ORE, 4 of 28 stops        |
 * | a0-116 | the alarm arrow across the wave clock                              |
 * | a0-119 | two nameplates for the same owner, on each other                   |
 *
 * **Every one was found by a person looking at a screenshot, and CI was green
 * for all six** — because a golden compares a frame to yesterday's frame, and a
 * frame that was always wrong stays wrong quietly. Six briefs each measured one
 * pair by hand (a0-99, a0-111, a0-118 did the measuring); none of them left an
 * instrument behind, so the seventh had to start over.
 *
 * a0-106 proved the shape of the answer for bot behaviour — one instrument, run
 * across a cross-product, finds the whole class instead of one instance. This is
 * that, for layout: every game state × every viewport × every registered element
 * × every other one, against one rule.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * > **An element a player must read or press may not be covered by another
 * > element drawn after it.**
 *
 * `./layout-model` holds it, with the argument for every word; `./layout-frames`
 * holds the census it is asked about, with the argument for every state. The
 * intent is encoded rather than assumed: a decorative ground cannot be the victim
 * of a cover by construction, and the deliberate keep-outs a0-115 established are
 * declared rows with a reason each, in the file, never a silent skip.
 *
 * ── THE SIX ASSERTIONS ──────────────────────────────────────────────────────
 *
 *  1. **Nothing a player must read is covered by anything else** — the whole
 *     property, in one list, minus {@link KNOWN_COVERS}.
 *  2. **A control's own coordinates answer the control** — a0-114's nine-point
 *     `elementFromPoint` probe, reproduced headlessly. Rect intersection over
 *     *registry entries* would have scored a0-97 and a0-114 clean, because neither
 *     coverer is in the registry at all; this is the half that sees the DOM.
 *  3. **Every pinned overlap still reproduces where the report says it does** —
 *     and this one points the other way on purpose. It fails **the day a cell is
 *     fixed**, and the failure means "delete the line", not "something broke". QA
 *     owns `tests/` and `harness/`; every finding here ships as a reproduction a
 *     ui brief can be built from, never as an edit to `src/`.
 *  4. **The sweep would have caught all six** — each of the six re-staged through
 *     the same builders with only the rule that fixed it switched off
 *     (`./layout-frames` `CONTROLS`). A green sweep that cannot go red is a
 *     screenshot with extra steps, and all six of these screens were green.
 *  5. **The cross-product is the full one, and every declared exception is one
 *     the sweep actually needs** — the two ways this instrument could quietly
 *     stop meaning anything.
 *  6. **Every swept frame is a frame the game can draw** (a0-128) — the third
 *     way, and the one that had already happened. A cross-product composes; a
 *     game does not. See below.
 *
 * ── AND THE ONE THE CROSS-PRODUCT ITSELF GOT WRONG (a0-128) ─────────────────
 *
 * The sweep's own shape is what made D5: `wheelOpen` and `alarm` were
 * independent booleans, two independent booleans are four screens, and the game
 * only has three of them. 288 of the 1,896 frames — every frame of
 * `match-alarm-wheel` — put the build wheel and the arrow home on one screen,
 * which `src/` cannot do: the wheel opens inside `STATION.dockRange` and the
 * arrow is drawn only once home is off the inset rect, and 160 < 164 on the
 * tightest viewport. a0-125 spent a lane measuring 3.3 px of that overlap and
 * a0-127 went to photograph it and could not.
 *
 * The fix is DERIVED, not declared: `./layout-reachable` stages a match frame
 * from the world (where the ship's own station is, whether BUILD is held) and
 * asks the shipped predicates what is on the glass, so the impossible frame is
 * not excluded — it is unspellable. There is no exclusion list in `tests/` and
 * no pair of ids is named impossible anywhere, because a hand-kept list of
 * impossibilities rots exactly the way a0-124's dot list did.
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 *
 * 1,612 frames, ~100 ms. Cheap enough to be a standing gate rather than an
 * evidence script somebody remembers to run — which is the whole difference
 * between this and the six hand measurements it replaces.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { STATION } from '../../src/sim/constants';
import { ARROW_EDGE_INSET } from '../../src/ui/alarm';
import { CONTROLS, STATES, VIEWPORTS, baseState, sweepFrames } from './layout-frames';
import {
  ARROW_STAGED_RANGE,
  arenaReach,
  arrowIsDrawn,
  situation,
  unreachable,
  wheelIsOpen,
} from './layout-reachable';
import type { StagedFrame } from './layout-reachable';
import {
  LAYOUT_ALLOWANCES,
  coverLine,
  coversInFrame,
  foreignTopmost,
  layer,
} from './layout-model';
import type { Cover, Frame } from './layout-model';

/**
 * **The a0-122 findings, pinned — and the list is EMPTY.**
 * `state | viewport | coverer | covered`, one line per cell that breaches today.
 *
 * a0-122 pinned five defects here because QA does not own `src/`. **a0-125 landed
 * four of the five, and a0-128 took the fifth off the board a different way** —
 * by establishing that it was never on one. It was twenty-four lines; it is none.
 *
 *  1. **`fullscreen-reenter` over `station-hp`** — 462 frames, phone, every match
 *     state. **FIXED (a0-125 D1).** The affordance hugged the top-right of the
 *     GLASS at margin 12 and the HOME readout the top-right of the CONTENT BOX at
 *     `HUD_PAD` 16; a0-103 asserted each reached its own corner and nobody asked
 *     whether they reached the same one. The HOME column now steps left by exactly
 *     the intrusion while the button is up — `src/ui/hud-geometry.ts`
 *     `glassCornerReserve`, declared as a row in `src/ui/anchor-reach.ts`
 *     `LAYOUT_RESERVATIONS`.
 *  2. **`net-ping` over `alarm-arrow`** and
 *  3. **`build-badge` over `alarm-arrow`** — 21 and 22 frames. **FIXED (a0-125).**
 *  4. **`alarm-arrow` over `controls-strip`** — 440 of 1,440 alarm frames, desktop
 *     and both ultrawides. **FIXED (a0-125).** All three are one rule and were
 *     answered once: the arrow home gives up radius — never bearing — to clear
 *     every FIXED rect on the glass, in either direction, and may overlap only
 *     WORLD surfaces (`src/ui/layout-exclusions.ts` `ARROW_KEEPOUT_IDS`).
 *  5. **`build-wheel` over `alarm-arrow`** — 38 frames, phone only, "wheel open
 *     under alarm". **WITHDRAWN (a0-128): the frame does not exist.** a0-125
 *     measured the deepest overlap at 3.3 px and argued carefully about the one
 *     pixel of band between the wave clock's compact row and the wheel's
 *     footprint. a0-127 went to photograph that and could not:
 *
 *     > *"THE VERDICT IS ABOUT THE PIN, NOT ABOUT THE SCREEN: nothing in these
 *     > two frames is drawn wrongly. […] This camera went to reproduce that on the
 *     > running build and COULD NOT, because the two elements have mutually
 *     > exclusive conditions."*
 *
 *     The wheel is open only while the ship is inside `STATION.dockRange` (160 u)
 *     of its own station — `canOpenWheel` on the sim's `isDocked`. The arrow home
 *     is drawn only while that station is NOT already on screen, which on the
 *     phone profile a0-127 shot means more than `384/2 − ARROW_EDGE_INSET` = 164 u
 *     away. 160 < 164, so the disc that opens the wheel lies strictly inside the
 *     rect that hides the arrow, and no ship position satisfies both. The pin
 *     described a frame nobody can reach, and the sweep produced it because
 *     `wheelOpen` and `alarm` were independent booleans in `./layout-frames`.
 *
 *     It is **not** replaced by an exclusion row. `./layout-reachable` derives
 *     both conditions from the one home offset, so the census can no longer spell
 *     the frame; `every swept frame is a frame the game can draw`, below, proves
 *     the inequality against the shipped constants over the whole docked disc.
 *
 * **An empty list is the honest state of this table, not a placeholder.** Five
 * findings went in, four were fixed in `src/` and one was withdrawn as
 * unreachable, and nothing has breached since. The assertion below still points
 * the other way on purpose — the day a line is added it fails when the fix lands.
 */
const KNOWN_COVERS: readonly string[] = [];

/** The cell a finding is pinned under — the base state (variant suffix dropped,
 *  so 360 bearings pin as one line), the viewport, and the ordered pair. */
const cell = (frame: Frame, over: string, under: string): string =>
  `${baseState(frame.state)} | ${frame.viewport} | ${over} | ${under}`;

describe('a0-122 — the layout overlap sweep', () => {
  let frames: StagedFrame[] = [];
  /** Every cover, keyed by its pinnable cell, with one printable line each. */
  let breaches = new Map<string, { line: string; frames: number }>();
  /** Every nine-point probe finding, keyed the same way. */
  let probes = new Map<string, { line: string; frames: number }>();

  beforeAll(() => {
    frames = sweepFrames();
    breaches = new Map();
    probes = new Map();
    for (const frame of frames) {
      for (const c of coversInFrame(frame)) {
        const key = cell(frame, c.coverer.id, c.victim.id);
        const seen = breaches.get(key);
        if (seen) seen.frames++;
        else breaches.set(key, { line: coverLine(c as Cover), frames: 1 });
      }
      for (const f of foreignTopmost(frame)) {
        for (const point of f.points) {
          const key = cell(frame, point.answered, f.control.id);
          const seen = probes.get(key);
          if (seen) seen.frames++;
          else {
            probes.set(key, {
              line:
                `${key} — ${f.control.id}'s own ${point.name} answers ${point.answered} ` +
                `(${f.control.role}: ${f.control.note})`,
              frames: 1,
            });
          }
        }
      }
    }
  }, 120_000);

  it('nothing a player must read is covered by anything else', () => {
    // THE assertion this brief exists for, and the whole property in one list:
    // every state, every viewport, every element against every other one, with
    // the intent encoded — a ground cannot be a victim, and a keep-out that is
    // deliberate is a declared row with its reason attached.
    const fresh = [...breaches.entries()]
      .filter(([key]) => !KNOWN_COVERS.includes(key))
      .map(([, v]) => `${v.line}  [${v.frames} frame(s)]`)
      .sort();
    expect(fresh).toEqual([]);
  });

  it('a control’s own coordinates answer the control, not something over it', () => {
    // a0-114's method, headless: nine points off the box the CLIENT reported —
    // centre, four edge midpoints, four corners — and a cover is anything
    // FOREIGN, never a list of ids on the cover side. a0-98 asked one point per
    // control and scored a button taking the top third of the HOST plate "clear";
    // it also asked "is the topmost element the corner affordance, by id", so the
    // refusal panel's own second DOWNLOAD LOG went into the readback truthfully
    // and was then scored false. Both of those are fixed by asking this way.
    //
    // Pinned against the same list: a cover found by the rect rule is the same
    // defect found by the probe, and one line retires both.
    const fresh = [...probes.entries()]
      .filter(([key]) => !KNOWN_COVERS.includes(key))
      .map(([, v]) => `${v.line}  [${v.frames} frame(s)]`)
      .sort();
    expect(fresh).toEqual([]);
  });

  it('every pinned overlap still reproduces where the report says it does', () => {
    // The pin, pointing the other way on purpose: this fails on the day a ui
    // brief lands a fix, and the failure means "delete these lines". None of the
    // five can be quietly forgotten, and none of them can be quietly re-broken.
    const seen = new Set(breaches.keys());
    const healed = KNOWN_COVERS.filter((k) => !seen.has(k));
    expect(
      healed,
      'these no longer reproduce — if the fix has landed, remove them from KNOWN_COVERS ' +
        'and strike the row from tests/reports/a0-122-overlaps.md',
    ).toEqual([]);
  });

  it('the sweep would have caught all six of the defects it was built for', () => {
    // The assertion that makes a green run mean something. Each of the six is
    // re-staged through the SAME builders with only the shipped rule that fixed
    // it switched off, and the sweep has to name the pair. If a builder ever
    // stops painting an element — the way to make any sweep green — these go
    // quiet and this fails on the silence rather than on a rect.
    const missed: string[] = [];
    for (const control of CONTROLS) {
      for (const p of VIEWPORTS) {
        const frame: Frame = {
          state: control.brief,
          viewport: p.id,
          painted: layer(control.frame(p)),
        };
        const found = coversInFrame(frame);
        for (const want of control.expect) {
          if (!want.on.includes(p.id)) continue;
          const hit = found.some((c) => c.coverer.id === want.over && c.victim.id === want.under);
          if (!hit) {
            missed.push(
              `${control.brief} @ ${p.id}: expected ${want.over} over ${want.under} with ` +
                `${control.bypassed} bypassed — the sweep did not find it. ${control.what}`,
            );
          }
        }
      }
    }
    expect(missed).toEqual([]);
  });

  it('…and all six are clean in the shipped build', () => {
    // The other half of the same claim, and the most important line in the report
    // if it ever fails: the six pairs the negative controls above reproduce must
    // not appear anywhere in the real sweep.
    const shipped = new Set<string>();
    for (const [key] of breaches) shipped.add(key.split(' | ').slice(2).join(' | '));
    const returned: string[] = [];
    for (const control of CONTROLS) {
      for (const want of control.expect) {
        const pair = `${want.over} | ${want.under}`;
        if (shipped.has(pair)) returned.push(`${control.brief} is back: ${pair} — ${control.what}`);
      }
    }
    expect(returned).toEqual([]);
  });

  it('the cross-product is the full one — every state, at every viewport', () => {
    // The gate the DoD names runs the whole thing; this is what says so, so that
    // a future edit which quietly drops a state or a screen shape fails here
    // rather than passing more easily.
    const swept = new Set(frames.map((f) => `${baseState(f.state)}|${f.viewport}`));
    const missing: string[] = [];
    for (const s of STATES) {
      for (const p of VIEWPORTS) {
        if (!swept.has(`${s.id}|${p.id}`)) missing.push(`${s.id} was never swept at ${p.id}`);
      }
    }
    expect(missing).toEqual([]);
    expect(new Set(frames.map((f) => baseState(f.state))).size).toBe(STATES.length);
    expect(new Set(frames.map((f) => f.viewport)).size).toBe(VIEWPORTS.length);
    // Every frame has something on it. A state whose builder silently returned
    // nothing would satisfy every assertion above.
    expect(frames.filter((f) => f.painted.length === 0).map((f) => f.state)).toEqual([]);
  });

  it('every swept frame is a frame the game can draw', () => {
    // a0-128. The assertion that keeps this instrument from inventing its own
    // findings — and it is the one the instrument had already failed. D5 measured
    // the build wheel's halo over the arrow home to 3.3 px on a frame the running
    // build cannot produce, because the cross-product treated `wheelOpen` and
    // `alarm` as independent booleans and the game does not.
    //
    // Three claims, in the order they matter.

    // ── 1. Every frame agrees with what its own stage would draw ─────────────
    //
    // Every swept frame carries the world it was staged from
    // (`./layout-reachable` `Stage`), and `unreachable` re-asks the shipped
    // predicates — `canOpenWheel` on the sim's `isDocked`, `homeArrow`'s
    // `onScreen`, `pauseAllowsDownloadLog` — what belongs on that screen. Both
    // directions: an element the game would not draw is a finding nobody can act
    // on, and an element the game WOULD draw and the census left out reads
    // exactly like an element that passed.
    const impossible: string[] = [];
    for (const frame of frames) {
      const p = VIEWPORTS.find((v) => v.id === frame.viewport);
      expect(p, `${frame.viewport} is not a swept viewport`).toBeDefined();
      impossible.push(...unreachable(frame, (p as (typeof VIEWPORTS)[number]).vp));
    }
    expect(impossible).toEqual([]);

    // ── 2. The wheel and the arrow are mutually exclusive, and it is arithmetic ─
    //
    // The non-tautological half. The census and the check above both call the
    // same two helpers, so on their own they would only prove the helpers agree
    // with themselves. This proves the property over the WHOLE input space
    // instead of at the points a sweep happens to sample, and it proves it out of
    // `src/`'s own two numbers:
    //
    //   the wheel opens within  STATION.dockRange
    //   the arrow hides within  min(width, height) / 2 - ARROW_EDGE_INSET
    //
    // The docked disc lies strictly inside the on-screen rect on every viewport,
    // so "wheel open" implies "home on screen" implies "no arrow" — and that is
    // the whole of a0-127's `mutually exclusive`, as an inequality rather than as
    // a row in a table somebody has to remember to delete.
    const tooTight = VIEWPORTS.filter(
      (v) => STATION.dockRange >= Math.min(v.vp.width, v.vp.height) / 2 - ARROW_EDGE_INSET,
    ).map(
      (v) =>
        `${v.id}: dockRange ${STATION.dockRange} reaches the inset rect ` +
        `(${Math.min(v.vp.width, v.vp.height) / 2 - ARROW_EDGE_INSET}) — the wheel and the arrow ` +
        'can now be on screen together, so this sweep needs a state for it',
    );
    expect(tooTight).toEqual([]);

    // …and the same claim by exhaustion, over the docked disc rather than over
    // one bearing per frame: 720 bearings x 41 radii out to `dockRange`, on all
    // four viewports, with BUILD held and the alarm up — the most favourable
    // situation for the pair there is.
    const together: string[] = [];
    let wheelsInside = 0;
    for (const v of VIEWPORTS) {
      for (let b = 0; b < 720; b++) {
        const bearing = (b * Math.PI) / 360;
        for (let step = 0; step <= 40; step++) {
          const r = (STATION.dockRange * step) / 40;
          const sit = situation({
            alarmFiring: true,
            buildRequested: true,
            home: { dx: Math.cos(bearing) * r, dy: Math.sin(bearing) * r },
          });
          const wheel = wheelIsOpen(sit);
          if (wheel && step < 40) wheelsInside++;
          if (wheel && arrowIsDrawn(sit, v.vp)) {
            together.push(`${v.id}: wheel and arrow at bearing ${b / 2}°, ${r.toFixed(1)} u out`);
          }
        }
      }
    }
    expect(together).toEqual([]);
    // …and the sweep above is not vacuous: the wheel really did open on it, and
    // the arrow really is drawable — just never on the same frame. Without these
    // two, a `canOpenWheel` that returned false for everything would pass.
    //
    // Counted strictly INSIDE the rim. The last ring is at exactly
    // `STATION.dockRange` and `isDocked` compares squared distances with `<=`, so
    // `(cos b · r)² + (sin b · r)²` lands an ulp over `r²` on 145 of the 720
    // bearings and the wheel shuts. That is a property of binary floating point
    // on the boundary, not of the game — and it cuts the safe way, since a rim
    // sample that does not open the wheel is one this check simply does not
    // count. The rim stays in the `together` sweep above, where it is the most
    // favourable position the pair could possibly have.
    expect(wheelsInside).toBe(VIEWPORTS.length * 720 * 40);
    expect(arrowIsDrawn(situation({ alarmFiring: true, home: { dx: 0, dy: -ARROW_STAGED_RANGE } }), VIEWPORTS[0]!.vp)).toBe(true);

    // ── 3. The world the alarm states stand in is a world the arena can make ──
    //
    // The other half of "a frame the game can draw", and the sweep failed this
    // too: it stood home 6000 u from the ship to be certain the arrow clamped to
    // an edge, and the widest shipped arena is 3200x2000. `ARROW_STAGED_RANGE` is
    // bracketed by two derived numbers and this is where the bracket is checked.
    const shortOfTheEdge: string[] = [];
    const beyondTheArena: string[] = [];
    for (let i = 0; i < 360; i++) {
      const bearing = (i * Math.PI) / 180;
      const home = { dx: Math.cos(bearing) * ARROW_STAGED_RANGE, dy: Math.sin(bearing) * ARROW_STAGED_RANGE };
      for (const v of VIEWPORTS) {
        if (!arrowIsDrawn(situation({ alarmFiring: true, home }), v.vp)) {
          shortOfTheEdge.push(`${v.id} @ ${i}°: home is still on screen at ${ARROW_STAGED_RANGE} u`);
        }
      }
      const reach = arenaReach(home.dx, home.dy);
      if (ARROW_STAGED_RANGE > reach) {
        beyondTheArena.push(
          `${i}°: staged at ${ARROW_STAGED_RANGE} u, and no shipped map can put home further ` +
            `than ${reach.toFixed(1)} u in that direction`,
        );
      }
    }
    expect(shortOfTheEdge).toEqual([]);
    expect(beyondTheArena).toEqual([]);
  });

  it('every declared exception is one this sweep actually needs', () => {
    // The way a table of permissions rots is by accumulating rows for pairs
    // nobody sweeps: each one reads as "we thought about this" and none of them
    // can be told from a mistake. So a row that excuses nothing is deleted, and
    // this is what says which. Measured by running the rule with NO rules and
    // seeing which pairs a row would have caught.
    const needed = new Set<string>();
    for (const frame of frames) {
      for (const c of coversInFrame(frame, [])) needed.add(`${c.coverer.id}|${c.victim.id}`);
    }
    const dead = LAYOUT_ALLOWANCES.filter((r) => !needed.has(`${r.over}|${r.under}`)).map(
      (r) => `${r.over} over ${r.under} — excuses nothing in this sweep; delete the row or add the state`,
    );
    expect(dead).toEqual([]);
  });
});
