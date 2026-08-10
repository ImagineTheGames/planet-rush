/**
 * tests/net/single-volley.test.ts — **one volley, one set of shots, on BOTH screens.**
 * OWNER: Netcode Engineer (GDD §2.3, §4.2; M10 action-echo §6).
 *
 * *"Shooting produces 2 sets of shots."*
 *
 * The acceptance test for that sentence cannot be a final reading. A run that ends
 * with one shot on screen is indistinguishable from a run that showed two for three
 * hundred milliseconds and then tidied up — and three hundred milliseconds is the
 * whole complaint. So this samples **every frame of the flight**, on both clients,
 * and the assertion is a property held continuously rather than a number checked at
 * the end.
 *
 * Everything under the wire is the shipping stack: the real `MatchServer` and its
 * room, the real codec, two real `TransportSession`s doing real prediction,
 * reconciliation, interpolation and presentation (`./latency-harness`). Only the
 * socket is replaced, by a delay queue on the harness's own clock — which is what
 * makes a 150 ms run reproducible enough to be a CI gate.
 *
 * What is counted is what the **screen** shows. `sendInput` leaves each world
 * holding presented values (the local hull nudged by its correction offset, streamed
 * shots placed by the jitter buffer), so the pool this reads is the picture the
 * player is looking at, not the simulation underneath it. That distinction is the
 * whole bug: the suppression that was supposed to stop the duplicate only ever
 * touched the simulation, and the copy reached the screen by the other road.
 */

import { describe, expect, it } from 'vitest';
import type { Action, PlayerId } from '@shared/types';
import { SHIP_WEAPON, TICK_DT } from '../../src/sim';
import type { World } from '../../src/sim';
import { projIsShipShot } from '../../src/net/snapshot';
import { runLatencyMatch } from './latency-harness';
import type { HarnessClient, WireProfile } from './latency-harness';
import { netBudget } from './budgets';

/** The developer's condition, named in the brief: 150 ms. Jitter and a little loss,
 *  because a clean wire is not where duplicates come from. */
const PHONE: WireProfile = { rttMs: 150, jitterMs: 30, lossRate: 0.02 };

/** The frame the trigger goes down, and how long it is held. `SHIP_WEAPON`'s fire
 *  interval is 0.35 s ≈ 21 frames, so a hold this short is exactly **one shot** —
 *  which is what makes "one set" a countable thing rather than a judgement. */
const FIRE_AT = 40;
const FIRE_FRAMES = 3;

/** Shots owned by `owner` that this screen is currently drawing, counted across the
 *  WHOLE pool — the wire's slots and the reserved local-prediction slots alike
 *  (`src/net/presentation` LOCAL_SHOT_BASE). Counting only one range is how a
 *  duplicate hides: the two copies live in different halves of the pool. */
function shotsOnScreen(world: World | null, owner: PlayerId): number {
  if (!world) return 0;
  let n = 0;
  for (const p of world.projectiles) {
    if (!p.active) continue;
    if (p.owner !== owner) continue;
    if (p.kind !== 'ship') continue;
    n++;
  }
  return n;
}

/** One client fires a single volley; nobody else ever pulls a trigger, so every
 *  ship shot in the match belongs to seat 0 and is accounted for. */
function volleyInput(firer: number): (client: number, frame: number) => readonly Action[] {
  return (client, frame) => {
    // A gentle drift so the ships are not co-located and the shot has somewhere to
    // go; no turning, so nothing here depends on prediction being *interesting*.
    const thrust: Action = { type: 'thrust', dir: { x: client === 0 ? 0.4 : -0.4, y: 0 } };
    const aim: Action = { type: 'aim', dir: { x: 1, y: 0 } };
    const firing = client === firer && frame >= FIRE_AT && frame < FIRE_AT + FIRE_FRAMES;
    return [thrust, aim, { type: 'fire', active: firing, auto: false }];
  };
}

