/**
 * src/art/compliance.ts — the RESERVED rule, mechanised. OWNER: Art & Audio Agent.
 *
 * Style-guide §2 is the rule that carries the most weight in the whole art
 * contract:
 *
 * > **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**
 * > … A player scanning a chaotic screen must be able to trust yellow
 * > completely. Every misuse spends that trust. Treat yellow as a controlled
 * > substance.
 *
 * A rule that valuable cannot be enforced by review, because review is exactly
 * what fails on the tenth sprite at the end of a long session. So it is enforced
 * here, as a walk over the sprite IR (./shapes), and `compliance.test.ts` runs
 * it across the entire catalogue on every commit. Adding a sprite that puts
 * yellow on a thruster flare does not get a comment in a PR — it fails CI.
 *
 * Four rules, all structural:
 *
 *  1. **Allow-list.** Every colour is one of the six, a declared shade of one of
 *     the six (./palette `DERIVED`), a roster identity colour — or a colour the
 *     design's own star-temperature function produces, on the backdrop only
 *     ({@link STAR_TEMPERATURE_COLORS}, a0-45). No seventh hue.
 *  2. **Yellow is reserved.** Signal yellow and its shades appear only on roles
 *     `ore`, `core`, `danger` — the three the style guide names.
 *  3. **Red is reserved.** Threat red and its shades appear only on `danger`:
 *     "never a neutral or friendly accent" (§2).
 *  4. **Identity is trim.** A roster colour appears only on `identity` shapes,
 *     and `identity` never paints itself in a material colour — a hull that took
 *     player colour, or trim that quietly went steel, both break §3.
 *  5. **The sky is a whisper, and never yellow** (a0-07, style-guide §2.2). The
 *     backdrop wash (role `sky`) is the one surface in the game that covers
 *     every pixel of every frame, so what it may carry is bounded by *number*,
 *     not by prose — see {@link SKY_ALPHA_MAX} / {@link SKY_RESERVED_ALPHA_MAX}
 *     below. And the ground colour is backdrop-only: {@link FLOOR} on anything
 *     but `sky` is an entity that painted itself the floor.
 */

import {
  ALLOWED_COLORS,
  DERIVED,
  DERIVED_RECIPES,
  FLOOR,
  IDENTITY_COLORS,
  PALETTE,
  hex,
  type DerivedKey,
} from './palette';
import { STAR_TEMPERATURE_COLORS } from './mockup-reference';
import type { PaintRole, SpriteDef } from './shapes';

/** One broken rule, named precisely enough to fix without opening a renderer. */
export interface Violation {
  readonly sprite: string;
  /** Index into `SpriteDef.shapes`. */
  readonly shapeIndex: number;
  readonly role: PaintRole;
  readonly color: number;
  readonly rule:
    | 'allow-list'
    | 'reserved-yellow'
    | 'reserved-red'
    | 'identity-trim'
    | 'alpha'
    | 'sky-whisper'
    | 'ground-only'
    | 'star-only';
  readonly detail: string;
}

/**
 * **The one place a colour is a function rather than a member of a set** — the
 * design's star field (a0-45; `./mockup-reference` `starColorFor`).
 *
 * A star's colour comes from its temperature, continuously: 78% of the field
 * blue-white and 22% amber, ~80 distinct hexes between them, none of which is one
 * of the six or a declared shade of one. The allow-list therefore has to admit
 * them, and the honest way to do that is to admit **exactly the set the design's
 * own function can produce** — enumerated from that function, not typed out — so
 * the audit stays as strict as it was: a hand-edited star hex is still either a
 * colour the design paints or a violation.
 *
 * It is scoped twice over, because a widening of §1 should be as narrow as it can
 * be made:
 *
 *  - **role `material` only.** These are stars, not sky and not structure.
 *  - **`backdrop/` sprites only.** The star field bakes as `backdrop/stars/…` and
 *    appears composited in `backdrop/tile/…`; nothing else in the game is
 *    entitled to a temperature colour. A hull plate in star amber — which is
 *    within ΔE 20 of `coreHot` — fails as {@link Violation.rule} `star-only`.
 *
 * **This is the tension the a0-45 brief names, and it is not resolved here.**
 * Blue is a player identity colour and §1 says structure never takes one; the
 * blue-white 78% is the design the developer approved and re-approved. Amber is
 * the same question on the warm side, against ore. Both are put to the Director
 * with their numbers in the PR body; what this constant does is make sure the
 * widening they authorise cannot leak past the star field.
 */
function isStarColor(color: number, role: PaintRole, sprite: string): boolean {
  return STAR_TEMPERATURE_COLORS.has(color) && role === 'material' && sprite.startsWith('backdrop/');
}

/** Colours descended from a given palette entry: the entry plus its shades. */
function family(base: keyof typeof PALETTE): ReadonlySet<number> {
  const out = new Set<number>([PALETTE[base]]);
  for (const key of Object.keys(DERIVED_RECIPES) as DerivedKey[]) {
    if (DERIVED_RECIPES[key].base === base) out.add(DERIVED[key]);
  }
  return out;
}

