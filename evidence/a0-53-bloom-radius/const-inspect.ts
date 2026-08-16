/**
 * evidence/a0-53-bloom-radius/const-inspect.ts — **what is the constant, at the
 * moment the frame is drawn?** OWNER: Art Agent.
 *
 * `BLOOM` is not a copy of the design's number, it IS `MOCKUP_STARS.bloom` — the
 * same object, re-exported. A `const` binding cannot be reassigned; the object it
 * points at can still be written to by anything holding a reference, and every
 * test in the suite reads these values in a fresh module graph with no app
 * booted, so a mutation on the boot path would be invisible to all of them.
 *
 * On the dev server this shares one module graph with the running game, so what
 * it publishes is what the game is actually using. Injected into the booted
 * client and into the field probe; the two readings were identical, which is
 * what rules mutation out.
 */
import { BLOOM, SPIKE } from '../../src/art/backdrop';
import { MOCKUP_STARS, haloRadiusOf, starHaloAlpha } from '../../src/art/mockup-reference';
import { HALO_KNEE, HALO_KNEE_AT } from '../../src/art/shapes';

export function inspectConsts(): void {
  (window as unknown as { __a0_53_consts?: unknown }).__a0_53_consts = {
    BLOOM: JSON.parse(JSON.stringify(BLOOM)),
    SPIKE: JSON.parse(JSON.stringify(SPIKE)),
    stars: {
      radius: JSON.parse(JSON.stringify(MOCKUP_STARS.radius)),
      alpha: JSON.parse(JSON.stringify(MOCKUP_STARS.alpha)),
      count: MOCKUP_STARS.count,
      magnitudeExponent: MOCKUP_STARS.magnitudeExponent,
    },
    derived: {
      haloRadiusOfIntensity: haloRadiusOf(BLOOM.intensity),
      starHaloAlpha: starHaloAlpha(),
      HALO_KNEE,
      HALO_KNEE_AT,
    },
  };
}
