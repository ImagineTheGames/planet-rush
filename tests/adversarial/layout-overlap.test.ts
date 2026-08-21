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
 * ── THE FIVE ASSERTIONS ─────────────────────────────────────────────────────
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
 *
 * ── COST ────────────────────────────────────────────────────────────────────
 *
 * 1,896 frames, ~90 ms. Cheap enough to be a standing gate rather than an
 * evidence script somebody remembers to run — which is the whole difference
 * between this and the six hand measurements it replaces.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { CONTROLS, STATES, VIEWPORTS, baseState, sweepFrames } from './layout-frames';
import {
  LAYOUT_ALLOWANCES,
  coverLine,
  coversInFrame,
  foreignTopmost,
  layer,
} from './layout-model';
import type { Cover, Frame } from './layout-model';

/**
 * **The a0-122 findings, pinned — one line left of twenty-four.**
 * `state | viewport | coverer | covered`, one line per cell that breaches today.
 *
 * a0-122 pinned five defects here because QA does not own `src/`. **a0-125 landed
 * four of the five**, and the arithmetic of that is in the list below: it was
 * twenty-four lines and it is one.
 *
 *  1. **`fullscreen-reenter` over `station-hp`** — 462 frames, phone, every match
 *     state. **FIXED (a0-125 D1).** The affordance hugged the top-right of the
 *     GLASS at margin 12 and the HOME readout the top-right of the CONTENT BOX at
 *     `HUD_PAD` 16; a0-103 asserted each reached its own corner and nobody asked
 *     whether they reached the same one. The HOME column now steps left by exactly
 *     the intrusion while the button is up — `src/ui/hud-geometry.ts`
 *     `glassCornerReserve`, declared as a row in `src/ui/anchor-reach.ts`
 *     `LAYOUT_RESERVATIONS` — and the missing word the registry could not say has
 *     one: `LayoutSurface`, with `cornerRivals` as the check nobody had.
 *  2. **`net-ping` over `alarm-arrow`** and
 *  3. **`build-badge` over `alarm-arrow`** — 21 and 22 frames. **FIXED (a0-125).**
 *  4. **`alarm-arrow` over `controls-strip`** — 440 of 1,440 alarm frames, desktop
 *     and both ultrawides. **FIXED (a0-125).** All three are one rule and were
 *     answered once: the arrow home gives up radius — never bearing — to clear
 *     every FIXED rect on the glass, in either direction, and may overlap only
 *     WORLD surfaces. `src/ui/layout-exclusions.ts` `ARROW_KEEPOUT_IDS`, which is
 *     deliberately not `HUD_READOUT_IDS`: that list is what a world LABEL may not
 *     enter, and its "furniture the thumb finds" argument was written about a
 *     nameplate, not about a screen mark on a desktop that has no thumb. The two
 *     stamps are `@render`/`@net` elements the HUD cannot measure, so `main.ts`
 *     hands their rects in on the frame (`HudFrame.hostChrome`).
 *  5. **`build-wheel` over `alarm-arrow`** — 38 frames, phone only, wheel open
 *     under alarm. **KEPT, and the one line below.** a0-125 measured it and found
 *     no position that fixes it:
 *
 *      - The yield that answered 2–4 cannot answer this one. It slides the arrow
 *        INWARD along its own ray, and the wheel is CENTRED: pulling a mark toward
 *        the middle cannot get it out of the middle. Fed the wheel's rect, the
 *        solver walks the arrow through the centre and out the far side, which is
 *        an arrow that lies about the bearing — the one thing a0-116 forbids.
 *      - On **18 of the 38 frames the arrow is not within the wheel's filled halo
 *        at all.** The registered footprint is a square that models a circle
 *        (`wheelFootprint`, 318.5 px on this phone), and at the diagonal bearings
 *        the arrow sits in a corner of that square — 213.9 px from the centre of a
 *        halo whose outermost filled band ends at 159.3. This is limit #4 of the
 *        a0-122 report, "a layout rect is not always an ink box", the same one
 *        `entry-eyebrow` over `entry-title` is carried for.
 *      - On the other 20 the arrow reaches the halo's outer bands, and on **7 of
 *        those it reaches the wheel's drawn disc — by 3.3 px, at its deepest**,
 *        with the arrow's bounding box; the triangle's own ink less than that.
 *        Those 7 are the top-centre bearings on a 384 px-tall phone, where the
 *        wave clock's own rect (a0-116, which the arrow must clear) ends 31.7 px
 *        down and the wheel's footprint begins at 32.75. **There is one pixel of
 *        band between them and the arrow is 23 px tall**: no position on that edge
 *        clears both, and the ruling that the clock wins is a0-116's, already made.
 *
 *     So it is carried as a pin and not as an allowance, on purpose. An allowance
 *     would excuse this pair anywhere in that state, including a future frame where
 *     the arrow lands in the middle of the disc; the pin excuses exactly one cell,
 *     and it fails the day the halo's span or the clock's compact row changes the
 *     geometry that makes it unavoidable — which is when the call should be re-made.
 *
 * The list is subtracted rather than skipped at measurement time, so a cell that
 * is pinned AND breaches for a second, unrelated reason is still only one line to
 * remove once the first is fixed.
 */
const KNOWN_COVERS: readonly string[] = [
  // 5 — the wheel's halo over the arrow home. Kept, measured, argued above.
  'match-alarm-wheel | phone-798x384 | build-wheel | alarm-arrow',
];
/** The cell a finding is pinned under — the base state (variant suffix dropped,
 *  so 360 bearings pin as one line), the viewport, and the ordered pair. */
const cell = (frame: Frame, over: string, under: string): string =>
  `${baseState(frame.state)} | ${frame.viewport} | ${over} | ${under}`;

describe('a0-122 — the layout overlap sweep', () => {
  let frames: Frame[] = [];
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
