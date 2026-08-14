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
 *
 * It also holds the other half of that answer: {@link costNumeral}, how a price
 * is *written* once the affordability question has been answered in colour. The
 * two belong together because they are the same decision seen twice — the wheels
 * say "can you pay?" exactly once, in the numeral's paint, and therefore the
 * numeral itself is free to be nothing but the price.
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

/**
 * A price, as either wheel writes it: **the cost, and nothing else** — `"3"`.
 *
 * No denominator. Whether the player can *pay* it is carried by the numeral's
 * colour — yellow payable, red not (`./wheel-stack`'s `costPaintFor` and
 * `upgradeCostPaint`, both driven by {@link affordable} above) — so the
 * affordability answer is said once, in the channel the developer ratified for
 * it on 2026-08-07, and how much ore the player holds stays where it belongs:
 * the wheel's hub.
 *
 * This lives here, next to the boundary rule, because it is one grammar across
 * one control: the Build wheel and the Upgrade wheel are the same radial menu at
 * different levels (style-guide §2.1), and a rule stated twice is a rule that
 * reaches one page and not the next — which is exactly how the Upgrade wheel and
 * its WEAPON sub-wheel went on quoting `cost/held` for six days after the Build
 * wheel stopped (developer, 2026-08-13: *"it got done on the page before this
 * one but none of the sub pages"*). One function, every page.
 *
 * Each wheel keeps its own word for a wedge with no price left to quote — the
 * Build wheel's `FULL`, the Upgrade wheel's `MAX` — because those are nouns for
 * a state, not prices. Only the numeral's shape is shared.
 */
export function costNumeral(cost: number): string {
  return `${cost}`;
}
