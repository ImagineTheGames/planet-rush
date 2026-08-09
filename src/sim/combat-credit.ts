/**
 * src/sim/combat-credit.ts — who did it. OWNER: Gameplay Engineer.
 *
 * Three of the four ratified XP weights — damage dealt 2×, ships destroyed 5×,
 * stations destroyed 10× (`docs/progression-plan.md` §1.1, §1.5) — are on
 * information the simulation did not *have*, not merely did not expose:
 * `damageShip` mutated a hull and returned a boolean, and a core simply reached
 * zero. This module is the missing half of the answer; the other half is the
 * optional `by?: PlayerId` now threaded down the four damage entry points
 * (`./damage`, `./buildings`) and the two death paths (`killShip`,
 * `destroyCore`).
 *
 * **It is modelled on `./ore-ledger`, deliberately line for line.** That ledger
 * is the pattern to copy, not to extend: two different questions (does the
 * economy conserve? / who earned what?) with two different lifetimes, sharing
 * one discipline.
 *
 * That discipline, restated because it is the whole reason this is safe:
 *
 *  - **Write-only.** Nothing inside `step` ever reads this. A world with a credit
 *    ledger and a world without one step identically, tick for tick. If a
 *    behaviour ever changes because the ledger exists, the change is wrong.
 *  - **Outside the fingerprint.** `hashState` (`harness/hash.ts`) enumerates the
 *    fields it hashes and does not include `world.credit`, so accounting can
 *    never perturb a determinism replay (GDD §4.8). `src/sim/combat-credit.test.ts`
 *    pins that with a full 60-second eight-slot match replayed both ways.
 *  - **Off the snapshot.** This is match-lifetime accounting, not per-tick state.
 *    It never goes near the netcode snapshot budget, same as the ore ledger.
 *  - **Optional on `World`.** `createWorld` always attaches one; the hand-built
 *    worlds other lanes construct (net snapshots, bot fixtures,
 *    `@platform/freeze`) omit it, and every function here no-ops when it is
 *    absent — so accounting never breaks a foreign world nor a test literal.
 *
 * And one rule that is not about determinism at all:
 *
 *  - **Honesty (§1.5).** A stat that cannot be credited to a real player is
 *    credited to NOBODY. There is no fallback, no nearest-guess, no "whoever hit
 *    it last will do". The collapse phase has no attacker (GDD §2.3 — the claim
 *    closing in), and that is not a corner case: measurement found the Crush took
 *    **100% of station deaths in an Easy bot lobby and 98% in a Medium one**
 *    (`spikes/progression/measured-a0-13.txt`). Zero is the correct answer there,
 *    and the summary renders it as `—` rather than as a guess.
 *
 * Keyed by **slot**, never by hull. A projectile outlives its owner's ship, and a
 * player eliminated from the match still earns what their last shots produce
 * (§1.5 trap 4) — so the accounting key is the seat, which exists for the whole
 * match, not the body, which does not.
 */

import type { PlayerId } from '@shared/types';
import { areEnemies } from './allegiance';
import { ASSIST_WINDOW_S } from './constants';
import type { World } from './state';

/** Sentinel for "this pair has never traded damage" in {@link CombatCredit.lastDamageAt}. */
const NEVER = -1;

/**
 * Cumulative combat attribution for one match, every array indexed by **player
 * slot**. Damage rows are HP *actually landed* — overkill is not credited, so a
 * 9999-damage shot into a 30 HP hull pays 30.
 *
 * The shape is the one ratified in `docs/progression-plan.md` §1.5, plus
 * {@link lastDamageAt}, which is what "record the assist window anyway" costs.
 */
export interface CombatCredit {
  /** HP dealt to enemy ship hulls, by attacker slot. */
  dealtToShips: number[];
  /** HP dealt to enemy station property — shields, core, turrets and radar
   *  satellites — by attacker slot. A besieger chewing through a turret ring is
   *  dealing damage; the 2× weight is on damage, not on which body absorbed it. */
  dealtToStations: number[];
  /** Enemy ship hulls this slot landed the killing blow on. */
  shipKills: number[];
  /** Enemy cores this slot landed the killing blow on. */
  stationKills: number[];
  /**
   * The last enemy to land damage on anything this **victim** slot owns, or
   * `null` while nobody has — informational, and never the source of a kill
   * credit. The killing blow is awarded from the `by` on the fatal call itself
   * ({@link creditKill}), so a hit on a victim's turret can never mis-award the
   * kill on their core.
   */
  lastHitBy: (PlayerId | null)[];
  /** Sim time of that hit, or {@link NEVER}. Indexed by victim slot. */
  lastHitAt: number[];
  /**
   * `lastDamageAt[victim][attacker]` — sim time that attacker last landed damage
   * on that victim, or {@link NEVER}. Fixed size (slots², and a lobby is eight
   * seats), no allocation after construction, and it is exactly what
   * {@link assistsOn} needs to answer the assist question later.
   *
   * **Phase 1 pays no assist XP** (§1.5 trap 1): an assisting player's damage
   * already paid them at 2× per unit, which is the honest version of an assist,
   * and paying it twice would double-count one contribution. The window is
   * recorded because the *summary* may want to name it.
   */
  lastDamageAt: number[][];
}

