/**
 * src/bots/radio.ts — the team callout channel. OWNER: Bot Engineer
 * (GDD §2.9; `docs/team-bots-plan.md` §2, Stage 2 Task 2.2).
 *
 * The developer, on team bots: *"they need to strategize together if they are on
 * teams, like humans would"* — and humans coordinate **by talking**, so this file
 * models talking, literally and with a cost. It is Layer B of the plan's two:
 * Layer A is the ally klaxon a human already hears (`./perception`'s
 * {@link import('./perception').AllyView.underAttack}), which is HUD parity and
 * free; this is everything the HUD does not carry.
 *
 * **The guarantee, and how it is kept structurally.** A bot may only transmit a
 * fact it legitimately perceived, so the union of what a team knows is exactly
 * the union of what its members saw — *nobody learns what no teammate saw*. That
 * is strictly weaker than per-bot fog and strictly stronger than allied bots
 * reading each other's `Brain`, which the plan rejects outright (§2.1: memory,
 * tabu and commitment latches are *this* bot's scouting, and laundering them
 * through an ally would make `fog-honesty.test.ts` unable to fail). The structural
 * defence is the import list below: **this file imports nothing from `src/sim`**,
 * so there is no `World` here to read a hidden number off (Trap 2).
 *
 * **Determinism (GDD §4.8, plan §2.4), which is the whole reason this file is
 * shaped the way it is.** `botInputs` iterates the bot array in order and each
 * bot decides on its own cadence (`./harness`), and the match server drives bots
 * one at a time. If a callout sent at tick *T* were readable at tick *T*, a
 * higher-numbered slot would see it and a lower-numbered one — already decided —
 * would not, coupling behaviour to seat order and to the loop's shape. So:
 *
 *  1. **A callout sent at `t` is readable at `t + latency`, and every tier's
 *     latency is ≥ one tick** ({@link DifficultyTuning.callLatency}). No callout
 *     is ever readable in the tick it was sent, so iteration order cannot affect
 *     any decision. `src/bots/team-radio.test.ts` is the standing guard; do not
 *     weaken it to make an "instant Hard" feel snappier (Trap 4).
 *  2. **Reads are totally ordered** — `(readableAt, from, seq)`, with `seq` a
 *     monotonic counter, so there is no tie and insertion order is invisible.
 *  3. **The miss roll comes from the sender's seeded stream**, drawn once per
 *     recipient in ascending slot order at send time, so *who missed the call* is
 *     a pure function of the seed and never of the clock.
 *  4. **The radio lives outside `World`**, constructed beside the bots exactly
 *     like `Brain` (`./tree`), so the determinism replay — which hashes the world
 *     and replays recorded inputs — never sees it and can never desync on it. It
 *     is also therefore not on the wire budget, which is 494 bytes and not ours
 *     (Trap 5).
 *
 * **FFA degrades structurally, not by a flag** (plan §2.5). A team of one has no
 * recipients, so {@link teamRadio} returns `null` for it, {@link send} on `null`
 * is a no-op, and {@link receive} on `null` returns the shared empty array. There
 * is no mode check anywhere in a tree.
 */

import type { PlayerId, Rng, Vec2 } from '@shared/types';

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * What a bot may say. **Stage 2 ships the minimum form: two kinds, both about
 * trouble.** The plan's full vocabulary also has `sighting` and `claim`
 * (§2.2); they belong to Stages 3–4 and are deliberately not here, because a
 * channel with nothing to carry is a channel nobody can test.
 *
 *  - `help`  — *"I am in trouble, here."* A fact about the sender's own ship, so
 *    it is legal at any range and under any fog: you always know where you are.
 *    This is the one thing Layer A genuinely does not carry — the klaxon rings
 *    for a **home**, and a teammate jumped in open space has no klaxon.
 *  - `siege` — *"a home on our side is being hit, there."* Legal from the
 *    sender's own {@link import('./perception').OwnStationView.underAttack}, or
 *    from an ally home it actually scouted (`PerceivedStation.underAttack`, which
 *    is `null` off-screen and therefore unsendable).
 *
 * Never sendable, at any tier: an unscouted core's HP, anyone's held or banked
 * ore, upgrade tiers, an asteroid's true `ore` — anything read off `World`. The
 * enforcement is that {@link Callout} has nowhere to put them.
 */
export type CalloutKind = 'help' | 'siege';

/**
 * One thing a teammate said. Small, flat, and carrying **only** a position, a
 * subject, and when it was seen.
 *
 * `seenAt` is the load-bearing field: it is the sender's `view.time` **at the
 * moment of observation**, never the receipt time. Stamp it the other way round
 * and a stale rumour becomes fresh intelligence every time it is repeated — the
 * team's picture of the map would get *better* the more it was passed around,
 * which is omniscience with extra steps (Trap 3). A call about a ten-second-old
 * fact is ten-second-old news, and acting on it and being wrong is the price of
 * the fog.
 */
