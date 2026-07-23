/**
 * src/sim/ — the deterministic simulation. OWNER: Gameplay Engineer (GDD §3.2).
 *
 * Ship physics, the shared shoot/mine beam, ore, building, construction timers,
 * the repair channel, siege rules, win/loss, and the baseline constants table
 * live here. This module runs with no GPU, no canvas, no window — the match
 * server and the QA harness both import it headless (GDD §4.1).
 *
 * Public surface (day 1): build a world with `createWorld`, advance it with
 * `step`, read plain-data `World`/`Ship`/`Asteroid`/`OreChunk`. Every tuning
 * value lives in `./constants` (GDD §2.8, TUNABLE — QA owns it from day 2).
 */

export * from './constants';
export * from './state';
export * from './step';