/** A fresh, all-zero ledger for a lobby of `slots` seats. */
export function makeCombatCredit(slots: number): CombatCredit {
  const n = Math.max(0, slots);
  return {
    dealtToShips: new Array<number>(n).fill(0),
    dealtToStations: new Array<number>(n).fill(0),
    shipKills: new Array<number>(n).fill(0),
    stationKills: new Array<number>(n).fill(0),
    lastHitBy: new Array<PlayerId | null>(n).fill(null),
    lastHitAt: new Array<number>(n).fill(NEVER),
    lastDamageAt: Array.from({ length: n }, () => new Array<number>(n).fill(NEVER)),
  };
}

/**
 * Whether `by` may be credited for something that happened to `victim`, and both
 * slots exist in this world's ledger.
 *
 * The predicate is {@link areEnemies} — `./allegiance`, the one module the whole
 * sim asks about sides (GDD §2.9). It is never re-derived here.
 *
 * §1.5 trap 2 asks for `canDamage`; this asks the *stricter* neighbour in the
 * same module, on purpose. `canDamage` answers "may this shot land?", which opens
 * up to allies the day `FRIENDLY_FIRE` is ratified on — and trap 2's own sentence
 * ("refuse to credit an ally or the victim themselves"), trap 5's ("the last
 * **enemy** to land damage"), and the honesty rule all say an ally must never
 * *pay*. With friendly fire OFF (the ratified default) the two predicates agree
 * exactly on every damaging call, so today this is a distinction without a
 * difference; the day it stops being one, a shot may land on a teammate and it
 * still earns nobody anything.
 */
function creditable(world: World, by: PlayerId | undefined, victim: PlayerId): boolean {
  const c = world.credit;
  if (!c || by === undefined || by === null) return false;
  if (by < 0 || by >= c.dealtToShips.length) return false;
  if (victim < 0 || victim >= c.lastHitBy.length) return false;
  return areEnemies(world, by, victim);
}

/**
 * Record `amount` HP that `by` actually landed on something `victim` owns, and
 * stamp the last-hit clocks used for the killing-blow record and the assist
 * window.
 *
 * Every damage site funnels through here, exactly as every ore mutation funnels
 * through `ledgerAdd`. Silently does nothing when this world keeps no ledger,
 * when the hit had no attacker (collapse decay, the `?debug=1` write seam, a
 * hand-built test call), or when attacker and victim are not enemies.
 *
 * `amount` is HP *landed*, which the callers clamp before calling: a hull with
 * 30 HP left takes 30 from a 9999-damage shot, not 9999.
 */
export function creditDamage(
  world: World,
  by: PlayerId | undefined,
  victim: PlayerId,
  bucket: 'dealtToShips' | 'dealtToStations',
  amount: number,
): void {
  if (amount <= 0 || !creditable(world, by, victim)) return;
  const c = world.credit!;
  const attacker = by!;
  const row = c[bucket];
  row[attacker] = (row[attacker] ?? 0) + amount;
  c.lastHitBy[victim] = attacker;
  c.lastHitAt[victim] = world.time;
  c.lastDamageAt[victim]![attacker] = world.time;
}

/**
 * Record that `by` landed the killing blow on `victim`'s hull or core.
 *
 * **One player, never split** (§1.5 trap 5). The damage rows already split the
 * work proportionally, so splitting the kill too would pay one contribution
 * twice, and `0.5 SHIPS DESTROYED` is a number nobody can read.
 *
 * The credit comes from the `by` on the fatal call — the last enemy to land
 * damage, by construction, since the call that took the body to zero *is* that
 * hit. It never falls back to {@link CombatCredit.lastHitBy}: a core the Crush
 * finished has no killer, and inventing one from an earlier hit is exactly the
 * guess the honesty rule forbids.
 *
 * Callers must invoke this **once per death** — see `eliminate` in `./match`,
 * which is the single non-idempotent point on the core-death path.
 */
export function creditKill(
  world: World,
  by: PlayerId | undefined,
  victim: PlayerId,
  bucket: 'shipKills' | 'stationKills',
): void {
  if (!creditable(world, by, victim)) return;
  const row = world.credit![bucket];
  row[by!] = (row[by!] ?? 0) + 1;
}

/**
 * Every *other* enemy who damaged `victim` within {@link ASSIST_WINDOW_S} of
 * `at` — the assist list, in slot order.
 *
 * A **read** helper for consumers outside the simulation (the end-of-match
 * summary, the XP observer). `step` must never call it: reading the ledger from
 * inside the sim is the one thing that would make the accounting able to change
 * behaviour. Phase 1 pays no assist XP; this exists so the summary can *name* an
 * assist without the ledger having to be re-shaped later.
 *
 * Defaults to the victim's own last-hit time, so `assistsOn(world, victim)` right
 * after a death answers "who helped kill it", excluding the killer.
 */
export function assistsOn(world: World, victim: PlayerId, at?: number): PlayerId[] {
  const c = world.credit;
  if (!c || victim < 0 || victim >= c.lastHitBy.length) return [];
  const when = at ?? c.lastHitAt[victim] ?? NEVER;
  if (when === NEVER) return [];
  const killer = c.lastHitBy[victim];
  const row = c.lastDamageAt[victim] ?? [];
  const out: PlayerId[] = [];
  for (let slot = 0; slot < row.length; slot++) {
    const t = row[slot]!;
    if (t === NEVER || slot === killer) continue;
    if (when - t <= ASSIST_WINDOW_S && t <= when) out.push(slot);
  }
  return out;
}
