/**
 * src/bots/memory.ts — what a bot remembers between looks. OWNER: Bot Engineer
 * (GDD §2.2, §2.9).
 *
 * Fog is a mechanic: "knowing who is winning, who is wounded, and who is under
 * siege is information you *earn* by scouting" (GDD §2.2). A bot that only ever
 * acted on the current tick's `BotView` would forget a wounded rival the instant
 * it turned around — which is not fog-honest, it is fog-*amnesiac*, and it makes
 * a Hard bot worse than a human for the wrong reason.
 *
 * So bots remember, under two rules that keep the memory honest:
 *
 *  1. **Only the view goes in.** {@link BotMemory.observe} takes a `BotView` and
 *     nothing else. A fact can only be remembered if it was legal to see, so a
 *     memory can never launder hidden state into a decision.
 *  2. **Memory expires.** Every entry carries the sim time it was taken, and
 *     every read takes a freshness window (`DifficultyTuning.memorySeconds`).
 *     A Hard bot's picture of the map is fresher than an Easy bot's — but only
 *     because it re-scouts more often and forgets more slowly, never because it
 *     re-reads the world (GDD §2.9).
 *
 * Ten-second-old news is still news. Acting on it and being wrong is the price
 * of the fog, and it is a price bots are supposed to pay.
 */

import type { PlayerId, Vec2 } from '@shared/types';
import type { BotView, PerceivedStation, PerceivedShip } from './perception';

// ---------------------------------------------------------------------------
// Remembered facts
// ---------------------------------------------------------------------------

/** What a bot last knew about a rival's home. */
export interface StationMemo {
  readonly owner: PlayerId;
  /** Position and wreck state are public at any range (GDD §2.2), so these are
   *  always current rather than remembered. */
  pos: Vec2;
  radius: number;
  alive: boolean;
  /** Sim time of the last *scouted* read — when the numbers below were taken. */
  scoutedAt: number;
  /** Core HP as a fraction, from the last scout; null if never scouted. */
  coreFraction: number | null;
  shieldHp: number | null;
  /** Turret count from the last visual-range look; null if never close enough. */
  turrets: number | null;
  /** Was it under attack when last scouted? */
  underAttack: boolean;
}

/** What a bot last knew about a rival's ship. */
export interface ShipMemo {
  readonly id: PlayerId;
  pos: Vec2;
  vel: Vec2;
  seenAt: number;
  hullFraction: number | null;
  firing: boolean;
  eliminated: boolean;
}

/** A place ore was lying loose — a kill site, a wreck field, a rich rock that
 *  burst (GDD §2.7: "fights over a fresh wreck are a feature"). */
export interface LootMemo {
  pos: Vec2;
  /** Ore seen lying there, summed over the chunks in view at the time. */
  amount: number;
  seenAt: number;
}

// ---------------------------------------------------------------------------
// The memory
// ---------------------------------------------------------------------------

/**
 * One bot's private notebook. Deterministic by construction: insertion-ordered
 * `Map`s keyed by slot id, no iteration over object keys, no clock but the sim's
 * own `view.time`.
 */
export class BotMemory {
  private readonly stations = new Map<PlayerId, StationMemo>();
  private readonly ships = new Map<PlayerId, ShipMemo>();
  private loot: LootMemo | null = null;
  /** Sim time of the most recent `observe`. */
  time = 0;

  /**
   * Fold this tick's view into the notebook. Called once at the top of every
   * decision — never per branch, so two trees reading the same memory see the
   * same picture.
   */
  observe(view: BotView): void {
    this.time = view.time;
    for (const station of view.stations) this.noteStation(station, view.time);
    for (const ship of view.ships) this.noteShip(ship, view.time);
    this.noteLoot(view);
  }

