/**
 * tests/net/online-radio.test.ts — **an online Teams match where one bot's `help`
 * reaches an ally's brain, and an FFA control showing nothing moved there.**
 * OWNER: Netcode Engineer (b2-02; `docs/team-bots-plan.md` §2, Stage 2; GDD §2.9,
 * §4.2).
 *
 * `tests/server/room-radio.test.ts` proves the room *wires* the channel: who is on
 * it, when it re-opens, what a lone bot gets. It files its callouts by hand,
 * because it is about the seating and not about the fighting. This file is the
 * other half, and it hand-writes nothing: a real room, real encoded frames, real
 * `MatchRoom.update` ticks, and a bot that decides **on its own** that it is in
 * trouble and says so — after which the assertions follow that sentence from the
 * caller's mouth to the ally's decision:
 *
 *   1. the caller files a `help` on its side's ring;
 *   2. it is NOT readable in the tick it was sent (the latency floor, which is
 *      what keeps seat order out of every decision — `src/bots/radio` rule 1);
 *   3. the ally reads it, through the ally's own brain;
 *   4. the ally's **ally-response latch names the caller**, and its behaviour is
 *      `defend-ally`. That is the chain that used to end at step 0 online.
 *
 * THE CONTROL, AND WHY IT IS A HASH
 * ---------------------------------------------------------------------------
 * The same room, the same seed, the same three characters, in **Free-for-All** —
 * hashed with the determinism replay's own fingerprint (`harness/hash.ts`, every
 * ship, rock, chunk, station, turret, shield, job and projectile) against a
 * literal measured on `origin/main`. A win-rate or a "no calls were filed" check
 * stays green through a real drift; this cannot. FFA is teams-of-one, every side
 * has one member, `teamRadio` answers `null`, and `send` on `null` draws no
 * random number — so the number below must not move, and if it ever does the
 * answer is to revert, not to re-baseline (the standing rule from
 * `src/bots/ffa-parity.test.ts`).
 *
 * The scene-setting in the Teams case (wounding a ship, parking an enemy on it,
 * standing the ally within response range) is the same instrument
 * `tests/net/online-teams.test.ts` uses: the arena puts the four homes far apart
 * on purpose, so a test about what two bots say to each other has to close the
 * distance itself. Nothing is mutated in the control.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ShipClass } from '@shared/types';
import type { PlayerId } from '@shared/types';
import { receive, tuningFor } from '../../src/bots';
import type { Callout, PersonalityId } from '../../src/bots';
import { encodeClientMessage } from '../../src/net/wire';
import type { WireFrame } from '../../src/net/wire';
import type { MatchMode, World } from '../../src/sim';
import { MatchServer } from '../../server/match-server';
import type { ServerSocket } from '../../server/match-server';
import type { MatchRoom } from '../../server/room';
import { hashState } from '../../harness/hash';
import { netBudget } from './budgets';

const EVIDENCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../evidence/b2-02-radio-seam');

/** The seed both halves run at — one number, so the Teams match and its FFA
 *  control differ in the mode and in nothing else. */
const SEED = 0x7ea3;

/** The cast, named rather than defaulted, so the latency and freshness numbers
 *  this file measures against are stated ones (GDD §2.9: the tier is shown, and
 *  it is the character's own). Seats 1, 2, 3 in order. */
const CAST: readonly PersonalityId[] = ['sable', 'warden', 'warden'];

/** Sim seconds the FFA control runs for. Long enough that every subsystem a bot
 *  touches has run many times — waves, mining, hauling, construction, turret
 *  fire, the first duels — and short enough that CI never notices. */
const CONTROL_SECONDS = 60;

