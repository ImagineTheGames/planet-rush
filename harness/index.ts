/**
 * harness/ — headless QA harness. OWNER: QA Agent (GDD §3.8, §4.8).
 *
 * Runs headless bot-vs-bot matches with an ENFORCED match timeout (a hung match
 * is a failed test, not a hung harness), the determinism replay test (same
 * inputs → same final state hash), the entity-count performance profile, and
 * balance sweeps against the three measurable targets (match length 10–15 min;
 * no strategy > 55% win rate; no ship class > 55% win rate).
 *
 * Imports `src/sim/` and `src/bots/` headless — never PixiJS, never a DOM.
 *
 *  - `./match`      the match loop and its three ceilings; record and replay
 *  - `./hash`       the final state hash and its per-subsystem digest
 *  - `./strategies` QA probe strategies (measuring instruments, not game AI)
 *  - `./balance`    sweeps, statistics, and the markdown report
 *  - `./perf`       the GDD §4.3 stress scene and frame-time capture
 *  - `./cli`        the command line for heavy runs (not exported here)
 */

export * from './hash';
export * from './strategies';
export * from './match';
export * from './balance';
export * from './perf';
