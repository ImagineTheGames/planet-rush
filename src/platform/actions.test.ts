/**
 * Action-mapping unit tests (GDD §2.4). The funnel every device passes through:
 * a device-neutral ControlState + a fire mode → the abstract `Action[]` the sim
 * consumes. The load-bearing assertions are the fire-mode morph (Auto-aim drops
 * the aim action and flags fire, Manual keeps aim) and that the controls-strip
 * labels are generated from — and stay in sync with — that same map.
 */
import { describe, it, expect } from 'vitest';
import type { Action, AimAction, FireAction, ThrustAction } from '@shared/types';
import { UpgradeTrack } from '@shared/types';
import {
  FireMode,
  defaultFireMode,
  createControlState,
  resetControlState,
  mapActions,
  describeBindings,
} from './actions';

function pick<T extends Action['type']>(actions: Action[], type: T): Extract<Action, { type: T }> | undefined {
  return actions.find((a) => a.type === type) as Extract<Action, { type: T }> | undefined;
}

describe('defaultFireMode (GDD §2.4)', () => {
  it('is Manual on desktop/gamepad and Auto-aim on touch', () => {
    expect(defaultFireMode(false)).toBe(FireMode.Manual);
    expect(defaultFireMode(true)).toBe(FireMode.AutoAim);
  });
});

describe('mapActions — thrust always passes through', () => {
  it('carries the analog thrust vector unchanged', () => {
    const s = createControlState();
    s.thrust.x = 0.5;
    s.thrust.y = -0.25;
    const thrust = pick(mapActions(s, FireMode.Manual), 'thrust') as ThrustAction;
    expect(thrust.dir).toEqual({ x: 0.5, y: -0.25 });
  });
});

describe('mapActions — the fire-mode morph', () => {
  it('Manual emits the aim action and fire.auto = false', () => {
    const s = createControlState();
    s.aim = { x: 1, y: 0 };
    s.fire = true;
    const actions = mapActions(s, FireMode.Manual);

    const aim = pick(actions, 'aim') as AimAction;
    expect(aim).toBeDefined();
    expect(aim.dir).toEqual({ x: 1, y: 0 });

    const fire = pick(actions, 'fire') as FireAction;
    expect(fire.active).toBe(true);
    expect(fire.auto).toBe(false);
  });

  it('Auto-aim drops the aim action entirely and flags fire.auto = true', () => {
    const s = createControlState();
    s.aim = { x: 1, y: 0 }; // present, but must be ignored in Auto-aim
    s.fire = true;
    const actions = mapActions(s, FireMode.AutoAim);

    expect(pick(actions, 'aim')).toBeUndefined();

    const fire = pick(actions, 'fire') as FireAction;
    expect(fire.active).toBe(true);
    expect(fire.auto).toBe(true);
  });

  it('switching fire mode swaps the aim binding for the same control state', () => {
    const s = createControlState();
    s.aim = { x: 0, y: -1 };
    s.fire = true;

    const manual = mapActions(s, FireMode.Manual);
    const auto = mapActions(s, FireMode.AutoAim);

    // The only difference is the aim action and the fire.auto flag.
    expect(pick(manual, 'aim')).toBeDefined();
    expect(pick(auto, 'aim')).toBeUndefined();
    expect((pick(manual, 'fire') as FireAction).auto).toBe(false);
    expect((pick(auto, 'fire') as FireAction).auto).toBe(true);
  });

  it('omits a zero/absent aim even in Manual', () => {
    const s = createControlState();
    s.aim = null;
    expect(pick(mapActions(s, FireMode.Manual), 'aim')).toBeUndefined();
    s.aim = { x: 0, y: 0 };
    expect(pick(mapActions(s, FireMode.Manual), 'aim')).toBeUndefined();
  });
});

