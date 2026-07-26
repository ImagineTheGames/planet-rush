/**
 * src/ui/affordability.ts — the one affordability boundary both wheels obey.
 * OWNER: UI Engineer.
 *
 * The Build wheel and the Upgrade wheel each dim a wedge the player cannot pay
 * for, and both must answer the *exact same* question the sim's spend check does
 * (`src/sim/buildings.ts` `spendOre`): can `ore` cover `cost`? The rule the
 * v0.2.2 field report turned on is a **boundary** rule — *bank == cost is
 * affordable*: a TOTAL of 4 buys a POWER wedge that costs 4, and the last ore in
 * the bank spends. The sim honours it (`spendableOre + 1e-9 < cost` refuses only
 * when *strictly* short); the wheels must honour the identical one, or a wedge
 * dims that the sim would gladly sell — which is the developer's screenshot
 * (TOTAL 4, POWER 4, "can't buy") happening again.
 *
 * This lived inline in **four** places — three Build-wheel segments and the
 * Upgrade wedge — each a hand-copied `ore + 1e-9 >= cost`. Copies of a rule
 * drift (exactly how the `UpgradeTrack` enum copies drifted until typechecking
 * caught it, #108), and an affordability boundary is the one comparison where
 * drift means "the button lies about the sim." So it is ONE helper now: the
 * boundary is decided here, in a single expression, and both wheels move with it
 * — the "same helper, one fix" the field report asked for.
 */

/**
 * The float slack the boundary is forgiven by. Ore is whole on the wheel, but
 * repair spends fractional ore (1 ore per 5 HP, GDD §2.5) and mined chips land
 * fractional, so a real bank can sit a hair under a whole cost through no fault
 * of the player's. `1e-9` forgives that float and nothing wider — it never
 * closes a true one-ore gap.
 */
export const AFFORD_EPSILON = 1e-9;

/**
 * Whether `ore` can pay `cost` — the **inclusive** boundary the sim's `spendOre`
 * uses. `cost === ore` is affordable (the v0.2.2 field-report rule): the
 * exact-cost case buys and the bank hits zero. Anything strictly short is not.
 */
export function affordable(ore: number, cost: number): boolean {
  return ore + AFFORD_EPSILON >= cost;
}
