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
 * The module, bottom-up:
 *
 *  - `./personalities` — the cast (GDD §2.9): Rusty, Bolt, Foreman, Patch,
 *    Sable, Vulture, Warden, their tiers, hulls (GDD §2.11), and weights.
 *  - `./perception`    — `perceive(world, id)` ⇒ a `BotView`: what that slot can
 *    see this tick, and nothing else.
 *  - `./memory`        — what a bot remembers between looks, and how fast it
 *    forgets. Only the view goes in, so memory cannot launder hidden state.
 *  - `./steering`      — hands on the controls: the only file that turns a
 *    decision into `Action`s.
 *  - `./radio`         — the team callout channel: what allied bots may say to
 *    each other, with a latency, a miss rate and a cooldown, so cooperation is a
 *    skill rather than telepathy (`docs/team-bots-plan.md` §2).
 *  - `./ally`          — the memory of having answered a teammate's alarm, and
 *    the budget that stops one besieged ally consuming a whole match.
 *  - `./targeting`     — threat × proximity × opportunity, the nerve threshold,
 *    and the fog-honest guess at who is winning.
 *  - `./behaviors`     — the verbs every tier shares: mine, haul, spend, guard,
 *    engage, break off, scavenge.
 *  - `./tree`          — the behavior-tree kernel: named leaves, one selector.
 *  - `./easy` `./medium` `./hard` — the three trees, each one GDD §2.9's
 *    sentence about that tier written as a priority list.
 *  - `./bot`           — the `Bot` contract, the wiring, and the do-nothing
 *    baseline the QA match loop is proven against.
 *  - `./harness`       — bots fill empty lobby slots, emit `Inputs`, and a
 *    headless match runs to its ending under an enforced timeout (GDD §3.8).
 *
 * The load-bearing shape: a tree is *pure structure* over a `BotView` and a
 * private `Brain`. It has no reference to the world, no clock but the sim's, and
 * no randomness but its own seeded stream — which is what makes "difficulty
 * changes competence, never information" checkable rather than promised.
 */

export * from './personalities';
export * from './perception';
export * from './memory';
export * from './steering';
export * from './radio';
export * from './ally';
export * from './tree';
export * from './targeting';
export * from './behaviors';
export * from './easy';
export * from './medium';
export * from './hard';
export * from './bot';
export * from './harness';
