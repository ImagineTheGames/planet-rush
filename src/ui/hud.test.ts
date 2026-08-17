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
import { Hud } from './hud';
import {
  LOOT_TELL_SECONDS,
  LootTellLatch,
  leftNumeral,
  partialTake,
} from './loot-tell';
import { CONTENT_MAX_ASPECT } from './viewport';
import { HUD_PAD } from './hud-geometry';
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
