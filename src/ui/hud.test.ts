/**
 * src/ui/hud.test.ts — what the HUD SAYS about a pickup. OWNER: UI Engineer.
 *
 * ── a0-54 ───────────────────────────────────────────────────────────────────
 * The developer, 2026-08-16: *"Sometimes I am picking up more than one ore,
 * like, I'm picking up two, but it only registers as one on my cargo."*
 *
 * a0-08 established that no ore is ever lost — the ledger conserves exactly, and
 * a hold with room for 1 takes 1 of a 2-ore chunk and leaves 1 floating for
 * anyone (GDD §2.3). a0-52's ore journal re-confirmed it from a real match: 117
 * chunk pickups, every one at `min(chunk.amount, room)`, no mismatch. So the sim
 * is not the bug. **The bug is that the game never said why**, and these tests
 * pin the sentence it now says.
 *
 * They are deliberately driven by the REAL SIM rather than by hand-made numbers:
 * `createWorld` + a real `step` produce the `lootTake` / `lootOffered` pair, and
 * the HUD's own decision module ({@link ./loot-tell}) turns that pair into the
 * line. A test that fed the model `(1, 2)` directly would still pass if the sim
 * stopped publishing the offer, which is the regression that matters most.
 *
 * The Pixi half of the HUD (the two Texts, their placement under the hold pips)
 * is not exercised here: `Hud.update` measures text, which needs a DOM. Its
 * decision logic is this file's, its geometry is `hud-geometry.test.ts`'s, and
 * its pixels are the golden/live-stage suites' — the same split every other
 * element in this directory keeps.
 */

import { describe, expect, it } from 'vitest';
import { ShipClass } from '../shared/types';
import { TICK_DT, createWorld, step } from '../sim';
import type { PlayerSpec, Ship, World } from '../sim';
import type { LobbySlot, ServerMessage } from '../net/transport';
import { Hud } from './hud';
import {
  LOOT_TELL_SECONDS,
  LootTellLatch,
  leftNumeral,
  partialTake,
} from './loot-tell';
import {
  PRESENCE_MAX_LINES,
  PRESENCE_TELL_SECONDS,
  PeerPresenceLog,
  applyPresenceMessage,
} from './peer-presence';
import { CONTENT_MAX_ASPECT } from './viewport';
import { HUD_PAD, presenceBand, waveClockLayout, wheelBounds } from './hud-geometry';
import { collapsedRect } from './minimap';
import { resolveAnchor, rectContains } from '@platform/layout-registry';

/**
 * A lone ship parked mid-arena with a hand-placed hold, clear of its own
 * atmosphere drain — the cockpit moment the report describes. One player, so
 * nothing else in the world can reach the chunk we put down.
 */
function staged(cargo: number): { world: World; ship: Ship } {
  const players: PlayerSpec[] = [{ id: 0, shipClass: ShipClass.Vanguard }];
  const world = createWorld({ seed: 11, players });
  const ship = world.ships[0]!;
  ship.pos = { x: world.bounds.width / 2, y: world.bounds.height / 2 };
  ship.vel = { x: 0, y: 0 };
  ship.spawnProtect = 0;
  ship.cargo = cargo;
  // The base hold, unupgraded — the number the report was flown on (GDD §2.5,
  // `CARGO_BASE`). Asserted rather than assumed: the whole reproduction is about
  // this cap, so a balance change to it should fail here loudly.
  expect(ship.cargoCap).toBe(2);
  return { world, ship };
}

/** Drop a chunk of `amount` ore on the ship and run the real step until it is
 *  collected (or the tractor gives up). Returns the tick's tells. */
function collect(world: World, ship: Ship, amount: number): { taken: number; offered: number } {
  world.chunks.push({
    id: world.nextEntityId++,
    pos: { x: ship.pos.x, y: ship.pos.y },
    vel: { x: 0, y: 0 },
    amount,
    radius: 6,
  });
  const park = { x: ship.pos.x, y: ship.pos.y };
  for (let i = 0; i < 120; i++) {
    step(world, [], TICK_DT);
    ship.vel = { x: 0, y: 0 };
    ship.pos = { x: park.x, y: park.y };
    if ((ship.lootTake ?? 0) > 0) {
      return { taken: ship.lootTake ?? 0, offered: ship.lootOffered ?? 0 };
    }
  }
  return { taken: 0, offered: 0 };
}

