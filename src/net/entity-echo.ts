/**
 * src/net/entity-echo.ts — the predicted turret and the real one are one turret.
 * OWNER: Netcode Engineer (GDD §2.5, §4.2; M10 action-echo brief).
 *
 * `./order-ledger` matches an *order* to authority's answer. This module matches
 * the **thing the order eventually becomes**, which is a separate problem with a
 * separate deadline: a build job takes ten seconds to finish (GDD §2.5), and when
 * it does, both sides finish their own copy. The client's copy was minted from its
 * own `world.nextEntityId`; the server's arrives on the entity-event stream with
 * the server's id (`./entity-events`). Nothing in either id says they are the same
 * turret, so the applier — which is *correctly* id-keyed and idempotent — created a
 * second one beside the first.
 *
 * That is the last of *"every action happens twice"* for structures: two turrets on
 * one mount, two shield bubbles over one core, from one tap that cost one turret's
 * worth of ore.
 *
 * **The rule: a station's structures are authority's structures.** The first time
 * authority names an id, that structure is real; if the station is also carrying a
 * predicted structure of the same kind that authority has never named, the
 * predicted one steps aside for it. One in, one out — so the *count* is authority's
 * count from the first event onward, and the identity is authority's identity.
 *
 * Turrets are matched by their mount slot as well, because a mount slot is a
 * turret's real identity in this sim: the ring is capped at four, the sim assigns
 * the lowest free slot by the same rule on both sides (`sim/buildings.ts`
 * `freeTurretSlot`), and a client only ever predicts orders at *its own* station.
 * So a slot match is exact rather than a heuristic, and it means the adopted turret
 * keeps the mount the player has been watching it assemble on.
 *
 * State lives here, per match, rather than in `./entity-events` — that module is a
 * pure applier and the whole point of it is that it can be handed any world and any
 * message. What ids authority has named so far is a *conversation*, and this is the
 * object that remembers the conversation.
 */

import type { MiningStation, World } from '../sim';
import type { EntityEventMessage } from './transport';

/** The structure kinds a client can predict into existence, and therefore the only
 *  ones that can be predicted twice. Asteroids and stations are never predicted —
 *  a rock comes from the shared seed and a station from the roster. */
const PREDICTABLE = new Set(['turret', 'shield', 'satellite']);

/** One structure the client is holding that authority has not (yet) named. */
interface Displaced {
  readonly kind: string;
  readonly index: number;
}

export class StructureEcho {
  /** Every structure id authority has named, across every station. Bounded by the
   *  design caps — 8 stations × (4 turrets + 2 shields + 1 satellite), plus the
   *  ones that have died — so it is a set of tens, not a leak. */
  private readonly named = new Set<number>();

  /** Structure ids authority has named. Exposed for the test that has to tell
   *  "adopted" from "coincidentally the same id". */
  get authoritativeIds(): ReadonlySet<number> {
    return this.named;
  }

  /**
   * Make room for one authoritative structure before it is applied.
   *
   * Called with every entity event, immediately ahead of `applyEntityEvent`. For an
   * id authority has not named before, it removes at most one predicted structure of
   * the same kind at the same station — so the applier that runs next *adds*
   * authority's copy into the space the prediction just vacated, and the station ends
   * the exchange with one structure rather than two.
   *
   * Returns what it displaced (or null), so a caller — and a test — can see that a
   * replacement happened rather than infer it from a count.
   */
  reconcileSpawn(world: World, message: EntityEventMessage): Displaced | null {
    if (message.op === 'destroy') return null;
    if (!PREDICTABLE.has(message.kind)) return null;
    const data = message.data;
    if (!isRecord(data) || typeof data['id'] !== 'number') return null;
    const id = data['id'];
    // Already known: this is an *update* to a structure that has been reconciled
    // once. Updates are the common case (a satellite's orbit angle, a turret's
    // maxHp after a tier step) and must never displace anything.
    if (this.named.has(id)) return null;
    this.named.add(id);

    const owner = data['owner'];
    if (typeof owner !== 'number') return null;
    const station = world.stations.find((s) => s.owner === owner);
    if (!station) return null;
    // A structure the client already holds under authority's own id — the two
    // counters happened to agree, or this is a client that predicted nothing.
    // Nothing to displace.
    if (this.holds(station, message.kind, id)) return null;

    const slot = typeof data['slot'] === 'number' ? data['slot'] : null;
    return this.displace(station, message.kind, slot);
  }

  /** Forget the conversation — a reclaim rebuilds the world and refills it from a
   *  full authoritative burst, so every id is about to be named again from scratch
   *  (`./entity-events` `resetStaticEntities`). */
  reset(): void {
    this.named.clear();
  }

  // --- Internals ------------------------------------------------------------

  private holds(station: MiningStation, kind: string, id: number): boolean {
    return this.listOf(station, kind).some((e) => e.id === id);
  }

  /**
   * Remove one predicted structure of `kind` from `station` to make room for an
   * authoritative one, preferring the turret on the same mount slot.
   *
   * "Predicted" means *not named by authority*, which is the only definition
   * available and the right one: a structure authority has spoken about is real
   * whoever created the object.
   */
  private displace(station: MiningStation, kind: string, slot: number | null): Displaced | null {
    const list = this.listOf(station, kind);
    let pick = -1;
    for (let i = 0; i < list.length; i++) {
      const entity = list[i]!;
      if (this.named.has(entity.id)) continue;
      // The same mount is an exact match, so it wins outright; otherwise the first
      // unnamed one stands in, which is correct for shields and satellites (they
      // are interchangeable, and capped at 2 and 1).
      if (slot !== null && entity.slot === slot) {
        pick = i;
        break;
      }
      if (pick < 0) pick = i;
    }
    if (pick < 0) return null;
    list.splice(pick, 1);
    return { kind, index: pick };
  }

  /** The station array a kind lives in, as a common shape (`id`, and `slot` where
   *  the kind has one). Satellites may be absent on a hand-built fixture. */
  private listOf(station: MiningStation, kind: string): { id: number; slot?: number }[] {
    if (kind === 'turret') return station.turrets;
    if (kind === 'shield') return station.shields;
    return station.satellites ?? [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
