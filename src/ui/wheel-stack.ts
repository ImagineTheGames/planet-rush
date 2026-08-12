/**
 * src/ui/wheel-stack.ts — what a wedge SAYS, and where. OWNER: UI.
 *
 * The Gantry/Bone build wheel (u7-02, `docs/design/gantry-bone-handoff.html`
 * screen 5a) draws a wedge as a stack of lines hanging from just inside the rim:
 *
 *     TURRET            ← the name, Audiowide
 *     YOUR STATION      ← what it spends on
 *     3                 ← the cost; yellow if payable, red if not (a0-03)
 *     2 / 4 BUILT       ← the count over its cap
 *
 * Since u7-06 the **upgrade** wheel's wedges are built here too, in the same
 * four slots, because they are the same control and the brief for that screen is
 * explicit that it must not re-solve what this one already answered:
 *
 *     ENGINE            ← the name, Audiowide
 *     111% → 123%       ← the stat this tier moves (GDD §2.5)
 *     12/8              ← cost over spendable ore
 *     ●●○               ← where this track sits on its ladder
 *
 * The *drawing* of both is `./build-wheel-view`, which needs PixiJS. The
 * *decisions* — which line carries what, and which copy a given wheel radius can
 * afford — are here, pure and PixiJS-free, for one reason: the wedge is a fixed
 * radial space and its copy is not, so "does the longest value still fit at the
 * narrowest profile?" has to be a test rather than a look. l2-02 shipped copy
 * that overflowed its chrome, and only the phone profiles caught it.
 *
 * ── WHY REPAIR'S STACK IS SHORTER, AND WHY THAT IS NOT AN EXCEPTION ─────────
 * Four of the five wedges read NAME / TARGET / COST / COUNT. REPAIR REACTOR
 * reads NAME / EFFECT / COST — it has no cap to count (it is rationed by a
 * cooldown, GDD §2.5) and it does not spend a line naming its target, because
 * **its own name already does**: the label is "REPAIR REACTOR", never "REPAIR",
 * precisely so that the one thing it repairs is said in the one place a player
 * always reads (`./build-wheel` SEGMENT_COPY). Its effect/reason line therefore
 * takes the wide second slot instead of the narrow fourth one, which is what lets
 * the live "REPAIR in 15s" countdown fit a 72° wedge on a 390 px phone at all.
 *
 * That is a layout consequence of a rule this file did not invent, not a wedge
 * quietly dropping a contract line.
 */

import type { WheelProfile } from '../art/materials';
import { DISPLAY_TRACKING, TRACKING } from '../art/materials';
import type { AnnularSector } from './hud-geometry';
import { sectorOverflow } from './hud-geometry';
import type { Box, MetricFace, TypeSpec } from './font-metrics';
import { textHeight, textWidth } from './font-metrics';
import type { SegmentState, WheelSegment } from './build-wheel';
import { SELECTION_NAME_SCALE } from './wheel-selection';
import { tierPips } from './upgrade-wheel';
import type { UpgradeSummaryPip, UpgradeWedge } from './upgrade-wheel';

// ---------------------------------------------------------------------------
// The lines
// ---------------------------------------------------------------------------

/** Which face a line is set in. Audiowide is the display face and is used for
 *  the wedge's name and nothing else; everything else is Oxanium (style-guide
 *  §7: "never set HUD numerals in Audiowide"). */
export type WedgeFace = 'display' | 'numeral';

/** One line of a wedge's stack, resolved for one wheel profile. */
export interface WedgeLine {
  /** Which slot this is, so a test can name what overflowed. */
  readonly slot: 'name' | 'sub' | 'cost' | 'detail';
  /** The words, with `\n` where the line wraps. */
  readonly text: string;
  readonly face: WedgeFace;
  readonly size: number;
  /** Tracking in `em` — the ratified scale (`../art/materials` TRACKING). */
  readonly tracking: number;
  /** Leading multiple, so a wrapped name's height is predictable headless. */
  readonly lead: number;
  /** Space below this line before the next, px. */
  readonly gap: number;
}