  private noteStation(seen: PerceivedStation, now: number): void {
    const memo = this.stations.get(seen.owner);
    if (!memo) {
      this.stations.set(seen.owner, {
        owner: seen.owner,
        pos: { x: seen.pos.x, y: seen.pos.y },
        radius: seen.radius,
        alive: seen.alive,
        scoutedAt: seen.scouted ? now : Number.NEGATIVE_INFINITY,
        coreFraction: seen.scouted && seen.coreHp !== null ? seen.coreHp / Math.max(1e-9, seen.maxCoreHp) : null,
        shieldHp: seen.shieldHp,
        turrets: seen.turrets,
        underAttack: seen.underAttack === true,
      });
      return;
    }
    // Public every tick: where it is, and whether it is a wreck.
    memo.pos.x = seen.pos.x;
    memo.pos.y = seen.pos.y;
    memo.radius = seen.radius;
    memo.alive = seen.alive;
    // Scouted this tick: refresh the numbers and the timestamp. Otherwise the
    // old numbers stand, and go stale on their own.
    if (seen.scouted && seen.coreHp !== null) {
      memo.scoutedAt = now;
      memo.coreFraction = seen.coreHp / Math.max(1e-9, seen.maxCoreHp);
      memo.shieldHp = seen.shieldHp;
      memo.underAttack = seen.underAttack === true;
    }
    if (seen.turrets !== null) memo.turrets = seen.turrets;
  }

  private noteShip(seen: PerceivedShip, now: number): void {
    const memo = this.ships.get(seen.id);
    const hull = seen.hull !== null ? seen.hull / Math.max(1e-9, seen.maxHull) : null;
    if (!memo) {
      this.ships.set(seen.id, {
        id: seen.id,
        pos: { x: seen.pos.x, y: seen.pos.y },
        vel: { x: seen.vel.x, y: seen.vel.y },
        seenAt: now,
        hullFraction: hull,
        firing: seen.firing,
        eliminated: seen.eliminated,
      });
      return;
    }
    memo.pos.x = seen.pos.x;
    memo.pos.y = seen.pos.y;
    memo.vel.x = seen.vel.x;
    memo.vel.y = seen.vel.y;
    memo.seenAt = now;
    if (hull !== null) memo.hullFraction = hull;
    memo.firing = seen.firing;
    memo.eliminated = seen.eliminated;
  }

  /**
   * Remember one loot site — the richest cluster currently in view, or nothing.
   * Deliberately a single slot: a scavenger that queued every chunk it ever saw
   * would fly a tour of the map instead of raiding the fresh kill (GDD §2.7).
   */
  private noteLoot(view: BotView): void {
    if (view.chunks.length === 0) return;
    let sx = 0;
    let sy = 0;
    let amount = 0;
    for (const chunk of view.chunks) {
      sx += chunk.pos.x * chunk.amount;
      sy += chunk.pos.y * chunk.amount;
      amount += chunk.amount;
    }
    if (amount <= 1e-9) return;
    const site: LootMemo = { pos: { x: sx / amount, y: sy / amount }, amount, seenAt: view.time };
    // A site currently in view always wins: it is the one the bot can confirm.
    this.loot = site;
  }

  /** The remembered home of a slot, or null if this bot has never seen it. */
  station(owner: PlayerId): StationMemo | null {
    return this.stations.get(owner) ?? null;
  }

  /**
   * A remembered ship, but only while the memory is fresher than `window`
   * seconds. Past that the bot has to go and look again — which is the fog doing
   * its job (GDD §2.2).
   */
  ship(id: PlayerId, window: number): ShipMemo | null {
    const memo = this.ships.get(id);
    if (!memo) return null;
    return this.time - memo.seenAt <= window ? memo : null;
  }

  /** How stale a station's scouted numbers are, in seconds; `Infinity` if never
   *  scouted. The number Hard bots discount an opportunity by. */
  stationAge(owner: PlayerId): number {
    const memo = this.stations.get(owner);
    if (!memo || memo.coreFraction === null) return Number.POSITIVE_INFINITY;
    return this.time - memo.scoutedAt;
  }

  /** The last place this bot saw ore lying loose, while the memory is fresh. */
  lootSite(window: number): LootMemo | null {
    if (!this.loot) return null;
    return this.time - this.loot.seenAt <= window ? this.loot : null;
  }

  /** Forget the loot site — called once a bot has flown there and found it gone,
   *  so it does not orbit an empty patch of space forever. */
  clearLoot(): void {
    this.loot = null;
  }
}
