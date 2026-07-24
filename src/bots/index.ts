/**
 * src/bots/ — AI opponents. OWNER: Bot Engineer (GDD §3.3, §2.9).
 *
 * Hand-coded Easy/Medium/Hard behavior trees plus the seven bot personalities,
 * driving the same abstract `Action` interface a human uses (`@shared/types`).
 * **Fog-honest**: a bot perceives only what a human in its cockpit could — same
 * sensor range, no hidden-HP peeking — and that is enforced by the types, not by
 * convention (`./perception`). **No LLM calls at runtime, ever**: runtime token
 * cost is zero. Difficulty changes visible competence, never information.
 *
 * The module in four files:
 *
 *  - `./personalities` — the cast (GDD §2.9): Rusty, Bolt, Foreman, Patch,
 *    Sable, Vulture, Warden, their tiers, hulls, and weights.
 *  - `./perception`    — `perceive(world, id)` ⇒ a `BotView`: what that slot can
 *    see this tick, and nothing else.
 *  - `./bot`           — the `Bot` contract and the day-2 **do-nothing baseline**
 *    tree that every personality currently runs.
 *  - `./harness`       — bots fill empty lobby slots, emit `Inputs`, and a
 *    headless match runs to its ending under an enforced timeout (GDD §3.8).
 *
 * Day-2 scope is the *scaffold*, on purpose: an eight-slot match of do-nothing
 * bots must still spawn eight planets, run the wave metronome, enter collapse,
 * and produce a winner. Everything the trees will need — fog-honest perception,
 * the action channel, the seeded per-bot RNG, the decision cadence — is proven
 * against that baseline before any bot has an opinion.
 */

export * from './personalities';
export * from './perception';
export * from './bot';
export * from './harness';