/** Signal yellow and every declared shade of it. */
export const YELLOW_FAMILY: ReadonlySet<number> = family('signalYellow');
/** Threat red and every declared shade of it. */
export const RED_FAMILY: ReadonlySet<number> = family('threatRed');

/** The only roles signal yellow may wear (style-guide §2). Note what is NOT here:
 *  `sky`. The backdrop covers every pixel of every frame, so signal yellow is
 *  barred from it at *any* alpha — the strictest reading of §2 there is. */
const YELLOW_ROLES: readonly PaintRole[] = ['ore', 'core', 'danger'];

/**
 * The ceiling on any {@link FLOOR}-less ink painted on role `sky`
 * *(a0-07: 0.12; **raised to 0.40 by a0-40** — see below)*.
 *
 * The backdrop is the one surface behind every entity in the game at all times,
 * which is exactly why "keep it subtle" cannot be left to taste: a wash that
 * drifts up by 4% of alpha is a wash competing with the fleet on every frame.
 *
 * ## Why it moved, and what it buys
 *
 * **This constant is one of the two the a0-40 brief names as the cause.** It, and
 * `peakLuma`/`overdraw` next door in `./backdrop`, were the only things CI could
 * see about a sky — and every one of them rewards a darker sky. Six developer
 * reports later the backdrop was five times darker than the design it was drawn
 * from, because five briefs in a row optimised toward these numbers and nothing
 * anywhere pulled the other way. The direction of authority is now inverted:
 * `./mockup-reference` is the design, and this ceiling is derived from the sky
 * that ships rather than the sky being trimmed to fit the ceiling.
 *
 * **0.40** is Coalsack's declared peak (0.39) plus a hair. Coalsack is the reason
 * the number had to move at all and the brief says so in as many words —
 * *"Coalsack's `peakLuma` is 1.9, which is the bare ground: the mockup's dust
 * cannot fit under it at any parameters"*. Dust that occludes a star field is
 * opaque where it is thickest; that is what dust **is**, and 12% cannot express
 * it. The design's dust runs α 0.18–0.39.
 *
 * What the raise costs, measured rather than asserted (`backdrop.test.ts`, and
 * the ladder is on `NebulaSpec.peakLuma`):
 *
 * ```
 *   sky            peak Y′ over the ground   overdraw     (was: peak / overdraw)
 *   None                  9.1                 0.000        1.9  / 0.000
 *   Deep Ember           22.3                 3.033        7.6  / 0.416
 *   Patina Drift         32.3                 3.174       14.9  / 0.555
 *   Iron Veil            43.9                 2.459       14.0  / 0.249
 *   Coalsack             46.3                 2.263        1.9  / 0.399
 *   Plasma Reef          59.0                 2.175       17.0  / 0.627
 *   ────────────────────────────────────────────────────
 *   the rock body        77.4    ← the new invariant: no sky reaches it
 *   the ink outline      43.4    ← the OLD invariant, and three skies now pass it
 * ```
 *
 * The old invariant — *no sky is ever brighter than `rockFissure`, the ink every
 * sprite is outlined in* — **does not survive this brief**, and it is worth being
 * blunt about that rather than quietly deleting it. A design whose brightest sky
 * lifts the frame by 10 luma cannot also stay under a 43.4 line. What replaces it
 * is the next surface up: **no sky is ever brighter than the rock body (Y′ 77.4)**,
 * the darkest large *thing* in the world, so the fleet and the field still out-value
 * the void they fly through. `backdrop.test.ts` holds that, and holds each sky's
 * own peak to within 15% so the ladder cannot drift again in either direction.
 */
export const SKY_ALPHA_MAX = 0.4;

/**
 * The much lower ceiling for a RESERVED hue on the sky — the whole of the §2.2
 * carve-out, as a number *(a0-07: 0.06; **raised to 0.10 by a0-40**)*.
 *
 * Threat red is barred everywhere but `danger`, for the reason §2 gives: a
 * player scanning a chaotic screen must be able to trust it. The two warm skies
 * the developer picked (Iron Veil, Deep Ember) are *rust and dying coals* — a
 * hue the palette owns and a value nothing else in the game occupies. They are
 * legal only because the composite is provably not a signal, and that clause is
 * what this number enforces.
 *
 * **0.10** is Iron Veil's declared peak (0.097) plus a hair, and Iron Veil is the
 * sky that makes the case: it is the one sky whose parameters *never drifted*, so
 * the design's rust has been running at α 0.045–0.097 since the beginning and the
 * shipped 0.06 ceiling was silently below its own control. (`a0-39` capped Deep
 * Ember at exactly 0.06 for this reason and recorded that the sky "comes back
 * dimmer" as a result — that was the ceiling shaping the art, one brief before
 * the developer said the art was wrong.)
 *
 * The carve-out's own argument is unchanged and re-measured at the new number:
 * threat red at 0.10 over the ground composites to Y′ **16.5**, against a damage
 * fill at **83.5** and a station's alarm ring brighter still. The rust band peaks
 * at Y′ 43.9 where its blobs stack, which is a fifth of what the thing it shares a
 * hue with reads at, and `backdrop.test.ts` measures the ΔE from every signal on
 * every sky (≥ 40 throughout) so "not a signal" stays a number.
 *
 * Signal yellow gets no such carve-out at any alpha, and a0-40 did not touch
 * that. See `YELLOW_ROLES`.
 */