export interface Callout {
  readonly kind: CalloutKind;
  /** The slot that spoke. */
  readonly from: PlayerId;
  /** The slot the call is *about* — the caller for `help`, the besieged home's
   *  owner for `siege`. Equal to {@link from} in every Stage 2 send. */
  readonly about: PlayerId;
  /** Where the trouble is: the caller's own position, or the besieged home's. */
  readonly pos: Vec2;
  /** The sender's `view.time` when it perceived this. Never the receipt time. */
  readonly seenAt: number;
  /** `seenAt + callLatency`. Not readable before this, ever (see rule 1). */
  readonly readableAt: number;
  /** Monotonic per-radio insertion counter — the last key of the total order. */
  readonly seq: number;
  /**
   * Bitmask of the slots that **heard** this call, rolled from the sender's
   * seeded stream at send time. Slot `i` heard it iff bit `i` is set.
   *
   * A bitmask rather than a list because it allocates nothing and compares in one
   * instruction — a match is eight slots (`./harness` `MATCH_SLOTS`), and this
   * caps at {@link RADIO_MAX_SLOT}, comfortably above the widest lineup the QA
   * harness runs.
   */
  readonly heardBy: number;
}

/**
 * Highest slot id the {@link Callout.heardBy} bitmask can address. A match is
 * eight slots and the wire is eight slots; 30 leaves the sign bit alone so the
 * mask is always a non-negative int32. A recipient above this simply is not
 * marked as having heard — {@link teamRadio} refuses to build a radio for such a
 * roster at all rather than silently dropping half a team's calls.
 */
export const RADIO_MAX_SLOT = 30;

/**
 * How many calls a team's channel holds before the oldest is evicted. One voice,
 * one channel: combined with `callCooldown` this bounds allocation to a single
 * preallocated ring per team that never grows, so an eight-bot match still
 * allocates nothing per frame for the radio (GDD §4.3). TUNABLE
 */
export const RADIO_CAPACITY = 16;

/**
 * How much faster second-hand news decays than first-hand news (plan §2.2).
 *
 * A received call's *effective* age is `(now - seenAt) * HEARSAY_STALENESS`, so
 * first-hand knowledge always beats a call about the same thing and a bot prefers
 * to go and look. This is what stops the channel quietly becoming a shared
 * omniscient map: every hop through it costs the fact half its remaining life.
 * TUNABLE
 */
export const HEARSAY_STALENESS = 2;

// ---------------------------------------------------------------------------
// The channel
// ---------------------------------------------------------------------------

/**
 * One team's channel. Constructed beside the bots, handed to each `Brain`, and
 * never put in `World` (see the module note, rule 4).
 *
 * The `calls` array *is* the ring: it grows to {@link RADIO_CAPACITY} once and
 * then only ever has entries overwritten in place.
 */
export interface TeamRadio {
  /** The slots on this side, ascending. The recipient set of every send. */
  readonly members: readonly PlayerId[];
  /** The ring. At most {@link RADIO_CAPACITY} entries; `at` is the next write. */
  readonly calls: Callout[];
  /** Next write index into {@link calls}, once the ring is full. */
  at: number;
  /** Monotonic sequence stamped on every call — the total order's last key. */
  seq: number;
}

/** Nothing to read: the shared empty result, so a quiet tick allocates nothing. */
const NO_CALLS: readonly Callout[] = Object.freeze([]);

/**
 * Build the channel for a side, or `null` when there is nobody to talk to.
 *
 * **A team of one gets `null`, and that is how FFA degrades** (plan §2.5): every
 * send is a no-op with no recipients and every receive is the empty array, with
 * no mode flag anywhere in a tree. A roster containing a slot above
 * {@link RADIO_MAX_SLOT} also gets `null` — refusing the channel outright is
 * honest, where a mask that silently cannot address that slot would look like a
 * bot bug for a day.
 *
 * `members` is copied and sorted ascending: the recipient loop in {@link send}
 * draws one RNG value per member, so its order is part of the determinism
 * contract and must be a property of this function rather than of the caller.
 */
export function teamRadio(members: readonly PlayerId[]): TeamRadio | null {
  if (members.length < 2) return null;
  for (const id of members) {
    if (id < 0 || id > RADIO_MAX_SLOT) return null;
  }
  const sorted = [...members].sort((a, b) => a - b);
  return { members: sorted, calls: [], at: 0, seq: 0 };
}

