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
 *     the six (./palette `DERIVED`), or a roster identity colour. No seventh hue.
 *  2. **Yellow is reserved.** Signal yellow and its shades appear only on roles
 *     `ore`, `core`, `danger` — the three the style guide names.
 *  3. **Red is reserved.** Threat red and its shades appear only on `danger`:
 *     "never a neutral or friendly accent" (§2).
 *  4. **Identity is trim.** A roster colour appears only on `identity` shapes,
 *     and `identity` never paints itself in a material colour — a hull that took
 *     player colour, or trim that quietly went steel, both break §3.
 */

import {
  ALLOWED_COLORS,
  DERIVED,
  DERIVED_RECIPES,
  IDENTITY_COLORS,
  PALETTE,
  hex,
  type DerivedKey,
} from './palette';
import type { PaintRole, SpriteDef } from './shapes';

/** One broken rule, named precisely enough to fix without opening a renderer. */
export interface Violation {
  readonly sprite: string;
  /** Index into `SpriteDef.shapes`. */
  readonly shapeIndex: number;
  readonly role: PaintRole;
  readonly color: number;
  readonly rule: 'allow-list' | 'reserved-yellow' | 'reserved-red' | 'identity-trim' | 'alpha';
  readonly detail: string;
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

/** The only roles signal yellow may wear (style-guide §2). */
const YELLOW_ROLES: readonly PaintRole[] = ['ore', 'core', 'danger'];

/** Audit one sprite. An empty array is a compliant sprite. */
export function auditSprite(def: SpriteDef): Violation[] {
  const found: Violation[] = [];
  def.shapes.forEach((shape, shapeIndex) => {
    for (const ink of [shape.fill, shape.stroke]) {
      if (!ink) continue;
      const { color } = ink;
      const at = { sprite: def.name, shapeIndex, role: shape.role, color };

      if (!ALLOWED_COLORS.has(color)) {
        found.push({
          ...at,
          rule: 'allow-list',
          detail: `${hex(color)} is not one of the six, a declared shade, or a roster colour (style-guide §1).`,
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
        found.push({
          ...at,
          rule: 'reserved-red',
          detail: `threat red on role '${shape.role}' — red is damage, alarm and enemy fire only (style-guide §2).`,
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
