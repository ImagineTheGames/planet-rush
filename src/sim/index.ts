/**
 * src/sim/ — the deterministic simulation. OWNER: Gameplay Engineer (GDD §3.2).
 *
 * Ship physics, the shared shoot/mine beam, ore, building, construction timers,
 * the repair channel, siege rules, win/loss, and the baseline constants table
 * live here. This module runs with no GPU, no canvas, no window — the match
 * server and the QA harness both import it headless (GDD §4.1).
 *
 * Public surface: build a world with `createWorld`, advance it with `step`,
 * read plain-data `World`/`Ship`/`Asteroid`/`OreChunk`/`Planet`/`Turret`/
 * `Shield`/`Projectile`, and read the match's own state off `world.match`
 * (waves, collapse, winner). Building is driven entirely through the action
 * stream (`buildOrder`), so a caller never has to reach into `./buildings` to
 * play the game — the exports there are for the renderer, the bots, and the
 * tests (caps, costs, docking range, mount geometry). Every tuning value lives
 * in `./constants` (GDD §2.8, TUNABLE — QA owns it from day 2).
 */

export * from './constants';
// `./rng` is re-exported through `./state`, next to the `rngState` it threads.
export * from './state';
export * from './waves';
export * from './match';
export * from './step';
export * from './buildings';
export * from './damage';