/** What a caller hands {@link send}: the fact, with no delivery details on it. */
export interface CalloutDraft {
  readonly kind: CalloutKind;
  readonly from: PlayerId;
  readonly about: PlayerId;
  readonly pos: Vec2;
  /** The sender's `view.time` when it perceived this (see {@link Callout}). */
  readonly seenAt: number;
}

/**
 * Speak. Rolls each teammate's chance of missing it, stamps the delivery time,
 * and files it in the ring.
 *
 * **Every roll happens whether or not the call is filed**, and in ascending slot
 * order, because the sender's RNG stream is shared with its aim and its escape
 * headings: skipping a draw would shift every later decision that bot makes. A
 * call nobody heard is therefore *not* stored — there is no one to read it — but
 * it costs exactly the same stream.
 *
 * `latency` must be ≥ one tick at every tier; that is the determinism rule, not
 * a tuning choice (see the module note). This function does not enforce it,
 * because it has no `TICK_DT` to compare against — importing one would mean
 * importing the sim. `team-radio.test.ts` enforces it over
 * `DIFFICULTY_TUNING` instead, which is where the numbers actually live.
 *
 * @returns the filed call, or `null` if the radio was `null` or nobody heard.
 */
export function send(
  radio: TeamRadio | null,
  draft: CalloutDraft,
  latency: number,
  missChance: number,
  rng: Rng,
): Callout | null {
  if (!radio) return null;
  let heardBy = 0;
  for (const id of radio.members) {
    if (id === draft.from) continue;
    // One draw per recipient, always, in ascending slot order.
    if (rng.next() >= missChance) heardBy |= 1 << id;
  }
  if (heardBy === 0) return null;
  const call: Callout = {
    kind: draft.kind,
    from: draft.from,
    about: draft.about,
    pos: { x: draft.pos.x, y: draft.pos.y },
    seenAt: draft.seenAt,
    readableAt: draft.seenAt + latency,
    seq: radio.seq++,
    heardBy,
  };
  if (radio.calls.length < RADIO_CAPACITY) {
    radio.calls.push(call);
  } else {
    // The ring, full: overwrite the oldest slot and step on. `at` walks the array
    // in insertion order, so the entry it lands on is always the eldest.
    radio.calls[radio.at] = call;
    radio.at = (radio.at + 1) % RADIO_CAPACITY;
  }
  return call;
}

/** Did slot `id` hear this call? */
export function heard(call: Callout, id: PlayerId): boolean {
  return id >= 0 && id <= RADIO_MAX_SLOT && (call.heardBy & (1 << id)) !== 0;
}

/**
 * The **hearsay-discounted** age of a call: how old this news feels to somebody
 * who did not see it themselves ({@link HEARSAY_STALENESS}).
 */
export function calloutAge(call: Callout, now: number): number {
  return Math.max(0, now - call.seenAt) * HEARSAY_STALENESS;
}

/**
 * Everything slot `id` can hear right now, oldest first.
 *
 * Three filters, in the order that matters:
 *
 *  1. **`readableAt <= now`** — the latency floor, and the reason seat order
 *     cannot reach a decision (module note, rule 1).
 *  2. **heard it** — the miss roll, drawn at send time from the sender's stream.
 *  3. **still fresh** — `calloutAge <= freshSeconds`, i.e. the *discounted* age,
 *     so a call expires on the receiver's own memory clock at twice the rate its
 *     own eyes would have expired it. Without this a call would keep firing until
 *     the ring evicted it, which is a siege that never ends.
 *
 * Sorted `(readableAt, from, seq)` — a total order with no ties, independent of
 * insertion, so a shuffled ring and a tidy one read identically.
 *
 * Returns the shared empty array when there is nothing to hear, which is almost
 * every tick: a quiet channel allocates nothing (GDD §4.3).
 */
export function receive(
  radio: TeamRadio | null,
  id: PlayerId,
  now: number,
  freshSeconds: number,
): readonly Callout[] {
  if (!radio || radio.calls.length === 0) return NO_CALLS;
  let out: Callout[] | null = null;
  for (const call of radio.calls) {
    if (call.readableAt > now) continue;
    if (!heard(call, id)) continue;
    if (calloutAge(call, now) > freshSeconds) continue;
    out ??= [];
    out.push(call);
  }
  if (out === null) return NO_CALLS;
  out.sort(compareCalls);
  return out;
}

/** The total order: delivery time, then sender, then sequence. No ties. */
function compareCalls(a: Callout, b: Callout): number {
  if (a.readableAt !== b.readableAt) return a.readableAt - b.readableAt;
  if (a.from !== b.from) return a.from - b.from;
  return a.seq - b.seq;
}