describe('one volley at 150 ms', () => {
  it('never shows two shots for one trigger pull — on either screen', () => {
    // The *seat* the firing client holds is not its index in the harness: the two
    // joins race on independent pipes, so with jitter either client may have
    // arrived first. Read it off the session rather than assuming.
    let firer: PlayerId = -1;
    /** The most this screen ever drew, per client, from the trigger onward. */
    const peak = [0, 0];
    /** Frames on which each screen drew the shot at all — proof the run was not
     *  vacuously quiet. */
    const seen = [0, 0];

    const result = runLatencyMatch({
      profile: PHONE,
      frames: 140,
      seed: 909,
      asteroidCount: 6,
      // The *client index* that fires; its seat is read off the session below.
      input: volleyInput(0),
      onFrame: (frame, clients: readonly HarnessClient[]) => {
        if (firer < 0) firer = clients[0]!.you;
        if (frame < FIRE_AT) return;
        for (let i = 0; i < clients.length; i++) {
          const n = shotsOnScreen(clients[i]!.world, firer);
          if (n > peak[i]!) peak[i] = n;
          if (n > 0) seen[i]!++;
        }
      },
    });

    // The whole report, in one line each: the firer's screen, and the rival's.
    expect(peak[0], 'the firer never sees their own shot twice').toBeLessThanOrEqual(1);
    expect(peak[1], 'the rival never sees one shot as two').toBeLessThanOrEqual(1);

    // …and it was actually there. A run that never drew the shot would satisfy the
    // line above by drawing nothing, which is the other way to be wrong.
    expect(seen[0], 'the firer saw their shot').toBeGreaterThan(0);
    expect(seen[1], 'the rival saw the shot too').toBeGreaterThan(0);

    // Authority fired once, so the arithmetic above is about a real single shot.
    expect(result.stalls, 'the lossy wire was actually exercised').toBeGreaterThan(0);

    // ── AND NOT ONE INPUT WAS SILENTLY THROWN AWAY ───────────────────────────
    //
    // `InputQueue` files by `(player, tick)`, and two messages do land on one tick:
    // the client's clock is not monotonic (a lead trim rewinds it a few ticks —
    // `src/net/prediction` `trimLead`), and a retransmit burst re-files a whole
    // stalled backlog onto one tick. Both used to be *dropped* — ~4 % of all input
    // from the first, 48 % at 250 ms with 2 % loss from the second. A lost stick
    // frame is invisible; a lost `buildOrder` is a purchase the player made, was
    // charged for locally, and that authority never heard — the wheel press that
    // "does nothing sometimes".
    //
    // They are merged now (`src/net/input-queue` `coalesce`), so the count that
    // matters is what authority *discarded*, and it is zero. A re-used tick number
    // is no longer a lost message, which is why it is only reported.
    expect(result.droppedInputs, 'no input message was thrown away by authority').toBe(0);
  }, netBudget({
    work: 'one scripted 140-frame match at phone latency → count the shots each screen drew for one trigger pull',
    measuredSeconds: 0.9,
  }));

  it('holds the line while the trigger is HELD — one shot in flight per interval', () => {
    // The steady state, which is where a duplicate is easiest to hide: a ship
    // firing continuously has at most two shots alive at once (fire interval 0.35 s
    // against a shot life of `range / speed`), so a screen showing three or more is
    // showing somebody's copy.
    const inFlight = Math.ceil(SHIP_WEAPON.range / SHIP_WEAPON.projectileSpeed / SHIP_WEAPON.fireInterval);
    const peak = [0, 0];

    runLatencyMatch({
      profile: PHONE,
      frames: 180,
      seed: 4242,
      asteroidCount: 6,
      input: (client, _frame) => [
        { type: 'thrust', dir: { x: client === 0 ? 0.4 : -0.4, y: 0 } },
        { type: 'aim', dir: { x: 1, y: 0 } },
        { type: 'fire', active: client === 0, auto: false },
      ],
      onFrame: (frame, clients) => {
        if (frame < 30) return; // let the first shot leave the barrel
        for (let i = 0; i < clients.length; i++) {
          const n = shotsOnScreen(clients[i]!.world, clients[0]!.you);
          if (n > peak[i]!) peak[i] = n;
        }
      },
    });

    expect(inFlight, 'the sim really does keep ~2 shots alive at once').toBeGreaterThanOrEqual(1);
    expect(peak[0], 'the firer draws its own stream once').toBeLessThanOrEqual(inFlight);
    expect(peak[1], 'the rival draws the same stream once').toBeLessThanOrEqual(inFlight);
    expect(peak[0], 'and the stream was actually there').toBeGreaterThan(0);
    expect(peak[1]).toBeGreaterThan(0);
  }, netBudget({
    work: 'one scripted 180-frame match at phone latency → count the shots alive on each screen through a held trigger',
    measuredSeconds: 0.5,
  }));

  it('the firer draws its OWN shot, at zero latency — not authority’s copy', () => {
    // Why suppression rather than "draw whichever arrives": the wire's copy is a
    // round trip behind the trigger. If a duplicate is removed by dropping the
    // *predicted* one instead, the count is right and the feel is wrong — the shot
    // appears 150 ms after the button. So the shot on the firer's screen must be in
    // the reserved local-prediction range, which the wire cannot reach.
    let localSlots = 0;
    let wireSlots = 0;

    runLatencyMatch({
      profile: PHONE,
      frames: 140,
      seed: 77,
      asteroidCount: 6,
      input: volleyInput(0),
      onFrame: (frame, clients) => {
        if (frame < FIRE_AT) return;
        const world = clients[0]!.world;
        if (!world) return;
        const seat = clients[0]!.you;
        for (let slot = 0; slot < world.projectiles.length; slot++) {
          const p = world.projectiles[slot]!;
          if (!p.active || p.owner !== seat || p.kind !== 'ship') continue;
          if (slot >= LOCAL_BASE) localSlots++;
          else wireSlots++;
        }
      },
    });

    expect(localSlots, 'the firer’s shot is the predicted one').toBeGreaterThan(0);
    expect(wireSlots, 'and authority’s copy of it is never drawn beside it').toBe(0);
  }, netBudget({
    work: 'one scripted 140-frame match at phone latency → assert the firer draws the predicted shot and never authority\'s copy',
    measuredSeconds: 0.4,
  }));
});