/**
 * The FFA golden: the state hash after {@link CONTROL_SECONDS} of the room below,
 * measured on `origin/main` at ea7521f — *before* this branch — and re-measured
 * unchanged with b2-02 applied.
 *
 * **Do not re-baseline this.** It is the whole content of the claim "FFA did not
 * move": a served free-for-all runs the same match, tick for tick, with the team
 * channel in the room. A red here is a team-aware path reachable in FFA, and the
 * fix is to remove it (`src/bots/ffa-parity.test.ts`, rule 3).
 *
 * **`c37926e2` → `c5ad2324`, 2026-08-16, a0-58 (Gameplay lane — flagged for the
 * Netcode Engineer).** The one thing the paragraph above cannot mean is "the
 * simulation may never change again", and this is the first sim rule to land since
 * this number was written. a0-58 makes ore countable — every mint emits whole
 * `CHUNK.ore`, a hold moves in whole ore — so chunk counts and positions differ
 * from the first mined rock onward, in Teams and FFA alike, for reasons that have
 * nothing to do with a radio. What this literal is actually guarding is untouched
 * and still asserted: the three seats above still read `radio === null` at t0 and
 * a minute in, `send` on a null channel still draws no random number, and the new
 * value is stable across runs (measured twice). Re-baselined rather than reverted
 * for that reason only; a red here for any *other* reason still means revert.
 *
 * **`c5ad2324` → `53aa6f97`, 2026-08-16, a0-59 (Gameplay lane — flagged for the
 * Netcode Engineer).** Twice in one day, because a0-59 is stacked on a0-58 and the
 * developer ruled on the death drop hours after the mint. `DEATH_ORE_DROP_FRACTION`
 * goes 0.5 → 1 — *"destroyed ships should drop all their ore, no more 1/2 the ore
 * stuff"* — recorded as *"A destroyed ship drops EVERYTHING"* in
 * `docs/design-amendments.md`. Every death in the control match now lays down twice
 * the chunks, so the field diverges from the first kill onward, in Teams and FFA
 * alike, again for reasons with nothing to do with a radio. Everything this literal
 * guards is untouched and still asserted, and the new value was measured twice.
 * Same rule as above: re-baselined for this reason only; any *other* red still
 * means revert.
 *
 * **`53aa6f97` → `a83554a1`, 2026-08-18, a0-81 (Bot lane — flagged for the
 * Netcode Engineer).** The first of these three that is a change to the BOT
 * TREES rather than to the sim, so it is the one that has to answer rule 3
 * head-on instead of pointing at another lane. The rule: a bot's movement intent
 * and its fire intent are independent, so a retreating, hauling or banking bot
 * shoots at a hostile in range on the same terms a player has — ratified off the
 * developer's *"when rusty was fleeing from me he could have auto fired at me
 * but instead he didnt … thats what i would do"* (brief a0-81; audit in
 * `evidence/a0-81-fleeing-fire/audit.txt`).
 *
 * **Why this is not the thing rule 3 forbids.** Rule 3 catches a *team-aware
 * path reachable in FFA*: FFA is teams-of-one, so a branch that needs allies must
 * be unreachable there, and a moved hash is the proof it was reached. Nothing in
 * a0-81 is team-aware. The new `coveringFire` branches on `isTargetable` — the
 * single `hostile` stamp, true for every ship on an FFA board — and on nothing
 * about sides, radios or ally lists. It moves Teams and FFA by the identical
 * mechanism, which is what the two entries above are and the opposite of a leak.
 * What this literal actually guards is untouched and still asserted: the three
 * seats still read `radio === null` at t0 and a minute in, and `send` on a null
 * channel still draws no random number. New value measured twice, stable. Same
 * rule as above: any *other* red still means revert.
 *
 * **`a83554a1` → `9b587b0c`, 2026-08-21, a0-121 (Gameplay lane — flagged for the
 * Netcode Engineer).** The Excavator's `turnMul` moves 0.8 → 0.25: GDD §2.11's
 * stated penalty on the hull, retuned to the value that actually charges it
 * (`src/sim/constants.ts` `SHIP_STATS`, measured in
 * `tests/reports/a0-121-excavator.md`). Two of the control match's seats fly that
 * hull, so their noses reach a target later, their shots land on different ticks,
 * and the served field diverges from the first exchange onward — in Teams and FFA
 * alike, for reasons with nothing to do with a radio.
 *
 * **Why this is not the thing rule 3 forbids.** Rule 3 catches a *team-aware path
 * reachable in FFA*. A class-table cell is not team-aware: `shipTurnRate` reads
 * `SHIP_STATS[shipClass].turnMul` and nothing about sides, radios or ally lists,
 * and it moves Teams and FFA by the identical mechanism. The three seats still
 * read `radio === null` at t0 and a minute in, and `send` on a null channel still
 * draws no random number. New value measured twice, stable. Same rule as above:
 * any *other* red still means revert.
 *
 * **`9b587b0c` → `0c4ea31f`, 2026-08-22, a0-135 (Bot lane — flagged for the
 * Netcode Engineer).** The second entry here that is a change to the BOT TREES,
 * so it answers rule 3 head-on rather than pointing at another lane. The rule:
 * *a threatened home outranks self-preservation, at any hull fraction* — ratified
 * off the developer's *"protection of their base is essential to the game a
 * player would defend at all costs"* (brief a0-135; report in
 * `tests/reports/a0-135-home-defence.md`). `wantsRetreat`
 * (`src/bots/behaviors.ts`) now asks `ownHomeThreatened(ctx)` before it reads the
 * tier's nerve, and stands down when it holds. Every seat in the control match
 * owns a station and four stations sit inside one 2400-unit world, so the reading
 * flips for seats that used to run and the field diverges from the first
 * doorstep contact onward.
 *
 * **Why this is not the thing rule 3 forbids.** Rule 3 catches a *team-aware path
 * reachable in FFA*, and the honest worry here is real, because the two call
 * sites next door — `behaviors.ts:1213` and `:1427` — genuinely are team-aware:
 * they are the ALLY-defence paths, and they are untouched by this branch. What
 * this branch added is `:1829`, and it calls `ownHomeThreatened`, which reads
 * `ctx.self.station` — *this* bot's own doorstep, the seat's own alarm — and then
 * `homeIntruder`, which is `intruderNear` around that one point and branches on
 * the single `hostile` stamp, true for every ship on an FFA board. Sides, radios
 * and ally lists appear nowhere in it. It is also, by construction, not a NEW
 * path: `ownHomeThreatened` is the identical expression the trees' `defend` test
 * already used and has been reachable in FFA all along — this branch changed
 * which leaf wins above it, not whether the predicate can be evaluated with one
 * seat per side. What this literal actually guards is untouched and still
 * asserted: the three seats still read `radio === null` at t0 and a minute in,
 * and `send` on a null channel still draws no random number. New value measured
 * twice, stable. Same rule as above: any *other* red still means revert.
 */