export const SKY_RESERVED_ALPHA_MAX = 0.1;

/** Audit one sprite. An empty array is a compliant sprite. */
export function auditSprite(def: SpriteDef): Violation[] {
  const found: Violation[] = [];
  def.shapes.forEach((shape, shapeIndex) => {
    for (const ink of [shape.fill, shape.stroke]) {
      if (!ink) continue;
      const { color } = ink;
      const at = { sprite: def.name, shapeIndex, role: shape.role, color };

      const starColor = isStarColor(color, shape.role, def.name);
      if (!ALLOWED_COLORS.has(color) && !starColor) {
        found.push({
          ...at,
          rule: STAR_TEMPERATURE_COLORS.has(color) ? 'star-only' : 'allow-list',
          detail: STAR_TEMPERATURE_COLORS.has(color)
            ? `${hex(color)} is a star temperature colour on role '${shape.role}' of '${def.name}' — the design's star hues are the backdrop's star field's alone (see isStarColor).`
            : `${hex(color)} is not one of the six, a declared shade, or a roster colour (style-guide §1).`,
        });
      }
      if (YELLOW_FAMILY.has(color) && !YELLOW_ROLES.includes(shape.role)) {
        found.push({
          ...at,
          rule: 'reserved-yellow',
          detail: `signal yellow on role '${shape.role}' — yellow means ore or danger, and nothing else (style-guide §2).`,
        });
      }
      if (RED_FAMILY.has(color) && shape.role !== 'danger') {
        // The one carve-out (§2.2): a warm SKY, at a whisper the audit measures.
        const skyWhisper = shape.role === 'sky' && ink.alpha <= SKY_RESERVED_ALPHA_MAX;
        if (!skyWhisper) {
          found.push({
            ...at,
            rule: 'reserved-red',
            detail:
              shape.role === 'sky'
                ? `threat red on the sky at alpha ${ink.alpha} — the §2.2 carve-out stops at ${SKY_RESERVED_ALPHA_MAX}, above which a rust band is a red screen.`
                : `threat red on role '${shape.role}' — red is damage, alarm and enemy fire only (style-guide §2).`,
          });
        }
      }
      if (shape.role === 'sky' && color !== FLOOR && ink.alpha > SKY_ALPHA_MAX) {
        found.push({
          ...at,
          rule: 'sky-whisper',
          detail: `sky ink at alpha ${ink.alpha} — the backdrop is behind every entity on every frame, so it stops at ${SKY_ALPHA_MAX} (style-guide §2.2).`,
        });
      }
      if (color === FLOOR && shape.role !== 'sky') {
        found.push({
          ...at,
          rule: 'ground-only',
          detail: `Floor ${hex(FLOOR)} on role '${shape.role}' — the ground is the backdrop's alone; an entity painted in it is a hole in the world (style-guide §1).`,
        });
      }
      if (IDENTITY_COLORS.has(color) && shape.role !== 'identity') {
        found.push({
          ...at,
          rule: 'identity-trim',
          detail: `roster colour on role '${shape.role}' — player colour lives only on trim (style-guide §3.2).`,
        });
      }
      if (!IDENTITY_COLORS.has(color) && shape.role === 'identity') {
        found.push({
          ...at,
          rule: 'identity-trim',
          detail: `role 'identity' painted ${hex(color)}, which is not a roster colour (style-guide §3.1).`,
        });
      }
      if (!(ink.alpha > 0 && ink.alpha <= 1)) {
        found.push({ ...at, rule: 'alpha', detail: `alpha ${ink.alpha} is outside (0, 1].` });
      }
    }
  });
  return found;
}

/** Audit many sprites at once. */
export function auditAll(defs: readonly SpriteDef[]): Violation[] {
  return defs.flatMap(auditSprite);
}

/** A violation list as a message a human can act on. */
export function formatViolations(violations: readonly Violation[]): string {
  return violations
    .map((v) => `  ${v.sprite} shape#${v.shapeIndex} [${v.rule}] ${v.detail}`)
    .join('\n');
}

/** Throw if any sprite breaks the contract. Used by the test, and by any tool. */
export function assertPaletteCompliance(defs: readonly SpriteDef[]): void {
  const violations = auditAll(defs);
  if (violations.length > 0) {
    throw new Error(
      `${violations.length} palette violation(s) — style-guide.md is a contract:\n${formatViolations(violations)}`,
    );
  }
}
