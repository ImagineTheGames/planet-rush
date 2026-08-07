/**
 * The RESERVED rule, enforced across the whole art set (style-guide §2):
 *
 * > **Signal yellow `#F2D24B` means ore or danger, and nothing else. Ever.**
 *
 * This is the test that makes the style guide a contract rather than a document.
 * It walks every sprite in the catalogue — every hull, every livery, every crack
 * stage, every turret state — and checks every colour on every shape against the
 * roles the guide allows it on. It also re-derives every shade from its recipe,
 * so the "no seventh material colour" rule holds against a hand-edited hex, and
 * cross-checks the palette against the render layer's copy so the two can never
 * drift into two different Cold Vacuums.
 *
 * It also holds the **ratified removals** — `STATION_HULL_EXCLUSIONS` (a2-04) —
 * from both directions, because a removal that is only an absence is a removal
 * nothing defends. See the final describe block.
 */

import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import { ShipClass } from '@shared/types';
import { PALETTE as RENDER_PALETTE, PLAYER_COLORS as RENDER_ROSTER, Renderer } from '@render/index';
import {
  createWorld,
  damageTurret,
  placeOrder,
  shipOf,
  stationOf,
  sweepDeadTurrets,
  turretCount,
  updateStations,
  TURRET,
  type World,
} from '../sim';
import { ALL_SPRITES, ART_CATALOGUE } from './catalogue';
import { turretSilhouetteForTier, turretSprite } from './buildings';
import { STATION_HULL_EXCLUSIONS, stationHullParts, stationSprite, STATION_VARIANT_COUNT } from './stations';
import { assertPaletteCompliance, auditAll, auditSprite, formatViolations } from './compliance';
import {
  ALLOWED_COLORS,
  DERIVED,
  DERIVED_RECIPES,
  PALETTE,
  PLAYER_COLORS,
  derive,
  hex,
  type DerivedKey,
} from './palette';
import { circle, fill, sprite, spriteColors, type Shape } from './shapes';
import {
  MATERIALS,
  PALETTE as TOKENS,
  PLAYER_ROSTER,
  WHITE as TOKEN_WHITE,
  type MaterialName,
  type PaletteKey,
} from './tokens';

describe('tokens.ts is the art-direction single source (a2-01)', () => {
  it('owns the six hexes: palette.ts re-exports them, never re-declares them', () => {
    expect(TOKENS).toEqual({
      vacuum: 0x0d1015,
      hullSteel: 0x7e8894,
      patina: 0x4fa08b,
      signalYellow: 0xf2d24b,
      plasma: 0x4dc3ff,
      threatRed: 0xb23a3a,
    });
    // Not a copy that could drift — the very same object flows through the art
    // layer and (via the cross-check below) the render layer.
    expect(PALETTE).toBe(TOKENS);
    expect(PLAYER_COLORS).toBe(PLAYER_ROSTER);
  });

  it('grounds the allow-list: the six + white all trace back to tokens', () => {
    for (const c of Object.values(TOKENS)) expect(ALLOWED_COLORS.has(c)).toBe(true);
    expect(ALLOWED_COLORS.has(TOKEN_WHITE)).toBe(true);
    for (const c of PLAYER_ROSTER) expect(ALLOWED_COLORS.has(c)).toBe(true);
  });

  it('names every palette colour in exactly one material family (steel/ice/ember/void)', () => {
    const claimed = new Map<PaletteKey, MaterialName>();
    for (const name of Object.keys(MATERIALS) as MaterialName[]) {
      for (const base of MATERIALS[name].bases) {
        expect(claimed.has(base), `${base} claimed by two families`).toBe(false);
        expect(Object.keys(TOKENS)).toContain(base);
        claimed.set(base, name);
      }
    }
    expect([...claimed.keys()].sort()).toEqual(Object.keys(TOKENS).sort());
  });
});