/** Line height multiples, matching the handoff's `line-height` on each slot. */
export const WEDGE_LEAD = { name: 1.25, body: 1.35 } as const;

/**
 * The words a Build-wheel segment shows, in order, for a given wheel profile.
 * Empty lines are omitted entirely rather than drawn blank, so the stack of a
 * three-line wedge is genuinely three lines tall.
 *
 * `selected` is the design's `sel === i` (screen 5a, u16-01): the wedge the
 * player is pointing at draws its NAME larger — {@link SELECTION_NAME_SCALE}, the
 * design's 19 px from 17 px as a ratio — and nothing else about the stack moves.
 * The size step is made HERE, in the module the fit budget measures, rather than
 * scaled in the view, because a wedge does not get wider when its name does and
 * the 390 px phone is where that stops being obvious (`hud-geometry.test.ts`
 * holds the enlarged name to the same arc at every profile).
 */
export function buildWedgeLines(
  seg: WheelSegment,
  m: WheelProfile,
  selected = false,
): readonly WedgeLine[] {
  const lines: WedgeLine[] = [
    {
      slot: 'name',
      text: wrapWedgeName(seg.label),
      face: 'display',
      size: selected ? m.name * SELECTION_NAME_SCALE : m.name,
      tracking: DISPLAY_TRACKING.heading,
      lead: WEDGE_LEAD.name,
      gap: m.gapName,
    },
  ];

  // Line 2 — the wedge's own second line: repair's effect/reason (p5-08), or what
  // this segment spends on ("every label names which", GDD §2.5).
  const second = seg.repair ? seg.repair.line : targetWords(seg);
  if (second.length > 0) {
    lines.push({
      slot: 'sub',
      text: second,
      face: 'numeral',
      size: m.sub,
      tracking: TRACKING.label,
      lead: WEDGE_LEAD.body,
      gap: m.gapSub,
    });
  }

  // Line 3 — the cost, `FULL`, or the words that say this one opens a screen.
  const cost = costWords(seg);
  if (cost !== null) {
    lines.push({
      slot: 'cost',
      text: cost,
      face: 'numeral',
      size: m.cost,
      tracking: TRACKING.name,
      lead: WEDGE_LEAD.body,
      gap: m.gapCost,
    });
  }

  // Line 4 — the count over its cap, on every capped segment (u7-02).
  const caps = capWords(seg, m);
  if (caps !== null) {
    lines.push({
      slot: 'detail',
      text: caps,
      face: 'numeral',
      size: m.detail,
      tracking: TRACKING.label,
      lead: WEDGE_LEAD.body,
      gap: 0,
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// The upgrade wheel's wedges (u7-06) — the same four slots, filled differently
// ---------------------------------------------------------------------------
//
// The upgrade wheel is the same radial control and the same wedge geometry, so
// it takes the same stack rather than a parallel one. What differs is only what
// each slot carries, and that is the whole of the difference:
//
//   slot     build wheel            upgrade wheel
//   ------   --------------------   -------------------------------------------
//   name     TURRET                 ENGINE                (Audiowide, wraps)
//   sub      YOUR STATION           111% → 123%           (the stat — GDD §2.5)
//   cost     3/4  ·  FULL  ·  OPEN ▸   12/8  ·  MAX  ·  OPEN ▸
//   detail   2 / 4 BUILT            ●●○                   (position on a ladder)
//
// One consequence worth stating out loud, because it is the sharpest constraint
// on this screen: the upgrade wheel has FOUR wedges where the build wheel has
// five, so a wedge is a 90° slice rather than a 72° one and its words sit on a
// wider arc. That is why the stat line — the densest text on any wheel in the
// game — fits the phone profile at full copy where the build wheel's target line
// had to go compact. It is a fact about today's ladder, not a law: the ladder is
// data (p2-03 adds projectile tracks), so `hud-geometry.test.ts` holds this
// stack to the fit budget at a GROWN ladder too, where the compact form is what
// keeps it inside the arc.

/**
 * The words an upgrade wedge shows, in order, for a given wheel profile — the
 * upgrade wheel's {@link buildWedgeLines}.
 *
 * The WEAPON wedge is the one that fills the slots differently: its stat line is
 * a pip row per weapon track ({@link pipRows} — the at-a-glance summary ratified
 * in v0.2.2), it quotes {@link OPENS_SCREEN} where the others quote a price
 * because it opens a screen rather than spending, and it has no ladder of its own
 * to pip.
 */
export function upgradeWedgeLines(wedge: UpgradeWedge, m: WheelProfile): readonly WedgeLine[] {
  const lines: WedgeLine[] = [
    {
      slot: 'name',
      text: wrapWedgeName(wedge.label),
      face: 'display',
      size: m.name,
      tracking: DISPLAY_TRACKING.heading,
      lead: WEDGE_LEAD.name,
      gap: m.gapName,
    },
  ];

  // Line 2 — the stat this tier moves, or the WEAPON wedge's pip rows.
  const sub = wedge.kind === 'weapon' ? pipRows(wedge.summary ?? []) : statWords(wedge, m);
  if (sub.length > 0) {
    lines.push({
      slot: 'sub',
      text: sub,
      face: 'numeral',
      size: m.sub,
      tracking: TRACKING.label,
      lead: WEDGE_LEAD.body,
      gap: m.gapSub,
    });
  }

  // Line 3 — `cost/held`, `MAX`, or the words that say this one opens a screen.
  const cost = upgradeCostWords(wedge);
  if (cost !== null) {
    lines.push({
      slot: 'cost',
      text: cost,
      face: 'numeral',
      size: m.cost,
      tracking: TRACKING.name,
      lead: WEDGE_LEAD.body,
      gap: m.gapCost,
    });
  }

  // Line 4 — where this track sits on its ladder, in pips (u7-06).
  if (wedge.tierLabel.length > 0) {
    lines.push({
      slot: 'detail',
      text: wedge.tierLabel,
      face: 'numeral',
      size: m.detail,
      tracking: TRACKING.label,
      lead: WEDGE_LEAD.body,
      gap: 0,
    });
  }

  return lines;
}

/** The stat line for this profile — the padded form where there is room for it,
 *  the compact one where there is not. The same `capWords` split, on the line
 *  that actually carries the ship stats. */
export function statWords(wedge: UpgradeWedge, m: WheelProfile): string {
  return m.copy === 'compact' ? wedge.statLabelCompact : wedge.statLabel;
}

/** What the upgrade wedge's cost slot draws: `cost/held`, `MAX`, or the words
 *  that say this wedge opens a screen (the WEAPON wedge — the same `OPEN ▸` the
 *  Build wheel's UPGRADE SHIP carries, in the same slot, so the one affordance
 *  that means "there is another screen behind this" looks identical on both). */
export function upgradeCostWords(wedge: UpgradeWedge): string | null {
  if (wedge.kind === 'weapon') return OPENS_SCREEN;
  return wedge.costLabel;
}

/** A weapon track's tiers as one pip row — `DAMAGE ●●○`. The glyphs themselves
 *  come from {@link tierPips}, the same function every track wedge's own ladder
 *  row uses, so the two places pips are drawn cannot draw them differently. */
export function pipRow(pip: UpgradeSummaryPip): string {
  return `${pip.label} ${tierPips(pip.tier, pip.maxTier)}`;
}

/** The WEAPON wedge's stat line: one {@link pipRow} per weapon track. */
export function pipRows(pips: readonly UpgradeSummaryPip[]): string {
  return pips.map(pipRow).join('\n');
}

/** The upgrade wheel's cost paint. `ready` is ore; a tier the player cannot pay
 *  for is refused-red, the same carve-out as the Build wheel's; a maxed row is
 *  steel — deliberately not red, because "you are poor" is the one thing that is
 *  *not* wrong with pressing a finished track. The WEAPON wedge quotes no price
 *  at all, so its `OPEN ▸` is chalk, exactly like UPGRADE SHIP's. */
export function upgradeCostPaint(wedge: UpgradeWedge): CostPaint {
  if (wedge.kind === 'weapon') return 'none';
  if (wedge.state === 'ready') return 'ore';
  return wedge.state === 'unaffordable' ? 'refused' : 'spent';
}

/** What a segment spends on, in words — the design's `YOUR PLANET` / `YOUR SHIP`
 *  in this build's vocabulary. `''` on REPAIR REACTOR, whose own name says it. */
export function targetWords(seg: WheelSegment): string {
  if (seg.repair) return '';
  return seg.target === 'ship' ? 'YOUR SHIP' : 'YOUR STATION';
}

/** The count/cap line for this profile — the padded form where there is room for
 *  it, the compact one where there is not. `null` on an uncapped segment. */
export function capWords(seg: WheelSegment, m: WheelProfile): string | null {
  return m.copy === 'compact' ? seg.capLabelCompact : seg.capLabel;
}

/** The words the one screen-opening wedge carries instead of a price (the
 *  handoff's own copy). UPGRADE SHIP keeps its arrow rather than a number. */
export const OPENS_SCREEN = 'OPEN ▸';

/** What the cost slot draws: the bare cost, `FULL`, `OPEN ▸`, or nothing. The
 *  cost is one numeral since a0-03 — whether it can be paid is the numeral's
 *  COLOUR ({@link costPaintFor}), never a second number. */
export function costWords(seg: WheelSegment): string | null {
  if (seg.opensPanel) return OPENS_SCREEN;
  return seg.costLabel;
}

/**
 * A multi-word wedge name, wrapped the way the handoff wraps it — `REPAIR CORE`
 * and `UPGRADE SHIP` are drawn on two lines there, `TURRET` and `SHIELD` on one.
 * Deterministic (split on the first space) rather than measured, so the wrap is
 * the same on every device and in every golden.
 */
export function wrapWedgeName(label: string): string {
  const space = label.indexOf(' ');
  return space < 0 ? label : `${label.slice(0, space)}\n${label.slice(space + 1)}`;
}

// ---------------------------------------------------------------------------
// Where the lines land
// ---------------------------------------------------------------------------

/** One placed line: its nominal height and the radius its centre sits at. */
export interface PlacedLine extends WedgeLine {
  readonly height: number;
  /** Distance from the wheel's centre to this line's own centre, px. */
  readonly radius: number;
}

/**
 * Stack a wedge's lines from just inside the rim, inward — the view's own
 * placement, in nominal metrics.
 *
 * Anchoring at the rim rather than centring in the ring is the whole trick that
 * makes a four-line stack fit a 72° wedge on a phone: a radial menu is widest at
 * its rim, so the lines start where there is room and the *shortest* line (the
 * cost, or the compact count) ends up where the wedge is narrowest.
 *
 * The view measures real font metrics rather than these multiples, so this is a
 * conservative model, not a mirror — which is the right relationship for a
 * budget: it is allowed to be pessimistic, never optimistic.
 */
export function placeWedgeLines(
  lines: readonly WedgeLine[],
  outerRadius: number,
  m: WheelProfile,
): { placed: readonly PlacedLine[]; innerRadius: number } {
  const top = outerRadius - m.labelInset * outerRadius;
  const placed: PlacedLine[] = [];
  let y = 0;
  for (const line of lines) {
    const height = line.size * line.lead * lineCount(line.text);
    placed.push({ ...line, height, radius: top - y - height / 2 });
    y += height + line.gap;
  }
  return { placed, innerRadius: top - y };
}

function lineCount(text: string): number {
  let n = 1;
  for (const ch of text) if (ch === '\n') n++;
  return n;
}

// ---------------------------------------------------------------------------
// …and where they land in TWO dimensions (a0-32)
// ---------------------------------------------------------------------------
//
// {@link placeWedgeLines} gives each line a radius, and a radius is enough to ask
// "how wide is the wedge here". It is not enough to ask "does this word fit",
// because the words are not rotated with the wedge: the view puts the whole stack
// at one point on the wheel and then stacks the lines DOWNWARD in screen space,
// upright, whichever wedge they belong to. On the wedge at twelve o'clock those
// two models agree. On the wedge at nine o'clock they do not agree at all — the
// line runs along the radius there, and what stops it is the rim.
//
// So this is the second model, and it is a mirror rather than an approximation:
// the same arithmetic the view does, over the real font metrics
// ({@link ../ui/font-metrics}) rather than a leading multiple, producing the box
// each line actually occupies in wheel-centre coordinates. `hud-geometry.ts`
// `sectorOverflow` is what then asks whether that box is inside its wedge.

/** Which {@link MetricFace} a wedge line is drawn in — the view's own two calls
 *  (`build-wheel-view` `wedgeNodes`): the name in Audiowide at its default
 *  weight, everything else in Oxanium at 700. */
export function wedgeMetricFace(face: WedgeFace): MetricFace {
  return face === 'display' ? 'heading' : 'bodyBold';
}

/** The type spec a wedge line is measured with. */
export function wedgeTypeSpec(line: WedgeLine): TypeSpec {
  return { face: wedgeMetricFace(line.face), size: line.size, tracking: line.tracking };
}

/** One line of a wedge, as the box it occupies relative to the wheel's centre. */
export interface WedgeLineBox extends Box {
  readonly slot: WedgeLine['slot'];
  readonly text: string;
}

/** A whole wedge's stack, placed. */
export interface WedgeStackPlacement {
  readonly boxes: readonly WedgeLineBox[];
  /** Total height of the stack, px — including the trailing gap, exactly as the
   *  view's own running `y` does, because that is what it centres on. */
  readonly stackHeight: number;
  /** The radius the stack's centre hangs at. */
  readonly centreRadius: number;
}

/**
 * Where a wedge's lines actually land, in wheel-centre coordinates.
 *
 * Reproduces `BuildWheelView.drawWedge` exactly, which is the whole value of it:
 * lines are measured with the real font metrics, stacked downward from the top of
 * the cluster with each line's own gap under it, and the cluster is then pivoted
 * about its middle and hung at `angle` from the wheel's centre. Each line is
 * anchored `(0.5, 0)`, so its box is centred on the cluster's x and starts at its
 * own running y.
 *
 * `radiusOverride` replaces the design's rim-anchored `centreRadius` — that is how
 * {@link fittedStackRadius} draws the wedge it has pulled inward.
 */
export function wedgeStackBoxes(
  lines: readonly WedgeLine[],
  outerRadius: number,
  m: WheelProfile,
  angle: number,
  radiusOverride?: number,
): WedgeStackPlacement {
  const heights = lines.map((l) => textHeight(l.text, wedgeTypeSpec(l)));
  const widths = lines.map((l) => textWidth(l.text, wedgeTypeSpec(l)));
  let stackHeight = 0;
  for (let i = 0; i < lines.length; i++) stackHeight += heights[i]! + lines[i]!.gap;

  const top = outerRadius - m.labelInset * outerRadius;
  const centreRadius = radiusOverride ?? top - stackHeight / 2;
  const cx = Math.cos(angle) * centreRadius;
  const cy = Math.sin(angle) * centreRadius;

  const boxes: WedgeLineBox[] = [];
  let y = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    boxes.push({
      slot: line.slot,
      text: line.text,
      x: cx - widths[i]! / 2,
      y: cy + y - stackHeight / 2,
      width: widths[i]!,
      height: heights[i]!,
    });
    y += heights[i]! + line.gap;
  }
  return { boxes, stackHeight, centreRadius };
}

/** The smallest a wedge's name may be scaled to make it fit, as a fraction of
 *  the size its profile asks for.
 *
 *  It is a FLOOR on a mechanism that is inert at every profile in the device
 *  matrix except one — see {@link fitWedgeStack} — and it exists so that "the
 *  words do not fit" cannot silently become "the words are unreadable". A wedge
 *  that would need more than a fifth off its name is a wedge whose copy is wrong,
 *  and `hud-geometry.test.ts` is what says so, in words, naming the string.
 */
export const MIN_NAME_FIT_SCALE = 0.8;

/** How a wedge's word stack was made to fit its wedge. */
export interface WedgeFit {
  /** The radius the stack's centre hangs at — the design's, or nearer the hub. */
  readonly radius: number;
  /**
   * How far IN from the design's rim-anchored radius the stack was pulled, px.
   * Zero on every wedge that already fitted.
   *
   * Reported alongside {@link radius} — and it is what the view actually applies —
   * because the view measures its own stack with PixiJS and this module measures
   * it with `./font-metrics`, and the two agree to about a pixel rather than
   * exactly. Handing the view an absolute radius would move every wedge on the
   * wheel by that pixel, including the ones with nothing wrong with them; handing
   * it a DELTA moves only the wedges this fix is for, and leaves the rest of the
   * ratified wheel byte-identical.
   */
  readonly pullIn: number;
  /** What the NAME's size was multiplied by. `1` at every profile that did not
   *  need it, which is all of them but the phone's selected wedge. */
  readonly nameScale: number;
}

/**
 * Fit a wedge's word stack to the wedge, and say how.
 *
 * ── WHAT MOVES, AND WHY IT IS THESE TWO THINGS (a0-32) ─────────────────────
 * The wheel's geometry is ratified and checked — a0-20's compliance pass,
 * u13-01's hit-test, a0-21's arc, u16-01's 140 ms sweep — and the profile's type
 * sizes are the handoff's. Two things in this picture were never anybody's
 * ratified number, and between them they are enough:
 *
 *  1. **How far down the radius the words hang.** The design anchors the stack
 *     just inside the rim, which is right for the wedge at twelve o'clock and
 *     wrong for the wedge at nine: a line of upright text on a sideways wedge
 *     runs along the RADIUS, so the rim is what it hits. Pulling the stack in
 *     from the rim puts it back inside the disc at full size, in the right words,
 *     on the same wedge. This is the whole of the reported defect.
 *  2. **How much bigger the SELECTED name gets.** u16-01 grows it 19/17, and on a
 *     390 px phone the wedge cannot hold `UPGRADE` at that size at ANY radius:
 *     the resting name fits with 1.5 px to spare and the enlarged one is 8.7 px
 *     wider than the resting one. So the name grows by as much as the wedge can
 *     hold, up to the design's 19/17 — full growth on every desktop and tablet
 *     profile, capped on the phone, and never below {@link MIN_NAME_FIT_SCALE}.
 *
 * Nothing else is touched: not the copy, not the tracking, not the other three
 * lines' sizes, not the wedge, and not the hit-test.
 *
 * ── WHY THE RADIUS IS A BISECTION ─────────────────────────────────────────
 * Pulling a stack inward trades one constraint for two: every corner gets nearer
 * the centre, so the rim stops being the problem, but the hub approaches and the
 * two spokes converge around it as it goes. All three are MONOTONIC in the
 * radius — the rim is satisfied on `[0, rMax]`, the hub and the spokes on
 * `[rMin, ∞)` — so the outermost placement that clears the rim is one bisection,
 * and whether it also clears the other two is a question with a yes/no answer
 * rather than a search. When it is "no", the name comes down a step and the
 * question is asked again.
 */
export function fitWedgeStack(
  lines: readonly WedgeLine[],
  outerRadius: number,
  m: WheelProfile,
  angle: number,
  segments: number,
): WedgeFit {
  const sector: AnnularSector = {
    innerRadius: outerRadius * m.hub,
    outerRadius,
    angle,
    halfArc: Math.PI / segments,
  };

  /** The worst rim overflow, and the worst of everything else, at one radius. */
  const overflowAt = (scaled: readonly WedgeLine[], radius?: number) => {
    const { boxes, centreRadius } = wedgeStackBoxes(scaled, outerRadius, m, angle, radius);
    let outer = 0;
    let inward = 0;
    for (const box of boxes) {
      const o = sectorOverflow(box, sector);
      outer = Math.max(outer, o.outer);
      inward = Math.max(inward, o.inner, o.arc * centreRadius);
    }
    return { outer, inward, centreRadius };
  };

  /** The outermost radius whose stack clears the RIM, and what is left over. */
  const place = (scaled: readonly WedgeLine[]): { radius: number; inward: number } => {
    const design = overflowAt(scaled);
    if (design.outer <= 0) return { radius: design.centreRadius, inward: design.inward };
    let lo = 0;
    let hi = design.centreRadius;
    // 14 halvings of a range bounded by the wheel's own radius settle inside a
    // hundredth of a pixel — far below what a device can draw.
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (overflowAt(scaled, mid).outer <= 0) lo = mid;
      else hi = mid;
    }
    return { radius: lo, inward: overflowAt(scaled, lo).inward };
  };

  const design = wedgeStackBoxes(lines, outerRadius, m, angle).centreRadius;
  const at = place(lines);
  if (at.inward <= 0) return { radius: at.radius, pullIn: design - at.radius, nameScale: 1 };

  // The stack cannot be placed at this name size. Bisect the name down for the
  // largest scale that can be, and stop at the floor rather than at "readable
  // enough" — a name that needs more than that is a copy problem, and the fit
  // test says so by name.
  let lo = MIN_NAME_FIT_SCALE;
  let hi = 1;
  const answer = (radius: number, nameScale: number): WedgeFit => ({
    radius,
    // Measured against the design radius the SCALED stack would hang at, since a
    // shorter name makes a shorter stack and the rim anchor moves with it.
    pullIn: wedgeStackBoxes(scaleName(lines, nameScale), outerRadius, m, angle).centreRadius - radius,
    nameScale,
  });
  let best = answer(place(scaleName(lines, lo)).radius, lo);
  if (place(scaleName(lines, lo)).inward > 0) return best;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const tried = place(scaleName(lines, mid));
    if (tried.inward <= 0) {
      lo = mid;
      best = answer(tried.radius, mid);
    } else {
      hi = mid;
    }
  }
  return best;
}

/** The same lines with the NAME's size scaled — what {@link fitWedgeStack}
 *  hands back as {@link WedgeFit.nameScale}, and what the view applies. */
export function scaleName(lines: readonly WedgeLine[], scale: number): readonly WedgeLine[] {
  if (scale === 1) return lines;
  return lines.map((l) => (l.slot === 'name' ? { ...l, size: l.size * scale } : l));
}

// ---------------------------------------------------------------------------
// The cost numeral's paint — style-guide §2's carve-out, in both colours
// ---------------------------------------------------------------------------

/**
 * How a cost numeral is painted. This is the one place on the wheel where a
 * RESERVED colour is spent, which is why style-guide §2 carries a dated carve-out
 * for it (amended 2026-08-06, u7-02).
 *
 *  - `ore` — signal yellow. The cost is payable: this is ore, and yellow means
 *    ore. The carve-out that was already written down.
 *  - `refused` — threat red. The cost is **not** payable. Same numerals, same
 *    carve-out, second colour: the design colours an unaffordable cost red so
 *    that no "need 2 more" copy is needed, because the numbers already say it.
 *    Nothing else on the wheel may take it.
 *  - `spent` — steel. There is no price to pay: the segment is capped (`FULL`) or
 *    inert (a full reactor, a cooling one, collapse). Deliberately NOT red — red
 *    there would say "you are poor", which is the one thing that is *not* wrong
 *    with the press.
 *  - `none` — the slot carries no price at all: UPGRADE SHIP's `OPEN ▸`, drawn in
 *    chalk because it is a signpost, not a number.
 */
export type CostPaint = 'ore' | 'refused' | 'spent' | 'none';

/** The cost numeral's paint for a Build-wheel segment state. */
export function costPaintFor(state: SegmentState): CostPaint {
  switch (state) {
    case 'ready':
      return 'ore';
    case 'unaffordable':
      return 'refused';
    case 'capped':
    case 'inactive':
      return 'spent';
  }
}

/** The paint for a Build-wheel segment, including the screen-opening wedge. */
export function segmentCostPaint(seg: WheelSegment): CostPaint {
  return seg.opensPanel ? 'none' : costPaintFor(seg.state);
}
