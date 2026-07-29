/**
 * src/sim/ — the deterministic simulation. OWNER: Gameplay Engineer (GDD §3.2).
 *
 * Ship physics, the shared shoot/mine weapon, ore, building, construction timers,
 * the repair channel, siege rules, win/loss, and the baseline constants table
 * live here. This module runs with no GPU, no canvas, no window — the match
 * server and the QA harness both import it headless (GDD §4.1).
 *
 * Public surface: build a world with `createWorld`, advance it with `step`,
 * read plain-data `World`/`Ship`/`Asteroid`/`OreChunk`/`MiningStation`/`Turret`/
 * `Shield`/`Projectile`, and read the match's own state off `world.match`
 * (waves, collapse, winner). Building is driven entirely through the action
 * stream (`buildOrder`), so a caller never has to reach into `./buildings` to
 * play the game — the exports there are for the renderer, the bots, and the
 * tests (caps, costs, docking range, mount geometry). Ship upgrades work the
 * same way: buy through the action stream (`upgradeOrder`), and read what a hull
 * actually does through `./upgrades`, which resolves the GDD §2.11 class base
 * against the GDD §2.5 tier ladder. Every tuning value lives in `./constants`
 * (GDD §2.8, TUNABLE — QA owns it from day 2).
 */

export * from './constants';
// Safe arrival geometry — one clamp keeps every pilot's fly-to point off a body's
// collision radius (developer report p14, the bot-home-rim wedge class).
export * from './anchors';
// The ratified map registry: arena bounds + home placements per layout.
export * from './maps';
// Class bases × upgrade tiers — every derived ship stat (GDD §2.5, §2.11).
export * from './upgrades';
// `./rng` is re-exported through `./state`, next to the `rngState` it threads.
export * from './state';
export * from './ore-ledger';
// The one match-config model (mode + slots) and its dense compaction to a roster.
export * from './match-config';
// The one friend/foe predicate every targeting/collision/siege site routes through.
export * from './allegiance';
export * from './waves';
export * from './match';
export * from './step';
export * from './buildings';
// Pooled combat projectiles — ship weapons and turret guns (design amendment v0.2).
export * from './projectiles';
export * from './damage';
// Read model: every firing ship + turret this tick, for the renderer / audio.
export * from './combat-view';
// Read model: the per-player minimap fog-of-war sensed-set (radar satellite, f1).
export * from './sensing';
