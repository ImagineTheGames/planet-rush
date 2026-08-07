/**
 * src/ui/wheel-stack.ts — what a build-wheel wedge SAYS, and where. OWNER: UI.
 *
 * The Gantry/Bone build wheel (u7-02, `docs/design/gantry-bone-handoff.html`
 * screen 5a) draws a wedge as a stack of lines hanging from just inside the rim:
 *
 *     TURRET            ← the name, Audiowide
 *     YOUR STATION      ← what it spends on
 *     3/4               ← cost over spendable ore
 *     2 / 4 BUILT       ← the count over its cap
 *
 * The *drawing* of that is `./build-wheel-view`, which needs PixiJS. The
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
import type { SegmentState, WheelSegment } from './build-wheel';

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
 */
export function buildWedgeLines(seg: WheelSegment, m: WheelProfile): readonly WedgeLine[] {
  const lines: WedgeLine[] = [
    {
      slot: 'name',
      text: wrapWedgeName(seg.label),
      face: 'display',
      size: m.name,
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

  // Line 3 — `cost/held`, `FULL`, or the words that say this one opens a screen.
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

/** What the cost slot draws: `cost/held`, `FULL`, `OPEN ▸`, or nothing. */
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