describe('palette (style-guide §1, §3.1)', () => {
  it('is the six frozen colours, exactly', () => {
    expect(PALETTE).toEqual({
      vacuum: 0x0d1015,
      hullSteel: 0x7e8894,
      patina: 0x4fa08b,
      signalYellow: 0xf2d24b,
      plasma: 0x4dc3ff,
      threatRed: 0xb23a3a,
    });
  });

  it('is the same Cold Vacuum the render layer draws with — one palette, not two', () => {
    expect(PALETTE).toEqual(RENDER_PALETTE);
    expect([...PLAYER_COLORS]).toEqual([...RENDER_ROSTER]);
  });

  it('is the eight-slot roster, clear of ore yellow and danger red', () => {
    expect(PLAYER_COLORS).toHaveLength(8);
    expect(new Set(PLAYER_COLORS).size).toBe(8);
    expect(PLAYER_COLORS).not.toContain(PALETTE.signalYellow);
    expect(PLAYER_COLORS).not.toContain(PALETTE.threatRed);
  });

  it('admits no seventh hue: every shade recomputes from its declared recipe', () => {
    for (const key of Object.keys(DERIVED_RECIPES) as DerivedKey[]) {
      expect(DERIVED[key], `${key} (${hex(DERIVED[key])}) ≠ its recipe ${hex(derive(key))}`).toBe(derive(key));
      // And the recipe is a *value* operation on one of the six — never a mix
      // of two hues, which is how a seventh colour would sneak in.
      expect(['vacuum', 'white']).toContain(DERIVED_RECIPES[key].toward);
      expect(Object.keys(PALETTE)).toContain(DERIVED_RECIPES[key].base);
    }
  });
});