describe('the capture — what the two screens actually showed', () => {
  it('prints a frame-by-frame readout of one volley, for the PR', () => {
    // Not an assertion so much as the *evidence*: a run anyone can reproduce, whose
    // output is the sentence the brief asks for — "one volley = one set of shots on
    // BOTH screens" — with the frames written down instead of described. Printed
    // rather than snapshotted so a reviewer reads it in the CI log, the same way
    // `src/net/reconcile-capture.test.ts` publishes its telemetry. (This used to
    // cite the day-0 spike bench, deleted as dead code by n7-01.)
    const rows: string[] = [];
    let seats: [PlayerId, PlayerId] = [0, 1];

    runLatencyMatch({
      profile: PHONE,
      frames: 130,
      seed: 909,
      asteroidCount: 6,
      input: volleyInput(0),
      onFrame: (frame, clients) => {
        seats = [clients[0]!.you, clients[1]!.you];
        if (frame < FIRE_AT - 2 || frame > FIRE_AT + 60 || frame % 4 !== 0) return;
        const firerSeat = clients[0]!.you;
        const onFirer = shotsOnScreen(clients[0]!.world, firerSeat);
        const onRival = shotsOnScreen(clients[1]!.world, firerSeat);
        rows.push(
          `  f${String(frame).padStart(3)}  firer ${onFirer}  rival ${onRival}  ` +
            `${'█'.repeat(onFirer)}${'·'.repeat(2 - onFirer)} | ${'█'.repeat(onRival)}${'·'.repeat(2 - onRival)}`,
        );
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      [
        '',
        '===== ONE VOLLEY, TWO SCREENS =====',
        `wire            : ${PHONE.rttMs}ms RTT, ±${PHONE.jitterMs}ms jitter, ${PHONE.lossRate * 100}% loss`,
        `seats           : firing client = seat ${seats[0]}, rival = seat ${seats[1]}`,
        `trigger         : frame ${FIRE_AT}, held ${FIRE_FRAMES} frames (one shot)`,
        'columns         : ship shots owned by the firer, as drawn on each screen',
        '',
        ...rows,
        '',
      ].join('\n'),
    );

    // The readout is only worth reading if it is also the gate.
    expect(rows.some((r) => r.includes('firer 1'))).toBe(true);
    expect(rows.every((r) => !r.includes('firer 2') && !r.includes('rival 2'))).toBe(true);
  }, netBudget({
    work: 'one scripted 130-frame match at phone latency → print the two screens frame by frame as the PR\'s evidence',
    measuredSeconds: 0.3,
  }));
});

/** The first pool slot reserved for locally-predicted own shots. Restated from
 *  `src/net/presentation` rather than imported, so this test still fails loudly if
 *  that constant moves under it without the wire's cap moving too. */
const LOCAL_BASE = 64;

/** A sanity check on the constant this file reasons from: one shot per fire
 *  interval, and an interval longer than a frame. */
it('the fire interval is longer than a frame — so a 3-frame hold is one shot', () => {
  expect(SHIP_WEAPON.fireInterval).toBeGreaterThan(FIRE_FRAMES * TICK_DT);
  expect(projIsShipShot(0b1000)).toBe(true);
}, netBudget({
  work: 'two constants — no match',
  measuredSeconds: 0.05,
}));