describe('a0-54 — the HUD on a pickup that came up short', () => {
  it('a partial take says so', () => {
    // The report, staged exactly: a hold of 2 carrying 1, flown into 2 ore.
    const { world, ship } = staged(1);
    const { taken, offered } = collect(world, ship, 2);

    // What the SIM did — the ratified rule, unchanged by this branch: room was 1,
    // 2 was on the table, 1 arrived and 1 stayed in the chunk for anyone.
    expect(taken).toBe(1);
    expect(offered).toBe(2);
    expect(ship.cargo).toBe(ship.cargoCap);
    expect(world.chunks.reduce((s, c) => s + c.amount, 0)).toBeCloseTo(1, 9);

    // What the HUD now SAYS about it — one line, the reason and the ore left.
    const tell = partialTake(taken, offered);
    expect(tell, 'a partial take must produce a tell').not.toBeNull();
    expect(tell!.taken, 'the tell reports the 1 that arrived').toBe(1);
    expect(tell!.left, 'and the 1 that was left behind').toBe(1);
    expect(tell!.text).toBe('HOLD FULL · 1 LEFT');
    // The reason leads, per the clarity rule (style-guide §8 / GDD §4.7 — "a
    // refusal names its reason in the first three words").
    expect(tell!.text.startsWith('HOLD FULL')).toBe(true);
    expect(tell!.reason).toBe('HOLD FULL');
    expect(tell!.count).toBe('1 LEFT');
  });

  it('a FULL take says nothing — a line on every pickup is a line nobody reads', () => {
    // Room for 2, exactly 2 offered: the whole chunk fits, nothing is left, and
    // the HUD is silent. This is the guard on the tell's own value — a message
    // that fires on every pickup teaches the player to stop reading it.
    const { world, ship } = staged(0);
    const { taken, offered } = collect(world, ship, 2);
    expect(taken).toBe(2);
    expect(offered).toBe(2);
    expect(world.chunks.length, 'nothing was left floating').toBe(0);
    expect(partialTake(taken, offered)).toBeNull();

    // …and the same with room to spare, which is the ordinary case: 2 slots free,
    // 1 ore offered.
    const roomy = staged(0);
    const one = collect(roomy.world, roomy.ship, 1);
    expect(one.taken).toBe(1);
    expect(one.offered).toBe(1);
    expect(partialTake(one.taken, one.offered)).toBeNull();
  });

  it('a tick that collected nothing is silent, and so is a hold that never filled', () => {
    // No chunk, no tells: the sim clears both every tick, so an idle frame feeds
    // the HUD (0, 0) and must not latch anything.
    const { world, ship } = staged(1);
    step(world, [], TICK_DT);
    expect(partialTake(ship.lootTake ?? 0, ship.lootOffered ?? 0)).toBeNull();
    expect(partialTake(0, 0)).toBeNull();
  });

  it('a FULL hold that refuses a chunk outright is not this tell (it takes nothing)', () => {
    // The neighbouring case, pinned so the boundary is deliberate: a hold with no
    // room never even pulls the chunk (GDD §2.3, `lootBlocked`), so no take
    // happens and nothing is offered — `lootOffered > lootTake` is false and this
    // line stays down. The full-hold pip flash is what speaks there.
    const { world, ship } = staged(2);
    const { taken, offered } = collect(world, ship, 1);
    expect(taken).toBe(0);
    expect(offered).toBe(0);
    expect(ship.lootBlocked).toBe(true);
    expect(partialTake(taken, offered)).toBeNull();
  });

  it('two chunks landing on one tick are compared as sums, not one by one', () => {
    // `lootTake`/`lootOffered` both accumulate across a tick, so a hold with room
    // for 1 that meets two 1-ore chunks in the same step reads 1 taken of 2
    // offered — one line about the tick, not two about the chunks.
    expect(partialTake(1, 2)!.text).toBe('HOLD FULL · 1 LEFT');
    expect(partialTake(2, 2)).toBeNull();
  });
});

describe('a0-54 — how the leftover is written', () => {
  it('is whole ore, and never rounds away to nothing', () => {
    // Ore is whole everywhere the player reads it, but a chunk need not be:
    // mining chips land fractional and a wreck's last piece is a remainder. A
    // decimal is unreadable in a one-second glance and `0 LEFT` would be false —
    // something IS still out there. Same rule the repair wedge already ships.
    expect(leftNumeral(1)).toBe(1);
    expect(leftNumeral(2.4)).toBe(2);
    expect(leftNumeral(0.37)).toBe(1);
    expect(leftNumeral(1e-6)).toBe(1);
    expect(partialTake(1.3666, 2.3666)!.text).toBe('HOLD FULL · 1 LEFT');
  });

  it('forgives float slack, never a real ore', () => {
    // A hold that lands a hair short of the chunk through float is not a partial
    // take, and must not fire a tell over 1e-12 of an ore.
    expect(partialTake(2, 2 + 1e-12)).toBeNull();
    expect(partialTake(2, 2.5)).not.toBeNull();
  });

  it('ignores nonsense rather than drawing it', () => {
    expect(partialTake(Number.NaN, 2)).toBeNull();
    expect(partialTake(1, Number.POSITIVE_INFINITY)).toBeNull();
    expect(partialTake(-1, 2)).toBeNull();
    expect(partialTake(0, 0)).toBeNull();
  });
});