const FFA_GOLDEN = '0c4ea31f';

/** A socket the room can write to. This file asserts on the room's own state and
 *  on its bots, never on what a client was told, so nothing is kept. */
class FakeSocket implements ServerSocket {
  send(_frame: WireFrame): void {
    /* the wire's content is `tests/net/online-teams.test.ts`'s subject */
  }
  close(): void {
    /* nothing to tear down in-process */
  }
}

/**
 * A started four-seat match: a human host in chair 0 and the three named
 * characters behind them, authored and started through the real front door —
 * `encodeClientMessage` → the server's own parser → `Room.receive`.
 */
function startedRoom(mode: MatchMode, teams: readonly number[]): MatchRoom {
  const server = new MatchServer({ seed: SEED, slots: 4, asteroidCount: 12 });
  server.update(1_000_000);
  const code = server.createCode();
  const host = server.connect(new FakeSocket());
  host.receive(encodeClientMessage({ type: 'join', room: code }));
  host.receive(
    encodeClientMessage({
      type: 'lobbyChoice',
      shipClass: ShipClass.Vanguard,
      fireMode: 'manual',
      seats: ['open', 'bot', 'bot', 'bot'],
      mode,
      teams: [...teams],
      botPersonalities: [...CAST],
      // **The economy this file was measured at, named out loud (n5-01).**
      //
      // The room used to have no abundance to pass, so `createWorld` fell back to
      // the pre-p11 `standard` baseline and every number in this file — the
      // golden below, and the Teams half's callout timeline — was measured
      // against that field. n5-01 gave `lobbyChoice` the level it was always
      // missing and made a room nobody prices open at the ratified SCARCE
      // default, so an unpriced control would now build a leaner field with
      // fewer rocks: a different world, and a different hash, for a reason that
      // has nothing to do with what this file tests.
      //
      // So the control states its own economy instead of inheriting the
      // product's. That keeps `FFA_GOLDEN` the literal measured on `origin/main`
      // — the header's "do not re-baseline this" holds character for character —
      // and it makes both halves immune to a QA retune of the ABUNDANCE table,
      // which would otherwise redden a test about team channels. The two halves
      // still differ in the mode and in nothing else.
      abundance: 'standard',
    }),
  );
  host.receive(encodeClientMessage({ type: 'startMatch' }));
  const room = server.room(code);
  if (!room?.world) throw new Error('the room never started');
  return room;
}