describe('the RESERVED rule across the whole catalogue (style-guide §2)', () => {
  it('covers a catalogue worth checking', () => {
    expect(ALL_SPRITES.length).toBeGreaterThan(60);
    // Every generator family is represented, so "compliant" means the art set,
    // not a sample of it.
    const names = ALL_SPRITES.map((d) => d.name).join(' ');
    for (const family of ['ship/', 'station/', 'asteroid/', 'ore/', 'turret/', 'shield/', 'wreck/', 'build/']) {
      expect(names, `catalogue has no ${family} sprites`).toContain(family);
    }
  });

  it('passes: no yellow outside ore, core and danger; no red outside danger', () => {
    const violations = auditAll(ALL_SPRITES);
    expect(violations.length, `\n${formatViolations(violations)}`).toBe(0);
    expect(() => assertPaletteCompliance(ALL_SPRITES)).not.toThrow();
  });

  it('uses only allow-listed colours everywhere', () => {
    for (const def of ALL_SPRITES) {
      for (const color of spriteColors(def)) {
        expect(ALLOWED_COLORS.has(color), `${def.name} uses ${hex(color)}`).toBe(true);
      }
    }
  });

  it('keeps every entity legible against Vacuum — nothing is painted the background', () => {
    for (const entry of ART_CATALOGUE) {
      const colors = spriteColors(entry.def);
      const onlyVacuum = colors.length > 0 && colors.every((c) => c === PALETTE.vacuum);
      expect(onlyVacuum, `${entry.def.name} is invisible on Vacuum`).toBe(false);
    }
  });

  // --- The audit has to be able to fail, or it proves nothing --------------

  it('catches yellow used as decoration', () => {
    const bad = sprite('test/bad-yellow', 1, [circle(0, 0, 1, fill(PALETTE.signalYellow, 'material'))]);
    const v = auditSprite(bad);
    expect(v.map((x) => x.rule)).toContain('reserved-yellow');
  });

  it('catches threat red used as a friendly accent', () => {
    const bad = sprite('test/bad-red', 1, [circle(0, 0, 1, fill(PALETTE.threatRed, 'identity'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('reserved-red');
  });

  it('catches a hull repainted in a player colour', () => {
    const bad = sprite('test/bad-hull', 1, [circle(0, 0, 1, fill(PLAYER_COLORS[0], 'material'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('identity-trim');
  });

  it('catches a seventh colour', () => {
    const bad = sprite('test/bad-hue', 1, [circle(0, 0, 1, fill(0xff00ff, 'material'))]);
    expect(auditSprite(bad).map((x) => x.rule)).toContain('allow-list');
    expect(() => assertPaletteCompliance([bad])).toThrow(/palette violation/);
  });
});

// ---------------------------------------------------------------------------
// STATION_HULL_EXCLUSIONS (a2-04) — the ratified removals, guarded both ways
// ---------------------------------------------------------------------------

const VIEW = { width: 800, height: 600, originX: 0, originY: 0 };

/** A two-slot arena, with P1's ship parked on its own station and funded, which
 *  is the state every wheel press below is made from. */
function dockedArena(): { world: World; ship: NonNullable<ReturnType<typeof shipOf>> } {
  const world = createWorld({
    seed: 7,
    players: [0, 1].map((id) => ({ id, shipClass: ShipClass.Vanguard })),
  });
  const station = stationOf(world, 0)!;
  const ship = shipOf(world, 0)!;
  ship.pos = { x: station.pos.x, y: station.pos.y };
  ship.banked = 100;
  return { world, ship };
}

/** Run construction forward until `done`, or fail loudly rather than hang. */
function buildOut(world: World, done: () => boolean): void {
  for (let i = 0; i < 4000 && !done(); i++) updateStations(world, 1 / 60);
  expect(done(), 'construction never finished').toBe(true);
}

/** Live turret sprites the renderer is currently drawing on the buildings layer. */
function turretsOnScreen(stage: Container): number {
  const layer = stage.getChildByLabel('turrets', true) as Container | null;
  if (!layer) throw new Error('turrets layer missing');
  return layer.children.filter((c) => c.visible && (c as Graphics).context?.instructions.length > 0).length;
}

/** Draw instructions in one station's hull graphic — the silhouette, as a number. */
function hullInstructions(stage: Container, index: number): number {
  const node = stage.getChildByLabel(`station-${index}`, true);
  if (!node) throw new Error(`station-${index} missing`);
  return (node as Graphics).context.instructions.length;
}

/** How far from the station centre a shape reaches, in the sprite's unit space. */
function shapeExtent(s: Shape): number {
  if (s.path.kind === 'circle') return Math.hypot(s.path.cx, s.path.cy) + s.path.r;
  let far = 0;
  for (let i = 0; i < s.path.points.length; i += 2) {
    far = Math.max(far, Math.hypot(s.path.points[i]!, s.path.points[i + 1]!));
  }
  return far;
}

/**
 * The same measurement over the RENDERER's hull graphic, in world units — every
 * filled primitive it draws, and how far out each reaches. Pixi keeps a circle as
 * a primitive (`{action:'circle', data:[cx,cy,r]}`), which is exactly what the
 * hull is made of, so this reads real geometry rather than a bounding box that a
 * stroke could inflate.
 */
function hullFillExtents(stage: Container, index: number): number[] {
  const node = stage.getChildByLabel(`station-${index}`, true);
  if (!node) throw new Error(`station-${index} missing`);
  const out: number[] = [];
  for (const ins of (node as Graphics).context.instructions as readonly GraphicsInstruction[]) {
    if (ins.action !== 'fill') continue; // the beacon RING is a stroke — see below
    for (const p of ins.data?.path?.instructions ?? []) {
      if (p.action !== 'circle') continue;
      const [cx, cy, r] = p.data as [number, number, number];
      out.push(Math.hypot(cx, cy) + r);
    }
  }
  expect(out.length, 'read no hull geometry — the probe is broken, not the hull').toBeGreaterThan(0);
  return out;
}

/** The slice of Pixi's instruction record this file reads. */
interface GraphicsInstruction {
  readonly action: string;
  readonly data?: { readonly path?: { readonly instructions?: readonly { action: string; data: unknown }[] } };
}

describe('STATION_HULL_EXCLUSIONS — the ratified removals (a2-04)', () => {
  it('is the list, and the list is short on purpose — one entry per design decision', () => {
    // Ratified 2026-08-07 by the developer: "we dont need the turrets on it,
    // those will be built externally as it already is." Growing this array is a
    // DESIGN change and belongs in a brief, not in a refactor.
    expect([...STATION_HULL_EXCLUSIONS]).toEqual(['turret']);
    for (const term of STATION_HULL_EXCLUSIONS) expect(term).toBe(term.toLowerCase());
  });

  // --- Direction 1: the hull emits nothing on the list ---------------------

  it('the hull manifest names no excluded feature, on any variant', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      for (const { part } of stationHullParts(v)) {
        for (const banned of STATION_HULL_EXCLUSIONS) {
          expect(
            part.toLowerCase().includes(banned),
            `station variant ${v} emits a "${part}" part, which is on the exclusion list`,
          ).toBe(false);
        }
      }
    }
  });

  it('and the manifest is EXHAUSTIVE — every shape the hull draws belongs to a named part', () => {
    // Without this, the check above proves nothing: shapes appended after the
    // manifest is flattened would be unnamed, and therefore unexcludable.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const named = stationHullParts(v).reduce((n, p) => n + p.shapes.length, 0);
      expect(stationSprite(v).shapes.length, `station variant ${v} draws unnamed shapes`).toBe(named);
      expect(named).toBeGreaterThan(0);
      // And no part is a placeholder that names ground it never draws.
      for (const p of stationHullParts(v)) expect(p.shapes.length, `empty part "${p.part}"`).toBeGreaterThan(0);
    }
  });

  it('every shape the hull draws is inside the extent the hull declares', () => {
    // Not a turret check — deliberately. There is NO geometric rule that
    // separates a hull gun from an anchor lug or a spoil boom: all three are
    // outboard structure, and a rule that banned outboard geometry would ban the
    // mining read the facility body exists for (a2-03's spoil boom reaches ~1.85
    // R by design). So the exclusion is carried by the NAMED manifest above, and
    // this is the far weaker thing geometry can honestly say: the hull fits in
    // the box it claims, so `extent` stays a usable pooling/culling bound.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const def = stationSprite(v);
      const GRID_SLACK = 1e-3; // `round()` quantises coordinates to 1e-4
      for (const s of def.shapes) {
        expect(shapeExtent(s), `station v${v} draws to ${shapeExtent(s)}, past its extent ${def.extent}`)
          .toBeLessThanOrEqual(def.extent + GRID_SLACK);
      }
    }
  });

  it('the SHIPPED hull draws exactly what it is declared to draw, and no more', () => {
    // A TRIPWIRE, not a classifier, and stated as one. The renderer's station
    // body is hand-authored Pixi geometry rather than `stationSprite` (a2-03 is
    // the brief that closes that gap), so the named manifest cannot reach it and
    // nothing else would notice four anonymous circles appearing on the body
    // radius — which is precisely the regression this brief exists to prevent.
    //
    // IF YOU ARE HERE BECAUSE THIS FAILED: you changed what a station draws.
    // That is allowed, and it re-baselines the goldens (look at every one). Set
    // the number below to the new count in the same commit, and satisfy yourself
    // that what you added is not a gun — because if it is, the silhouette has
    // started lying about how many turrets are standing (GDD §2.5's re-arm tell).
    const SHIPPED_HULL_DRAW_CALLS = 5; // ocean, two landmasses, beacon ring, core
    const { world } = dockedArena();
    const stage = new Container();
    new Renderer(stage, VIEW).draw(world, { cameraTarget: 0, muzzles: [] });
    expect(hullInstructions(stage, 0)).toBe(SHIPPED_HULL_DRAW_CALLS);

    // And every one of them is centred structure, not a ring of mounts: a turret
    // sits at `radius + mountOffset` (src/sim/constants.ts), so a hull gun is
    // outboard of the body by construction. The shipped hull's only outboard
    // mark is the beacon RING — identity, one stroke, not a fill.
    const station = stationOf(world, 0)!;
    for (const reach of hullFillExtents(stage, 0)) {
      expect(reach, `a hull FILL reaches ${reach}, out where a mount would sit`)
        .toBeLessThan(station.radius + TURRET.mountOffset);
    }
  });

  it('no station-family sprite is a turret by another name', () => {
    const stationFamily = ART_CATALOGUE.filter((e) => e.def.name.startsWith('station/'));
    expect(stationFamily.length).toBeGreaterThan(0);
    for (const e of stationFamily) {
      for (const banned of STATION_HULL_EXCLUSIONS) {
        expect(`${e.def.name} ${e.label}`.toLowerCase()).not.toContain(banned);
      }
    }
  });

  // --- Direction 2: everything NOT on the list is still reachable -----------
  //
  // This is the half that matters. A test that only proved the hull bare would
  // stay green if turrets were deleted from the game entirely — which is exactly
  // the failure mode a named exclusion exists to prevent (removing BANK once
  // silently removed the radar wedge, and nothing noticed for three releases).

  it('the TURRET wedge still builds, and the built turret stands up', () => {
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(station.builds.some((b) => b.kind === 'turret')).toBe(true);
    buildOut(world, () => station.turrets.length === 1);
    expect(station.turrets[0]!.hp).toBe(TURRET.hp);
  });

  it('the ring still caps at 4, queued jobs included', () => {
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    expect(TURRET.capPerStation, 'GDD §2.5 caps a station at FOUR turrets').toBe(4);
    for (let i = 0; i < TURRET.capPerStation; i++) expect(placeOrder(world, ship, 'turret')).toBe('ok');
    expect(placeOrder(world, ship, 'turret')).toBe('cap-reached');
    expect(turretCount(station)).toBe(TURRET.capPerStation);
    buildOut(world, () => station.turrets.length === TURRET.capPerStation);
  });

  it('a destroyed turret still disappears — the count drops and the art goes with it', () => {
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    for (let i = 0; i < TURRET.capPerStation; i++) placeOrder(world, ship, 'turret');
    buildOut(world, () => station.turrets.length === TURRET.capPerStation);

    expect(damageTurret(station.turrets[0]!, TURRET.hp)).toBe(true);
    sweepDeadTurrets(world);
    expect(station.turrets).toHaveLength(TURRET.capPerStation - 1);
    expect(turretCount(station)).toBe(TURRET.capPerStation - 1);
  });

  it('the turret art still renders, from the buildings layer and not from the hull', () => {
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    // Empty ring: the hull is drawn, and nothing stands on it.
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    const bareHull = hullInstructions(stage, 0);
    expect(bareHull).toBeGreaterThan(0);
    expect(turretsOnScreen(stage)).toBe(0);

    // Four built: four turret sprites appear — and the HULL IS UNCHANGED. This
    // is the whole point of the exclusion. If the hull drew its own guns, a
    // station with four built would show eight, and a station with none built
    // would still look armed.
    for (let i = 0; i < TURRET.capPerStation; i++) placeOrder(world, ship, 'turret');
    buildOut(world, () => station.turrets.length === TURRET.capPerStation);
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(turretsOnScreen(stage)).toBe(TURRET.capPerStation);
    expect(hullInstructions(stage, 0)).toBe(bareHull);

    // Ring shot empty: the picture drops with the count, on the same frame.
    for (const t of station.turrets) damageTurret(t, TURRET.hp);
    sweepDeadTurrets(world);
    r.draw(world, { cameraTarget: 0, muzzles: [] });
    expect(turretsOnScreen(stage)).toBe(0);
    expect(hullInstructions(stage, 0)).toBe(bareHull);
  });

  it('and the SHIPPED hull draws nothing outboard either — the same rule, on the renderer', () => {
    // The check above is a comparison, so it holds equally well for a hull that
    // draws four permanent guns — it just draws them in both frames. This is the
    // one that catches that, on the geometry the player actually sees. The
    // renderer's station body is hand-authored Pixi rather than `stationSprite`
    // (a2-03 is the brief that closes that gap), so the exclusion has to be
    // asserted here in its own right or it does not cover the shipped picture.
    const { world } = dockedArena();
    const station = stationOf(world, 0)!;
    const stage = new Container();
    new Renderer(stage, VIEW).draw(world, { cameraTarget: 0, muzzles: [] });

    for (const reach of hullFillExtents(stage, 0)) {
      expect(reach, `the hull fills out to ${reach}, past its radius ${station.radius}`).toBeLessThanOrEqual(
        station.radius + 1e-6,
      );
      // Where a turret would sit is beyond every one of them, by the sim's own
      // mount offset — so this bound is the exclusion, stated in world units.
      expect(reach).toBeLessThan(station.radius + TURRET.mountOffset);
    }
  });

  it('the whole turret art pool is still reachable — every Mk, every state', () => {
    for (const tier of [0, 1, 2]) {
      for (const state of ['idle', 'tracking', 'firing', 'building'] as const) {
        const def = turretSprite({ playerId: 0, state, tier });
        expect(def.shapes.length, `turret Mk${tier + 1} ${state} draws nothing`).toBeGreaterThan(0);
        expect(def.name).toContain('turret/');
      }
      expect(turretSilhouetteForTier(tier)).toBeTruthy();
    }
    // And it is on the review surface, so the palette audit above covers it.
    expect(ALL_SPRITES.some((d) => d.name.startsWith('turret/'))).toBe(true);
  });
});