describe('a0-54 — the line stands long enough to read, then goes', () => {
  it('holds a one-tick pulse on screen and fades out', () => {
    const latch = new LootTellLatch();
    expect(latch.read(0)).toBeNull();

    latch.note(1, 2, 10);
    expect(latch.read(10)!.text).toBe('HOLD FULL · 1 LEFT');
    expect(latch.read(10)!.alpha).toBe(1);

    // Still up — and still fully legible — a beat later, though the sim cleared
    // its tells 60 ticks ago.
    latch.note(0, 0, 10 + TICK_DT);
    expect(latch.read(10 + 0.5)).not.toBeNull();
    expect(latch.read(10 + 0.5)!.alpha).toBe(1);

    // Leaving, then gone.
    const leaving = latch.read(10 + LOOT_TELL_SECONDS * 0.9)!;
    expect(leaving.alpha).toBeGreaterThan(0);
    expect(leaving.alpha).toBeLessThan(1);
    expect(latch.read(10 + LOOT_TELL_SECONDS)).toBeNull();
    expect(latch.read(10 + 60)).toBeNull();
  });

  it('is a second, not a modal — nothing survives into the next fight', () => {
    expect(LOOT_TELL_SECONDS).toBeGreaterThan(0.5);
    expect(LOOT_TELL_SECONDS).toBeLessThanOrEqual(1.5);
  });

  it('a fresh partial replaces the standing one rather than queueing', () => {
    const latch = new LootTellLatch();
    latch.note(1, 2, 5);
    latch.note(1, 3, 5.4);
    expect(latch.read(5.4)!.text).toBe('HOLD FULL · 2 LEFT');
    // …and the clock restarts with it, so the newest fact gets a full read.
    expect(latch.read(5.4 + LOOT_TELL_SECONDS * 0.9)).not.toBeNull();
  });

  it('drops the line when the clock goes backwards (a rematch) and on clear()', () => {
    const latch = new LootTellLatch();
    latch.note(1, 2, 90);
    expect(latch.read(0)).toBeNull();
    latch.note(1, 2, 90);
    latch.clear();
    expect(latch.read(90)).toBeNull();
  });
});

describe('a0-54 — the HUD carries the seam that says it', () => {
  it('starts with no line up, and exposes it for the debug stage', () => {
    // The Pixi HUD cannot draw headless (text measurement needs a DOM), but the
    // seam a live-stage test reads is asserted here so it cannot quietly vanish.
    const hud = new Hud(1280, 720);
    expect(typeof hud.debugLootTell).toBe('function');
    expect(hud.debugLootTell()).toBeNull();
  });
});

/**
 * ── a0-74 ───────────────────────────────────────────────────────────────────
 * The developer, on their own display:
 *
 * > *"on pc we also need a way to handle UI locations because i have an ultra
 * > wide and all that UI goes to the edges of the screens"*
 *
 * The HUD is bound to a centred content box (`./viewport` `contentBox`) rather
 * than to the raw viewport, and the world renders full-bleed behind it. These
 * assertions are on the *placements* `Hud.layout` computes — exact numbers, and
 * readable headless, where a `Text` has no canvas to measure itself against.
 */
