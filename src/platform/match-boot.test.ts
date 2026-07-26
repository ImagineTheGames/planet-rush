/**
 * Boot integration (GDD §2.1, §2.5, §2.9, §4.2). **This file is the attested
 * evidence.**
 *
 * M2's features were all merged and all unit-tested, and none of them were in
 * the game: the client booted a sandbox, so "planets exist" and "planets are in
 * the match you are playing" were two different facts and only the first was
 * tested. These tests assert the second, on the same composition `main.ts`
 * boots through ({@link bootOfflineMatch}) and the same funnel its input goes
 * down ({@link mapActions}), with no browser in the loop.
 *
 * The chain each build test walks, end to end:
 *
 *   wheel press → ControlState.order → mapActions → session.sendInput
 *     → LocalLoopback → InputQueue → step → placeOrder → a turret on your planet
 *
 * If any link in that is unwired, one of these goes red.
 */
import { describe, it, expect } from 'vitest';
import { ShipClass, UpgradeTrack } from '@shared/types';
import type { Action } from '@shared/types';
import { bootOfflineMatch } from './match-boot';
import { FireMode, createControlState, mapActions, resetControlState } from './actions';
import { PANEL_ROWS_TOP, WheelInput, writeWheelOrders } from './wheel-input';
import { TURRET, isCollapsed, isDocked, planetOf, turretCount } from '../sim';
import { WHEEL_ORDER, TRACK_ORDER, buildWheelModel } from '../ui';

const LOCAL = 0;
const UPGRADE_SEGMENT = WHEEL_ORDER.indexOf('upgrade');

function boot() {
  return bootOfflineMatch({ seed: 1, localPlayer: LOCAL, shipClass: ShipClass.Vanguard });
}

/** The neutral action stream a player who is touching nothing produces. */
function idle(): Action[] {
  return mapActions(createControlState(), FireMode.Manual);
}

function run(match: ReturnType<typeof boot>, ticks: number, actions: () => Action[] = idle): void {
  for (let i = 0; i < ticks; i++) match.tick(actions());
}