/** One ship, by seat. */
function shipOf(world: World, id: PlayerId): World['ships'][number] {
  const ship = world.ships.find((s) => s.id === id);
  if (!ship) throw new Error(`no ship in seat ${id}`);
  return ship;
}

/** Wall-clock ms per sim tick — the room turns elapsed real time into whole
 *  fixed 60 Hz ticks, so a test drives it by handing it time. */
const TICK_MS = 1000 / 60;

describe('an online Teams match carries a bot’s callout to its ally (b2-02)', () => {
  it('takes one bot’s help from its own mouth to its ally’s decision', () => {
    const room = startedRoom('teams', [0, 0, 1, 1]); // host + Sable vs two Wardens
    const world = room.world!;
    // The rocks are not the subject and a wave landing on the sightline would
    // decide this case by seed (`tests/net/online-teams.test.ts` clears them for
    // the same reason).
    world.asteroids.length = 0;

    const caller = room.botAt(2)!;
    const ally = room.botAt(3)!;
    expect(caller.brain.radio, 'the two Wardens are on a channel').not.toBeNull();
    expect(caller.brain.radio, 'and it is ONE channel').toBe(ally.brain.radio);
    expect(caller.brain.radio!.members).toEqual([2, 3]);

    const victim = shipOf(world, 2);
    const attacker = shipOf(world, 1); // Sable, on the other side
    const helper = shipOf(world, 3);

    // The scene: a Warden jumped in open space, an enemy on top of it, and its
    // teammate five hundred units away with no idea. **This is the case Layer A
    // cannot carry** — the klaxon rings for a *home*, and a teammate jumped in
    // the field has no klaxon (`src/bots/radio`).
    helper.pos.x = victim.pos.x + 500;
    helper.pos.y = victim.pos.y + 200;
    helper.spawnProtect = 0;

    const fresh = tuningFor(ally.seat.personality).memorySeconds;
    let spoke: Callout | null = null;
    let spokeAt = -1;
    let heardAt = -1;
    let answeredAt = -1;
    let quietWhenSent = false;

    let nowMs = 1_000_000;
    for (let tick = 0; tick < 600 && answeredAt < 0; tick++) {
      // Held wounded and held under threat: a bot that healed or lost sight of
      // its attacker would stop wanting to break off, and this case would be
      // about the flee latch instead of about the radio.
      victim.hull = 1;
      victim.spawnProtect = 0;
      attacker.spawnProtect = 0;
      attacker.pos.x = victim.pos.x + 120;
      attacker.pos.y = victim.pos.y;
      attacker.vel.x = 0;
      attacker.vel.y = 0;

      nowMs += TICK_MS;
      room.update(nowMs);
      const ring = caller.brain.radio!;

      if (!spoke && ring.calls.length > 0) {
        spoke = ring.calls[0]!;
        spokeAt = world.time;
        // (2) Sent, and NOT readable yet — the latency floor. Read on the very
        // tick it was filed, which is the only tick where a broken floor shows.
        quietWhenSent = receive(ring, ally.seat.id, world.time, fresh).length === 0;
      }
      if (spoke && heardAt < 0 && receive(ring, ally.seat.id, world.time, fresh).length > 0) {
        heardAt = world.time;
      }
      if (ally.brain.allyResponse.target >= 0) answeredAt = world.time;
    }

    // (1) The caller said it, itself: a `help` about its own ship, at its own
    // position — the one thing that is legal to send under any fog.
    expect(spoke, 'the wounded bot called for help').not.toBeNull();
    expect(spoke!.kind).toBe('help');
    expect(spoke!.from).toBe(2);
    expect(spoke!.about).toBe(2);

    // (2) …and nobody could read it in the tick it was sent.
    expect(quietWhenSent, 'no callout is readable in the tick it was sent').toBe(true);
    expect(spoke!.readableAt).toBeCloseTo(
      spoke!.seenAt + tuningFor(caller.seat.personality).callLatency,
      6,
    );

    // (3) The ally heard it, through its own brain's channel.
    expect(heardAt, 'the ally heard the call').toBeGreaterThan(0);
    const heard = receive(ally.brain.radio, ally.seat.id, heardAt, fresh);
    expect(heard.map((c) => c.kind)).toEqual(['help']);
    expect(heard[0]!.from).toBe(2);
    expect(heard[0]!.pos).toEqual(spoke!.pos);

    // (4) …and acted on it. The latch names the caller, which is what "reaches an
    // ally's brain" means when you say it in code.
    expect(answeredAt, 'the ally answered').toBeGreaterThan(0);
    expect(ally.brain.allyResponse.target).toBe(2);
    expect(ally.brain.lastBehavior).toBe('defend-ally');

    // The enemy side heard none of it — a different side is a different ring.
    const enemy = room.botAt(1)!;
    expect(enemy.brain.radio).toBeNull(); // Sable's only ally is the human host
    expect(receive(enemy.brain.radio, 1, world.time, fresh)).toHaveLength(0);

    // --- The readback the PR carries --------------------------------------
    const readback = {
      brief: 'b2-02',
      what: 'a served Teams match carries one bot’s help call to its ally’s decision',
      seed: SEED,
      cast: CAST,
      teams: [0, 0, 1, 1],
      channel: {
        members: [...caller.brain.radio!.members],
        sharedObject: caller.brain.radio === ally.brain.radio,
        // The human's ally is a bot with nobody to talk to — the parity rule
        // (`server/room.ts` `wireRadios`): a human's seat is not a member,
        // because `send` spends the sender's seeded stream per member and an
        // online bot must not fight differently than the same offline lineup.
        loneBotOnTheOtherSide: room.botAt(1)!.brain.radio === null,
      },
      timeline: {
        call: { kind: spoke!.kind, from: spoke!.from, about: spoke!.about, seenAt: spoke!.seenAt },
        sentAtSeconds: spokeAt,
        readableAtSeconds: spoke!.readableAt,
        heardAtSeconds: heardAt,
        answeredAtSeconds: answeredAt,
        latencySeconds: tuningFor(caller.seat.personality).callLatency,
        readableInTheTickItWasSent: !quietWhenSent,
      },
      allyDecision: {
        target: ally.brain.allyResponse.target,
        behavior: ally.brain.lastBehavior,
      },
      // What this same match did before b2-02: the room seated its bots one at a
      // time, so every one of them took `createBot`'s `radio: null` and this whole
      // timeline was a single silence.
      beforeB2_02: { everyBotsRadio: null, callsHeard: 0, allyResponses: 0 },
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(`${EVIDENCE_DIR}/readback.json`, `${JSON.stringify(readback, null, 2)}\n`);
  }, netBudget({
    work: 'stand a four-seat room up through the wire → RUSH! → wound a Warden under an enemy → tick the room until it calls for help, its ally hears it and answers → write the readback',
    measuredSeconds: 0.02,
  }));

  it('changes nothing in a served FFA match — the same seed, hashed', () => {
    // Teams-of-one: seat 0 is the host, and seats 1..3 each fight for themselves.
    const room = startedRoom('ffa', [0, 1, 2, 3]);
    const world = room.world!;

    for (const seat of [1, 2, 3]) {
      expect(room.botAt(seat)!.brain.radio, `seat ${seat} has nobody to talk to`).toBeNull();
    }

    let nowMs = 1_000_000;
    for (let tick = 0; tick < CONTROL_SECONDS * 60; tick++) room.update((nowMs += TICK_MS));
    expect(world.time).toBeCloseTo(CONTROL_SECONDS, 1);

    // Still silent a minute in: a channel that appeared mid-match — on a
    // substitution, on a rewire — would show up here as well as in the hash.
    for (const seat of [1, 2, 3]) {
      const bot = room.botAt(seat);
      if (bot) expect(bot.brain.radio, `seat ${seat} stayed on its own side`).toBeNull();
    }

    expect(hashState(world), 'the served FFA match is the one that shipped').toBe(FFA_GOLDEN);
  }, netBudget({
    work: 'stand the same room up in FFA → RUSH! → 60 sim seconds of a four-station free-for-all through the room’s own update loop → hash the world',
    measuredSeconds: 0.21,
  }));
});