describe('a0-74 — the HUD is bound to a content box', () => {
  it('the HUD stays reachable on an ultrawide', () => {
    const W = 3840;
    const H = 1080; // 32:9 — the widest shape the second report is about
    const hud = new Hud(W, H);
    const box = hud.debugContentBox();

    // The box is real: a centred 16:9 region, with the extra 1920 px of width
    // left to the world behind it.
    expect(box.width).toBeCloseTo(H * CONTENT_MAX_ASPECT, 6);
    expect(box.width).toBeLessThan(W);
    expect(box.x).toBeCloseTo((W - box.width) / 2, 6);
    expect(box.height).toBe(H);

    const anchors = hud.debugChromeAnchors();
    expect(anchors.map((a) => a.id)).toEqual([
      'ore-hud',
      'wave-clock',
      'station-hp',
      'controls-strip',
      'onboarding',
    ]);

    for (const a of anchors) {
      // INSIDE THE BOX — the assertion the whole brief turns on.
      expect(a.x).toBeGreaterThanOrEqual(box.x);
      expect(a.x).toBeLessThanOrEqual(box.x + box.width);
      // …and NOT AT THE VIEWPORT EDGE, which is the thing that was wrong. Each
      // corner element clears the physical edge by the gutter (960 px) — a
      // placement that merely stayed on screen would satisfy the line above.
      expect(a.x).toBeGreaterThan(box.x - 1);
      expect(W - a.x).toBeGreaterThan(box.x - 1);
    }

    // Named individually, because "inside the box" is satisfied by a bug that
    // piles every element in the middle. Each is where the box's own corner is.
    const byId = new Map(anchors.map((a) => [a.id, a]));
    expect(byId.get('ore-hud')?.x).toBeCloseTo(box.x + HUD_PAD, 6);
    expect(byId.get('station-hp')?.x).toBeCloseTo(box.x + box.width - HUD_PAD, 6);
    expect(byId.get('controls-strip')?.x).toBeCloseTo(box.x, 6);
    // The centred pair are unchanged by construction — a centred box has the
    // screen's own middle, which is also where the follow camera holds the ship.
    expect(byId.get('wave-clock')?.x).toBeCloseTo(W / 2, 6);
    expect(byId.get('onboarding')?.x).toBeCloseTo(W / 2, 6);

    // The minimap is the element the report names first ("all that UI"). It is
    // laid out in the box and shifted onto it, so its drawn rect is inside too.
    const map = collapsedRect({ width: box.width, height: box.height }, false);
    const drawn = { ...map, x: map.x + box.x };
    expect(drawn.x).toBeGreaterThanOrEqual(box.x);
    expect(drawn.x + drawn.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
    expect(W - (drawn.x + drawn.width)).toBeGreaterThan(900); // clear of the edge

    // Every declared anchor still resolves inside its layout-registry region —
    // binding to the box moves elements INWARD, so nothing can leave the zone it
    // registers under (`@platform/layout-registry`). Asserted rather than argued.
    const zone = resolveAnchor({ region: 'bottom-right', margin: 0 }, { width: W, height: H });
    expect(rectContains(zone, drawn)).toBe(true);
  });

  it('changes nothing at all on 16:9 and narrower — every phone included', () => {
    // The floor is what makes this true for phones, which are *wider* than 16:9
    // in landscape (844×390 is aspect 2.16) and have no width to give away.
    for (const vp of [
      { width: 1280, height: 800 }, // the golden suite's desktop control
      { width: 1280, height: 720 }, // the HUD's own reference frame
      { width: 844, height: 390 }, // landscape phone
      { width: 390, height: 844 }, // portrait phone
    ]) {
      const hud = new Hud(vp.width, vp.height);
      expect(hud.debugContentBox()).toEqual({ x: 0, y: 0, width: vp.width, height: vp.height });
      const byId = new Map(hud.debugChromeAnchors().map((a) => [a.id, a]));
      // The pre-a0-74 numbers, spelled out: the screen's own corners.
      expect(byId.get('ore-hud')?.x).toBe(HUD_PAD);
      expect(byId.get('station-hp')?.x).toBe(vp.width - HUD_PAD);
      expect(byId.get('controls-strip')?.x).toBe(0);
      expect(byId.get('wave-clock')?.x).toBe(vp.width / 2);
    }
  });

  it('binds at 21:9 as well as 32:9 — the same rule, not a special case', () => {
    const hud = new Hud(2560, 1080);
    const box = hud.debugContentBox();
    expect(box.width).toBeCloseTo(1920, 6);
    expect(box.x).toBeCloseTo(320, 6);
    const byId = new Map(hud.debugChromeAnchors().map((a) => [a.id, a]));
    expect(byId.get('station-hp')?.x).toBeCloseTo(2560 - 320 - HUD_PAD, 6);
    expect(byId.get('ore-hud')?.x).toBeCloseTo(320 + HUD_PAD, 6);
  });
});

/**
 * ── a0-76 ───────────────────────────────────────────────────────────────────
 * The developer, 2026-08-17:
 *
 * > *"do we have any indication when a player loses connection (like for the
 * > other players that remained in match…) and when they join back as well…
 * > we need something to indicate that so other players know"*
 *
 * No. `./connection-status` and `src/net/link-loss` are entirely about your OWN
 * socket, so from the other side of a drop a disconnected player was a ship that
 * simply stopped making good decisions — rage-quit, lag, a reconnect in flight
 * and a bot substitution all looked identical from the cockpit, and every one of
 * them calls for a different response.
 *
 * These tests drive the REAL feed with REAL wire messages: `applyPresenceMessage`
 * is the exact function `main.ts` hands every observed `ServerMessage` to, and
 * the fixtures below are typed as {@link ServerMessage}, so a shape that moves in
 * `src/net/transport.ts` fails compilation here rather than passing against a
 * re-implementation of the routing.
 *
 * The Pixi half (the pooled two-token rows under the wave clock) is not exercised
 * here: drawing measures text, which needs a DOM. Its decision logic is
 * {@link ./peer-presence}'s, its placement is `presenceBand`'s and is asserted
 * headless below, and its pixels are the golden/live-stage suites' — the same
 * split every other element in this directory keeps.
 */

/** Authority's own drop broadcast (`server/room.ts` `vacate`). `heldForMatch` is
 *  the a0-72 hold: the seat is its operator's for as long as the match runs. */
function substituted(player: number, held: boolean): ServerMessage {
  return held
    ? { type: 'playerSubstituted', player, graceSeconds: 0, heldForMatch: true }
    : { type: 'playerSubstituted', player, graceSeconds: 0 };
}

/** …and the reclaim broadcast that answers it. */
function reclaimed(player: number): ServerMessage {
  return { type: 'playerReclaimed', player };
}

/** A roster broadcast carrying who is a bot right now — the room re-sends this
 *  on every drop and every reclaim. Only `player`/`isBot` matter here; the rest
 *  is the shape `server/room.ts` `lobbyState()` actually publishes. */
function roster(bots: readonly boolean[]): ServerMessage {
  const slots: LobbySlot[] = bots.map((isBot, player) => ({
    player,
    isBot,
    shipClass: ShipClass.Vanguard,
    ready: true,
    state: 'open',
  }));
  return { type: 'lobbyState', slots };
}

describe('a0-76 — the HUD says who stopped flying', () => {
  it('a peer who drops is named, and named again when they return', () => {
    // Four seats; this client is P1 (seat 0) and is watching seat 2.
    const log = new PeerPresenceLog({ local: 0 });

    // ── THE DROP ────────────────────────────────────────────────────────────
    // Authority, not inference: the room lost seat 2's socket mid-match, seated a
    // bot, and is holding the seat for as long as the match runs (a0-72).
    applyPresenceMessage(log, substituted(2, true), 10);
    applyPresenceMessage(log, roster([false, false, true, false]), 10);

    const dropped = log.read(10);
    expect(dropped, 'a drop must produce exactly one line').toHaveLength(1);
    // NAMED — the whole point of the brief. `P3` is seat 2's 1-based identity
    // tag, the same string its nameplate and its hull decal carry, so the banner
    // ties to a ship the player can see rather than to an index they cannot.
    expect(dropped[0]!.name).toBe('P3');
    expect(dropped[0]!.seat).toBe(2);
    expect(dropped[0]!.state).toBe('dropped');
    expect(dropped[0]!.reason).toBe('CONNECTION LOST');
    // …and the bot that took the seat, because an ally who is suddenly an AI is
    // match information too. Secondary clause, so it never displaces the name.
    expect(dropped[0]!.clause).toBe('BOT FLYING');
    expect(dropped[0]!.text).toBe('P3 — CONNECTION LOST · BOT FLYING');
    expect(log.presence(2)).toMatchObject({ state: 'dropped', bot: true });

    // The line is transient; the STATE is not. Twenty seconds later the banner is
    // clear and seat 2 is still dropped — which is what a player pressing the
    // advantage needs to remain true.
    expect(log.read(10 + PRESENCE_TELL_SECONDS)).toHaveLength(0);
    expect(log.presence(2).state).toBe('dropped');

    // ── THE RETURN ──────────────────────────────────────────────────────────
    // A return that is silent is as confusing as a drop that is.
    applyPresenceMessage(log, reclaimed(2), 40);
    applyPresenceMessage(log, roster([false, false, false, false]), 40);

    const back = log.read(40);
    expect(back, 'a return must produce exactly one line').toHaveLength(1);
    // NAMED AGAIN, and by the same name — a player who read `P3 — CONNECTION
    // LOST` four seats ago must not have to work out that `Seat 2` is the same
    // person.
    expect(back[0]!.name).toBe('P3');
    expect(back[0]!.seat).toBe(2);
    expect(back[0]!.state).toBe('back');
    expect(back[0]!.reason).toBe('BACK');
    // …and the bot is out, stated rather than left to inference.
    expect(back[0]!.clause).toBe('BOT OUT');
    expect(back[0]!.text).toBe('P3 — BACK · BOT OUT');
    expect(log.presence(2).bot).toBe(false);

    // `back` is a thing that happened, not a condition: once its line has been on
    // screen for its whole window the seat is an ordinary flying seat again.
    expect(log.read(40 + PRESENCE_TELL_SECONDS)).toHaveLength(0);
    expect(log.presence(2).state).toBe('here');
  });

  it('names the player with the name the lobby gave them, not a seat number', () => {
    // The banner spells a seat exactly the way its nameplate does (`resolveName`),
    // so a named seat reads its name and a nameless one falls back to `P{n}`.
    const log = new PeerPresenceLog({ local: 0, names: [undefined, undefined, 'Warden'] });
    applyPresenceMessage(log, substituted(2, true), 5);
    expect(log.read(5)[0]!.text).toBe('Warden — CONNECTION LOST · BOT FLYING');

    // …and a table that arrives later re-spells the line still on screen.
    const late = new PeerPresenceLog({ local: 0 });
    applyPresenceMessage(late, substituted(3, true), 5);
    expect(late.read(5)[0]!.name).toBe('P4');
    late.setNames([undefined, undefined, undefined, 'Sable']);
    expect(late.read(5)[0]!.name).toBe('Sable');
  });

  it('tells a drop from an abandon — one may come back, the other may not', () => {
    // The SAME message carries both, and `heldForMatch` is the whole difference
    // (a0-72). A peer does different things about them, so the banner says which.
    const log = new PeerPresenceLog({ local: 0 });

    applyPresenceMessage(log, substituted(1, true), 1);
    expect(log.read(1)[0]!.reason).toBe('CONNECTION LOST');
    expect(log.presence(1).state).toBe('dropped');

    applyPresenceMessage(log, substituted(3, false), 2);
    const gone = log.read(2).find((l) => l.seat === 3);
    expect(gone!.reason).toBe('LEFT THE MATCH');
    expect(gone!.state).toBe('gone');
    expect(log.presence(3).state).toBe('gone');
  });

  it('the match ending closes every seat still away — the hold runs no longer', () => {
    const log = new PeerPresenceLog({ local: 0 });
    applyPresenceMessage(log, substituted(1, true), 1);
    applyPresenceMessage(log, substituted(2, true), 2);
    expect(log.away().map((s) => s.state)).toEqual(['dropped', 'dropped']);

    applyPresenceMessage(log, { type: 'matchEnd', tick: 900, winner: 0 }, 600);
    expect(log.presence(1).state).toBe('gone');
    expect(log.presence(2).state).toBe('gone');
    // Silently: the summary screen is up, and a banner announcing two departures
    // over it would be noise about a match that is over.
    expect(log.read(600)).toHaveLength(0);
  });

  it('surfaces a bot taking a seat, and never invents one for a seat the host set', () => {
    const log = new PeerPresenceLog({ local: 0 });
    // Seats 4..7 were BOT from the lobby. The FIRST roster broadcast must not
    // announce four substitutions — nothing happened to those seats, and a banner
    // that cries wolf on match start is a banner nobody reads on minute nine.
    applyPresenceMessage(log, roster([false, false, false, false, true, true, true, true]), 0);
    expect(log.read(0)).toHaveLength(0);
    expect(log.away()).toHaveLength(0);

    // A seat the log knows about is a different matter: this is the substitution
    // arriving on the roster channel, and it is stated.
    applyPresenceMessage(log, substituted(2, true), 30);
    expect(log.read(30)[0]!.clause).toBe('BOT FLYING');
  });

  it('is silent about your own seat — that drop is the overlay’s, not the banner’s', () => {
    // `src/net/link-loss` throws a full-screen card with RECONNECT and ABANDON on
    // it when YOUR socket goes. A second, quieter copy of that under the wave
    // clock would be noise over a card the player cannot miss.
    const log = new PeerPresenceLog({ local: 3 });
    applyPresenceMessage(log, substituted(3, true), 10);
    expect(log.read(10)).toHaveLength(0);
    applyPresenceMessage(log, reclaimed(3), 20);
    expect(log.read(20)).toHaveLength(0);

    // The seat's STATE is still tracked — only the line is suppressed.
    expect(log.presence(3).state).toBe('back');
  });

  it('does not stack a second line when authority repeats itself', () => {
    // A reconnecting client is re-taught the roster, and the room re-broadcasts on
    // every change: the same fact can arrive several times and must read as one.
    const log = new PeerPresenceLog({ local: 0 });
    applyPresenceMessage(log, substituted(1, true), 1);
    applyPresenceMessage(log, substituted(1, true), 2);
    applyPresenceMessage(log, roster([false, true]), 3);
    expect(log.read(3)).toHaveLength(1);
    expect(log.read(3)[0]!.text).toBe('P2 — CONNECTION LOST · BOT FLYING');
  });

  it('shows the newest few and never a tower of them', () => {
    // Eight seats can drop together (a router reboot at a LAN party). A stack that
    // tall reaches the build wheel on a phone, so the newest win — a tell nobody
    // sees until four seconds from now is not a tell about now.
    const log = new PeerPresenceLog({ local: 0 });
    for (let seat = 1; seat < 8; seat++) applyPresenceMessage(log, substituted(seat, true), seat);
    const lines = log.read(7);
    expect(lines).toHaveLength(PRESENCE_MAX_LINES);
    expect(lines.map((l) => l.seat)).toEqual([7, 6, 5]);
  });

  it('holds a line long enough to read mid-fight, then fades it out', () => {
    const log = new PeerPresenceLog({ local: 0 });
    applyPresenceMessage(log, substituted(1, true), 100);
    expect(log.read(100)[0]!.alpha).toBe(1);
    expect(log.read(100 + PRESENCE_TELL_SECONDS * 0.5)[0]!.alpha).toBe(1);

    const leaving = log.read(100 + PRESENCE_TELL_SECONDS - 0.2)[0]!;
    expect(leaving.alpha).toBeGreaterThan(0);
    expect(leaving.alpha).toBeLessThan(1);
    expect(log.read(100 + PRESENCE_TELL_SECONDS)).toHaveLength(0);

    // A clock that went backwards is a rematch or a reclaim's rebuilt world: drop
    // anything standing rather than drawing a line stamped in the future.
    applyPresenceMessage(log, substituted(2, true), 200);
    expect(log.read(0)).toHaveLength(0);
  });

  it('ignores every message that is not about a seat changing hands', () => {
    const log = new PeerPresenceLog({ local: 0 });
    expect(applyPresenceMessage(log, { type: 'pong', id: 1, queueMs: 0, loopLagMs: 0 }, 1)).toBe(false);
    expect(applyPresenceMessage(log, substituted(1, true), 1)).toBe(true);
  });

  it('speaks the machine register — plain, diagnostic, no fiction and no drama', () => {
    // GDD §4.7's match/machine line: *"a dropped socket is a machine fact, and the
    // mining authority has no voice for it"*. So no claim/operator/seal vocabulary
    // here, and — §4.7 again — no exclamation, ever.
    const log = new PeerPresenceLog({ local: 0 });
    applyPresenceMessage(log, substituted(1, true), 1);
    applyPresenceMessage(log, substituted(2, false), 1);
    applyPresenceMessage(log, reclaimed(3), 1);
    for (const line of log.read(1)) {
      expect(line.text).toBe(line.text.toUpperCase().replace('—', '—'));
      expect(line.text).not.toContain('!');
      // The FACT leads the row after the name, per the clarity rule — a player
      // under fire reads the first two words and nothing else.
      expect(['CONNECTION LOST', 'LEFT THE MATCH', 'BACK']).toContain(line.reason);
      expect(line.reason.split(' ').length).toBeLessThanOrEqual(3);
    }
  });

  it('carries the seam the HUD draws it through, and starts with nothing up', () => {
    // The Pixi HUD cannot draw headless (text measurement needs a DOM), but the
    // seam a live-stage test and the evidence capture read is asserted here so it
    // cannot quietly vanish — the way `debugLootTell` is.
    const hud = new Hud(1280, 720);
    expect(typeof hud.debugPresence).toBe('function');
    expect(hud.debugPresence()).toEqual([]);
  });
});

describe('a0-76 — where the banner goes', () => {
  /** The clock as the HUD lays it out, at real-ish measured line widths. */
  function clockAt(w: number, h: number, wheelOpen = false) {
    return waveClockLayout(
      w,
      h,
      [
        { width: 168, height: 18 },
        { width: 96, height: 17 },
        { width: 91, height: 16 },
      ],
      wheelOpen,
    );
  }
  const lines = (n: number) => Array.from({ length: n }, () => ({ width: 190, height: 14 }));

  it('hangs under the wave clock — where the player already looks for match state', () => {
    // GDD §2.2 puts the wave clock top-centre and names a corner or a band for
    // every other element (ore top-left, HOME top-right, minimap bottom-right,
    // strip along the bottom), so this is the region that answers "what is
    // happening in the match" and the banner joins it rather than inventing one.
    for (const vp of [
      { width: 1280, height: 720 },
      { width: 844, height: 390 }, // landscape phone
      { width: 390, height: 844 }, // portrait phone
      { width: 1920, height: 1080 },
    ]) {
      const clock = clockAt(vp.width, vp.height);
      const band = presenceBand(vp.width, vp.height, clock, lines(3), false);
      expect(band.fits).toBe(true);
      expect(band.shown, 'a closed wheel takes nothing from the band').toBe(3);
      // Centred on the clock, and strictly BELOW its drawn footprint (scrim
      // included) — the two read as one column, never as an overlap.
      expect(band.x).toBeCloseTo(clock.bounds.x + clock.bounds.width / 2, 6);
      expect(band.y).toBeGreaterThan(clock.bounds.y + clock.bounds.height);
      // …and clear of the top-left ore cluster and the top-right HOME panel by
      // construction: it is centred, and its widest row is far narrower than the
      // gap between those two corners on every profile above.
      expect(band.bounds.x).toBeGreaterThan(HUD_PAD);
      expect(band.bounds.x + band.bounds.width).toBeLessThan(vp.width - HUD_PAD);
    }
  });

  it('gets out of the way of an open build wheel on a phone', () => {
    // The brief: *"keep it out of the way of the wheel and the minimap on a
    // phone"*. The wheel is a control the player is pressing right now and the
    // banner is transient, so on a viewport too short to hold both the banner is
    // culled whole — the same call a0-24 made for the clock itself.
    const vp = { width: 844, height: 390 };
    const clock = clockAt(vp.width, vp.height, true);
    const open = presenceBand(vp.width, vp.height, clock, lines(3), true);
    expect(open.fits, 'a 390px-tall phone has no room for the band at all').toBe(false);
    expect(open.shown).toBe(0);

    // …and it is back, whole, the moment the wheel closes.
    const closed = presenceBand(vp.width, vp.height, clockAt(vp.width, vp.height), lines(3), false);
    expect(closed.fits).toBe(true);
    expect(closed.shown).toBe(3);

    // The minimap is the other thing a phone has no room for, and the banner never
    // reaches it: it is a top-centre element and the map is bottom-right.
    const map = collapsedRect(vp, false);
    expect(closed.bounds.y + closed.bounds.height).toBeLessThan(map.y);
  });

  it('gives the wheel the pixels a ROW at a time, not all at once', () => {
    // A 1280×720 desktop with the wheel open has room for two lines and not
    // three. Answering that with silence would drop the newest fact in the game
    // to protect a wedge nothing was going to overlap, so the band sheds its
    // OLDEST row instead — and what survives still clears the wheel exactly.
    const vp = { width: 1280, height: 720 };
    const clock = clockAt(vp.width, vp.height, true);
    const wheelTop = wheelBounds(vp.width, vp.height).y;

    const three = presenceBand(vp.width, vp.height, clock, lines(3), true);
    expect(three.fits).toBe(true);
    expect(three.shown).toBeGreaterThan(0);
    expect(three.shown).toBeLessThan(3);
    expect(three.bounds.y + three.bounds.height).toBeLessThan(wheelTop);

    // …and with the wheel CLOSED all three draw, because there is no wheel to
    // clear: the clearance is a constraint on a control that is on screen, not a
    // permanent no-go band down the middle of the HUD.
    const closed = presenceBand(vp.width, vp.height, clockAt(vp.width, vp.height), lines(3), false);
    expect(closed.shown).toBe(3);
  });

  it('one line, two lines or three all stack from the same top', () => {
    const vp = { width: 1280, height: 720 };
    const clock = clockAt(vp.width, vp.height);
    const one = presenceBand(vp.width, vp.height, clock, lines(1), false);
    const three = presenceBand(vp.width, vp.height, clock, lines(3), false);
    expect(one.y).toBe(three.y);
    expect(three.bounds.height).toBeCloseTo(2 * three.leading + 14, 6);
    expect(one.bounds.height).toBe(14);
  });

  it('reads on an ultrawide, bound to the content box like the clock above it', () => {
    // a0-74: the chrome is laid out in a centred reference-aspect box, so the
    // banner is measured against that box and not against 3840 physical pixels —
    // otherwise it would sit a head-turn away from the clock it belongs to.
    const box = { width: 1080 * CONTENT_MAX_ASPECT, height: 1080 };
    const clock = clockAt(box.width, box.height);
    const band = presenceBand(box.width, box.height, clock, lines(2), false);
    expect(band.fits).toBe(true);
    expect(band.x).toBeCloseTo(box.width / 2, 6);
    // Shifted onto the screen by the HUD, which is what keeps it off the edges.
    const shifted = band.x + (3840 - box.width) / 2;
    expect(shifted).toBeCloseTo(3840 / 2, 6);
  });
});