describe('the client boots a real match, not a sandbox (GDD §2.1)', () => {
  it('stands up eight planets, one per slot, with the local player owning one', () => {
    const match = boot();

    expect(match.world.planets).toHaveLength(8);
    expect(match.world.ships).toHaveLength(8);
    expect(planetOf(match.world, LOCAL)).not.toBeNull();
    for (let id = 0; id < 8; id++) {
      expect(planetOf(match.world, id)?.owner).toBe(id);
    }
  });

  it('fills the other seven slots with the cast, and the local slot with nobody', () => {
    const match = boot();

    expect(match.bots).toHaveLength(7);
    expect(match.bots.map((b) => b.seat.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(match.bots.some((b) => b.seat.id === LOCAL)).toBe(false);
  });

  it('opens the field with asteroid wave 1 already scattered (GDD §2.3)', () => {
    const match = boot();
    expect(match.world.asteroids.length).toBeGreaterThan(0);
    expect(match.world.match.wavesSpawned).toBe(1);
    expect(match.world.match.phase).toBe('live');
  });

  it('advances the authoritative sim one tick per pulse — the match clock runs', () => {
    const match = boot();
    const t0 = match.world.time;

    run(match, 120);

    expect(match.world.tick).toBe(120);
    expect(match.world.time).toBeGreaterThan(t0);
  });

  it('is deterministic: same seed, same arena', () => {
    const a = boot();
    const b = boot();
    run(a, 60);
    run(b, 60);
    expect(a.world.planets.map((p) => p.pos)).toEqual(b.world.planets.map((p) => p.pos));
    expect(a.world.ships.map((s) => s.pos)).toEqual(b.world.ships.map((s) => s.pos));
  });
});

describe('the Build & Upgrade wheel actually spends (GDD §2.5)', () => {
  it('opens at your own planet — the ship spawns docked at home', () => {
    const match = boot();
    const ship = match.world.ships[LOCAL]!;
    const planet = planetOf(match.world, LOCAL)!;

    expect(isDocked(ship, planet)).toBe(true);
    expect(
      buildWheelModel({
        requested: true,
        docked: true,
        shipAlive: ship.alive,
        planetAlive: planet.alive,
        cargo: ship.cargo,
        banked: ship.banked,
        turrets: 0,
        shields: 0,
        coreHp: planet.coreHp,
        maxCoreHp: planet.maxCoreHp,
      }).open,
    ).toBe(true);
  });

  it('presses TURRET and a turret is standing on the planet ten seconds later', () => {
    const match = boot();
    const planet = planetOf(match.world, LOCAL)!;
    const wheel = new WheelInput();
    const state = createControlState();

    // Open the wheel and press the TURRET wedge, exactly as a click or a tap
    // arrives at it: a segment index out of WheelInput.
    wheel.toggle();
    wheel.aim(0, -1, WHEEL_ORDER.length); // twelve o'clock — TURRET
    wheel.confirm(UPGRADE_SEGMENT);
    expect(writeWheelOrders(wheel, state, WHEEL_ORDER, TRACK_ORDER)).toBe(true);

    const banked = match.world.ships[LOCAL]!.banked;
    match.tick(mapActions(state, FireMode.Manual));

    // Ore is spent the moment the order lands; only time remains (GDD §2.5).
    expect(match.world.ships[LOCAL]!.banked).toBe(banked - TURRET.cost);
    expect(planet.builds).toHaveLength(1);
    expect(planet.turrets).toHaveLength(0);

    // Construction visibly progresses, then finishes.
    resetControlState(state);
    run(match, 60);
    const midway = planet.builds[0]!;
    expect(midway.remaining).toBeLessThan(midway.total);

    run(match, 60 * TURRET.buildTime);
    expect(planet.turrets).toHaveLength(1);
    expect(turretCount(planet)).toBe(1);
  });

  it('charges exactly once for one press — the order never latches', () => {
    const match = boot();
    const wheel = new WheelInput();
    const state = createControlState();

    wheel.toggle();
    wheel.aim(0, -1, WHEEL_ORDER.length);
    wheel.confirm(UPGRADE_SEGMENT);
    writeWheelOrders(wheel, state, WHEEL_ORDER, TRACK_ORDER);

    const banked = match.world.ships[LOCAL]!.banked;
    const actions = mapActions(state, FireMode.Manual);
    match.tick(actions);
    // The next frame's reset clears the one-shot field; holding the button down
    // must not buy a second turret.
    resetControlState(state);
    run(match, 30);

    expect(match.world.ships[LOCAL]!.banked).toBe(banked - TURRET.cost);
    expect(turretCount(planetOf(match.world, LOCAL)!)).toBe(1);
  });

  it('buys a ship upgrade from a panel row (GDD §2.5, the fifth segment)', () => {
    const match = boot();
    const wheel = new WheelInput();
    const state = createControlState();

    wheel.toggle();
    wheel.openPanel();
    // CARGO — the cheapest first tier on the ladder, and the one a player can
    // afford out of the starting ore (GDD §2.8: starting ore is 3).
    const row = TRACK_ORDER.indexOf(UpgradeTrack.Cargo);
    const track = TRACK_ORDER[row]!;
    const ship = match.world.ships[LOCAL]!;
    const before = ship.tiers[track];
    const cargoCap = ship.cargoCap;

    // Reach the row the way a press does: through the hit-tested row index.
    const panel = { centerX: 200, centerY: 150, width: 300, height: 212, rowHeight: 30, rows: 4 };
    const rowY = panel.centerY - panel.height / 2 + PANEL_ROWS_TOP + row * panel.rowHeight + 5;
    wheel.press(
      panel.centerX,
      rowY,
      { centerX: 0, centerY: 0, radius: 1, segments: WHEEL_ORDER.length },
      panel,
      UPGRADE_SEGMENT,
    );
    expect(writeWheelOrders(wheel, state, WHEEL_ORDER, TRACK_ORDER)).toBe(true);

    match.tick(mapActions(state, FireMode.Manual));

    expect(ship.tiers[track]).toBe(before + 1);
    // And the derived stat moved with it — the panel's promise, honoured.
    expect(ship.cargoCap).toBeGreaterThan(cargoCap);
  });

  it('refuses an order the sim does not honour, without the client having to know', () => {
    const match = boot();
    const ship = match.world.ships[LOCAL]!;
    const planet = planetOf(match.world, LOCAL)!;
    // Fly out of dock range: the wheel would be closed, but even a forged order
    // is refused — the sim never trusts the sender (GDD §2.9).
    ship.pos.x = planet.pos.x + 10_000;
    const banked = ship.banked;

    const state = createControlState();
    state.order = 'turret';
    match.tick(mapActions(state, FireMode.Manual));

    expect(ship.banked).toBe(banked);
    expect(planet.builds).toHaveLength(0);
  });
});

describe('the match runs its own clock to an ending (GDD §2.3)', () => {
  it('bank orders reach the sim through the same funnel', () => {
    const match = boot();
    const ship = match.world.ships[LOCAL]!;
    ship.cargo = 2;
    const banked = ship.banked;

    const state = createControlState();
    state.order = 'bank';
    match.tick(mapActions(state, FireMode.Manual));

    expect(ship.cargo).toBe(0);
    expect(ship.banked).toBe(banked + 2);
  });

  it('every upgrade track is reachable from the panel order', () => {
    expect([...TRACK_ORDER].sort()).toEqual(
      [UpgradeTrack.Power, UpgradeTrack.Engine, UpgradeTrack.Cargo, UpgradeTrack.Hull].sort(),
    );
  });

  it('has not collapsed while the field still has waves to give', () => {
    const match = boot();
    run(match, 300);
    expect(isCollapsed(match.world)).toBe(false);
  });
});
