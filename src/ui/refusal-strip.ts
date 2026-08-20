/**
 * src/ui/refusal-strip.ts — WHERE A REFUSAL'S OWN BUTTONS MAY STAND, on the
 * entry screen. OWNER: UI Engineer (a0-114; a0-97's rule, third generalisation).
 *
 * The surface this module places is `src/net/connect-trace-view` — the RETRY and
 * DOWNLOAD LOG that come up under the title when a CREATE or a JOIN is refused. It
 * is DOM rather than canvas for a good reason (the moments it exists for are the
 * moments the renderer may not be drawing), it is `position:fixed`, and until
 * a0-114 it stood at a CONSTANT `CONNECT_TRACE_TOP_PX` from the top of the page.
 *
 * A constant is a layout decision taken once, against one screen shape, and kept
 * for every other. Both shapes this repo ships were wrong:
 *
 *  - **798x384 phone.** The doors begin at y=141.5 and the buttons end at y≈160,
 *    so DOWNLOAD LOG takes the top of the HOST plate — a0-111's screenshot, in
 *    which only the bottom sliver of the four letters shows. Measured:
 *    `evidence/a0-114-refusal-over-the-doors`, 13% of HOST and 12% of CAMPAIGN
 *    under an opaque button.
 *  - **1280x800 desktop.** The doors are clear there, but the failure LINE is at
 *    y120-164 and the panel's band is y92-160, so the words the player is being
 *    asked to report — `FAILED: no allocator configured` — are behind the button
 *    offering to report them. `elementFromPoint` at the message's own reported
 *    centre answers `BUTTON#pr-connect-trace-download`.
 *
 * ── THE FORK, ANSWERED BY A PRESS ───────────────────────────────────────────
 * a0-114's brief asks which is true: the doors are live behind the refusal, so
 * the refusal must get off them; or they are inert, so the refusal needs a ground
 * of its own and they must stop looking live. The capture answers it on ONE plate,
 * with two real presses:
 *
 *   CAMPAIGN at (393,144), a point the panel covers → `elementFromPoint` says
 *     `BUTTON#pr-connect-trace-download`; the client's whole readable state is
 *     identical before and after; a `planet-rush-log-….json` downloads.
 *   CAMPAIGN at (209,173), a point it does not → `CANVAS#app`; `status` goes
 *     `error` → `idle` and the refusal clears. The door took the press.
 *
 * **The doors are live.** They are live on purpose, and `connect-trace-view`'s own
 * CSS says why: `pointer-events:none` on the panel's container with `auto` on the
 * two buttons, because *"a transparent container that swallowed taps there would
 * take PLAY SOLO — the door that always works (GDD §4.8 risk 6) — down with a
 * failed online join."* The panel already refuses to make the doors inert. What it
 * did not do is get off them, and a0-97's rule is that drawing over a control is
 * the bug whether or not the press is swallowed. Making the buttons transparent is
 * forbidden by that same rule and is not what this does.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * The strip goes **under the message line and above the doors**, which is where
 * `connect-trace-view`'s header always said it belonged — *"right under the line
 * that just told the player what went wrong"* — and the screen's own band yields
 * the room for it. Two consequences, and both are the point:
 *
 *  1. On the desktop the strip lands at the message's real bottom edge rather than
 *     at 92, so it stops standing on the failure.
 *  2. On the phone the doors start below the strip rather than under it, so the
 *     plate a thumb is aimed at is the plate it hits.
 *
 * Pure and total: every input has an answer and the answer is a rect, so the whole
 * rule is asserted in node with no browser (`src/net/playtest-log-button.test.ts`,
 * *a refusal never covers the door that was pressed*).
 */

import type { Rect } from '@platform/layout-registry';

/** A rect that claims no space — the answer when no refusal is up. */
export const NO_STRIP: Rect = { x: 0, y: 0, width: 0, height: 0 };

/**
 * The most of the content band a refusal may take before the screen under it stops
 * being a screen.
 *
 * The surface is measured, not assumed ({@link refusalStrip} takes its height from
 * the DOM), and a measurement can come back absurd: a font that failed to load, a
 * hint that wrapped to six lines, a viewport 200px tall. Half the band is the floor
 * this rule will not go below — past it the strip is clamped and the doors keep
 * what is left, which is a crowded screen rather than no screen at all.
 */
export const REFUSAL_MAX_BAND_SHARE = 0.5;

/** Everything the placement reads. Nothing here is a DOM fact — the caller
 *  measures the surface and converts it into the screen's own logical space. */
export interface RefusalStripInput {
  /** The one line under the wordmark: the prompt, or the failure. */
  readonly message: Rect;
  /** The band the entry screen's content divides, between the two beams. */
  readonly band: Rect;
  /** The frame's gutter — the same one every other stack on this screen uses. */
  readonly gutter: number;
  /** How tall the refusal surface actually measured, in the screen's own logical
   *  px. `0` (or less) is the ordinary case: nothing has failed, and the surface
   *  is not on screen at all. */
  readonly height: number;
}

/**
 * The strip, or {@link NO_STRIP}.
 *
 * Full band width and directly under the message, so the buttons sit on the same
 * axis as the words they are about. The height is the caller's measurement,
 * clamped to {@link REFUSAL_MAX_BAND_SHARE} of the band.
 */
export function refusalStrip(input: RefusalStripInput): Rect {
  const height = Math.min(
    Math.max(0, input.height),
    Math.max(0, input.band.height * REFUSAL_MAX_BAND_SHARE),
  );
  if (height <= 0) return NO_STRIP;
  return {
    x: input.band.x,
    y: input.message.y + input.message.height + input.gutter,
    width: input.band.width,
    height,
  };
}

/**
 * Where the screen's own content resumes below the strip — the y the doors (or the
 * keypad, or the room list) are laid out from.
 *
 * One function rather than arithmetic at the call site because the zero case has to
 * be exactly today's number: a screen with no refusal on it must lay out to the
 * pixel it always did, or every golden of the doors moves for a state that is not
 * on them.
 */
export function contentTopBelow(message: Rect, strip: Rect, gutter: number): number {
  const afterMessage = message.y + message.height + gutter;
  if (strip.height <= 0) return afterMessage;
  return Math.max(afterMessage, strip.y + strip.height + gutter);
}

/** Do two rects share any pixel? The whole of the question this module exists to
 *  answer, and deliberately a RECT test: a0-98 asked it at one point per control
 *  and a cover taking the top third of a plate answered "clear". */
export function overlaps(a: Rect, b: Rect): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false;
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Every rect in `controls` the strip stands on, by name — the assertion the test
 * makes, and the report a capture prints.
 *
 * Named rather than counted because *which* door was covered is the whole of
 * a0-111: the failure message for HOST was drawn over the word HOST.
 */
export function refusalCovers(
  strip: Rect,
  controls: readonly { readonly name: string; readonly rect: Rect }[],
): string[] {
  if (strip.height <= 0) return [];
  return controls.filter((c) => overlaps(strip, c.rect)).map((c) => c.name);
}