describe('mapActions — build, boost, ping', () => {
  it('emits build and boost held states and a one-shot ping', () => {
    const s = createControlState();
    s.build = true;
    s.boost = true;
    s.ping = { x: 42, y: 7 };
    const actions = mapActions(s, FireMode.Manual);
    expect(pick(actions, 'build')).toMatchObject({ active: true });
    expect(pick(actions, 'boost')).toMatchObject({ active: true });
    expect(pick(actions, 'ping')).toMatchObject({ at: { x: 42, y: 7 } });
  });

  it('omits ping when none is queued', () => {
    const s = createControlState();
    expect(pick(mapActions(s, FireMode.Manual), 'ping')).toBeUndefined();
  });
});

describe('resetControlState', () => {
  it('returns every field to neutral in place', () => {
    const s = createControlState();
    s.thrust.x = 1;
    s.aim = { x: 1, y: 1 };
    s.fire = s.boost = s.build = true;
    s.order = 'turret';
    s.upgrade = UpgradeTrack.Beam;
    s.ping = { x: 1, y: 1 };
    resetControlState(s);
    expect(s).toEqual({
      thrust: { x: 0, y: 0 },
      aim: null,
      fire: false,
      boost: false,
      build: false,
      order: null,
      upgrade: null,
      ping: null,
    });
  });
});

describe('mapActions — the wheel presses that spend (GDD §2.5)', () => {
  it('emits nothing extra on the overwhelming majority of frames', () => {
    const s = createControlState();
    const types = mapActions(s, FireMode.Manual).map((a) => a.type);
    expect(types).not.toContain('buildOrder');
    expect(types).not.toContain('upgradeOrder');
  });

  it('carries a confirmed segment through as a one-shot buildOrder', () => {
    const s = createControlState();
    s.order = 'turret';
    const order = pick(mapActions(s, FireMode.Manual), 'buildOrder');
    expect(order?.item).toBe('turret');
    // One-shot: the next frame's reset clears it, so the sim is never charged
    // twice for one press.
    resetControlState(s);
    expect(pick(mapActions(s, FireMode.Manual), 'buildOrder')).toBeUndefined();
  });

  it('carries a confirmed panel row through as an upgradeOrder', () => {
    const s = createControlState();
    s.upgrade = UpgradeTrack.Cargo;
    const order = pick(mapActions(s, FireMode.AutoAim), 'upgradeOrder');
    expect(order?.track).toBe(UpgradeTrack.Cargo);
  });

  it('is device- and fire-mode-agnostic: the same press maps the same way', () => {
    const manual = createControlState();
    const auto = createControlState();
    manual.order = 'shield';
    auto.order = 'shield';
    expect(pick(mapActions(manual, FireMode.Manual), 'buildOrder')).toEqual(
      pick(mapActions(auto, FireMode.AutoAim), 'buildOrder'),
    );
  });
});

describe('describeBindings — the controls strip reads from the map (GDD §2.4)', () => {
  it('drops the aim row in Auto-aim, on every device', () => {
    for (const device of ['keyboard', 'gamepad', 'touch'] as const) {
      const manual = describeBindings(device, FireMode.Manual).map((r) => r.action);
      const auto = describeBindings(device, FireMode.AutoAim).map((r) => r.action);
      expect(manual).toContain('aim');
      expect(auto).not.toContain('aim');
    }
  });

  it('morphs the touch fire binding into a FIRE button in Auto-aim', () => {
    const manualFire = describeBindings('touch', FireMode.Manual).find((r) => r.action === 'fire');
    const autoFire = describeBindings('touch', FireMode.AutoAim).find((r) => r.action === 'fire');
    expect(manualFire?.binding).toBe('Right stick');
    expect(autoFire?.binding).toBe('FIRE button');
  });

  it('names Build & Upgrade in full, never just "BUILD" (GDD §2.5)', () => {
    const build = describeBindings('keyboard', FireMode.Manual).find((r) => r.action === 'build');
    expect(build?.label).toBe('Build & Upgrade');
  });
});
