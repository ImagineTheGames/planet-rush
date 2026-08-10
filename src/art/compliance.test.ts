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
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
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
import {
  beaconRingSprite,
  cutterheadHullParts,
  cutterheadShapes,
  stationHullParts,
  stationSprite,
  stationVariantFor,
  STATION_ART_EXTENT,
  STATION_HULL_EXCLUSIONS,
  STATION_VARIANT_COUNT,
  type CutterheadOptions,
} from './stations';
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
import { circle, fill, sprite, spriteColors, type Shape, type SpriteDef } from './shapes';
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
  return layer.children.filter((c) => c.visible && isPainting(c)).length;
}

/**
 * Whether a pooled child of a render layer is actually PAINTING this frame.
 *
 * ── Touched by a1-11 (Platform), and deliberately narrowly ───────────────────
 * This used to read `(c as Graphics).context?.instructions.length > 0`, which
 * asked *"is this a Graphics with geometry?"* when what the tests below need to
 * know is *"is the gun on screen?"*. The turret layer became pooled `Sprite`s
 * over shared textures when a1-11 wired GDD §4.3's "instanced sprites" (200
 * rocks: 200 draw calls → 1.8), and the old predicate silently counted zero
 * turrets for a stage full of them. The assertions themselves — four built means
 * four drawn, the hull never grows its own guns — are unchanged, and so is what
 * they would catch. Only the "what kind of display object" question is dropped,
 * because the render layer's answer to it is not this file's contract.
 */
function isPainting(node: Container): boolean {
  const context = (node as Graphics).context;
  if (context) return context.instructions.length > 0;
  const texture = (node as Sprite).texture;
  return texture !== undefined && texture !== Texture.EMPTY;
}

/** Draw instructions in one station's hull graphic — the silhouette, as a number. */
function hullInstructions(stage: Container, index: number): number {
  const node = stage.getChildByLabel(`station-${index}`, true);
  if (!node) throw new Error(`station-${index} missing`);
  return (node as Graphics).context.instructions.length;
}

/**
 * How many draw instructions a sprite definition is worth, by `drawSprite`'s own
 * rule (`src/art/textures.ts`): one per fill and one per stroke, in shape order.
 * This is what lets the shipped-hull check below be **derived** from the art
 * rather than pinned to a hand-maintained magic number.
 */
function spriteInstructionCount(def: SpriteDef): number {
  let n = 0;
  for (const s of def.shapes) {
    if (s.fill) n++;
    if (s.stroke) n++;
  }
  return n;
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

/** Every way the hull can be asked to draw itself: four arrangements, eight
 *  rosters, and the derelict — the exclusion holds on all of them or it is not
 *  an exclusion. A wreck takes no owner, which is why it is asked for once. */
const HULL_CONFIGS: readonly { label: string; opts: CutterheadOptions }[] = [
  ...Array.from({ length: STATION_VARIANT_COUNT }, (_, v) =>
    [0, 1, 2, 3, 4, 5, 6, 7].map((p) => ({ label: `v${v} p${p}`, opts: { variant: v, playerId: p } })),
  ).flat(),
  ...Array.from({ length: STATION_VARIANT_COUNT }, (_, v) => ({
    label: `v${v} derelict`,
    opts: { variant: v, dead: true },
  })),
];

describe('STATION_HULL_EXCLUSIONS — the ratified removals (a2-04)', () => {
  it('is the list, and the list is short on purpose — one entry per design decision', () => {
    // Ratified 2026-08-07 by the developer: "we dont need the turrets on it,
    // those will be built externally as it already is." Growing this array is a
    // DESIGN change and belongs in a brief, not in a refactor.
    expect([...STATION_HULL_EXCLUSIONS]).toEqual(['turret']);
    for (const term of STATION_HULL_EXCLUSIONS) expect(term).toBe(term.toLowerCase());
  });

  // --- Direction 1: the hull emits nothing on the list ---------------------
  //
  // Aimed at THE CUTTERHEAD (a2-03) — the hull the developer's amendment is
  // actually about. A guard aimed at a sprite that never had turrets proves
  // nothing; these run against `cutterheadHullParts`, which is what the shipped
  // `stationSprite` is composed from and what the renderer now draws.

  it('the hull manifest names no excluded feature — on any variant, any roster, live or derelict', () => {
    for (const { label, opts } of HULL_CONFIGS) {
      const parts = cutterheadHullParts(opts);
      expect(parts.length, `${label} drew nothing`).toBeGreaterThan(0);
      for (const { part } of parts) {
        for (const banned of STATION_HULL_EXCLUSIONS) {
          expect(
            part.toLowerCase().includes(banned),
            `cutterhead ${label} emits a "${part}" part, which is on the exclusion list`,
          ).toBe(false);
        }
      }
    }
  });

  it('and the manifest is EXHAUSTIVE — every shape the hull draws belongs to a named part', () => {
    // Without this, the check above proves nothing: shapes appended after the
    // manifest is flattened would be unnamed, and therefore unexcludable.
    for (const { label, opts } of HULL_CONFIGS) {
      const parts = cutterheadHullParts(opts);
      const named = parts.reduce((n, p) => n + p.shapes.length, 0);
      expect(cutterheadShapes(opts).length, `cutterhead ${label} draws unnamed shapes`).toBe(named);
      expect(named).toBeGreaterThan(0);
      // And no part is a placeholder that names ground it never draws.
      for (const p of parts) expect(p.shapes.length, `empty part "${p.part}" on ${label}`).toBeGreaterThan(0);
    }
  });

  it('the sprite the game asks for is that same manifest — no second drawing to drift', () => {
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      for (const p of [0, 3, 7]) {
        const named = stationHullParts(v, p).reduce((n, part) => n + part.shapes.length, 0);
        expect(stationSprite(v, p).shapes.length, `station v${v} p${p} draws unnamed shapes`).toBe(named);
      }
    }
  });

  it('the eight anchor lugs are still there — the seat is structure; only the gun was unwelcome', () => {
    // The other half of the amendment, and the half it would be easy to get
    // wrong: "no turrets on the hull" must not become "no mounting ground on the
    // hull." The lug is what clamps the head to its claim AND the seat a bought
    // turret bolts to, and the keyway is where the roster colour lives — so
    // deleting it would cost ownership legibility as well as the mount.
    for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
      const lugs = stationHullParts(v, 3).find((p) => p.part === 'anchor-lugs');
      expect(lugs, `station v${v} has no anchor-lugs part`).toBeDefined();
      // Eight lugs: body + ink outline + lit face + two bolts + one keyway each.
      expect(lugs!.shapes.length, `station v${v} lost lug geometry`).toBe(8 * 6);
      const keyways = lugs!.shapes.filter((s) => s.role === 'identity');
      expect(keyways.length, `station v${v} lost its lug keyways — the roster colour`).toBe(8);
    }
    // A derelict has come loose from its claim: two lugs snapped off, no owner,
    // so no keyways. Still lugs, still not turrets.
    const dead = cutterheadHullParts({ variant: 0, dead: true }).find((p) => p.part === 'anchor-lugs');
    expect(dead!.shapes.length).toBe(6 * 5);
    expect(dead!.shapes.some((s) => s.role === 'identity')).toBe(false);
  });

  it('every shape the hull draws is inside the extent the hull declares', () => {
    // NOT a turret check — deliberately. There is no geometric rule that
    // separates a hull gun from an anchor lug or a spoil boom: all three are
    // outboard structure, and a rule that banned outboard geometry would ban the
    // mining read the Cutterhead was picked for (its spoil boom's tailings drift
    // to ~1.85 R by design). So the exclusion is carried by the NAMED manifest
    // above, and this is the far weaker thing geometry can honestly say: the hull
    // fits in the box it claims, so `extent` stays a usable pooling/culling bound.
    for (const { label, opts } of HULL_CONFIGS) {
      const GRID_SLACK = 1e-3; // `round()` quantises coordinates to 1e-4
      for (const s of cutterheadShapes(opts)) {
        expect(shapeExtent(s), `cutterhead ${label} draws to ${shapeExtent(s)}, past ${STATION_ART_EXTENT}`)
          .toBeLessThanOrEqual(STATION_ART_EXTENT + GRID_SLACK);
      }
    }
  });

  it('the SHIPPED hull is that sprite and nothing else — mark for mark', () => {
    // a2-03 closed the gap this test used to work around: the renderer's station
    // body was hand-authored Pixi (three discs and a ring stroke, in hexes no
    // audit could see), so the named manifest could not reach the picture the
    // player sees and the best available check was a hand-maintained draw-call
    // tripwire. `src/render/index.ts` now plays `stationSprite` + `beaconRingSprite`
    // through `drawSprite`, so the count below is DERIVED from the art itself.
    //
    // IF YOU ARE HERE BECAUSE THIS FAILED: the renderer is drawing station
    // geometry that does not come from `src/art/stations.ts` — which is exactly
    // how four anonymous guns would get onto a hull without the manifest, the
    // palette audit or the concept board ever seeing them.
    const { world } = dockedArena();
    const station = stationOf(world, 0)!;
    const stage = new Container();
    new Renderer(stage, VIEW).draw(world, { cameraTarget: 0, muzzles: [] });

    const expected =
      spriteInstructionCount(stationSprite(stationVariantFor(station.owner), station.owner)) +
      spriteInstructionCount(beaconRingSprite(station.owner));
    expect(hullInstructions(stage, 0)).toBe(expected);
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

  it('the turret art still renders, from the buildings layer and not from the Cutterhead', () => {
    // THE FRAME PAIR THIS BRIEF TURNS ON, as an assertion: a station with four
    // built and the same station shot empty are different pictures, and the
    // difference is entirely in the turret layer. The hull does not move.
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    // Empty ring: the Cutterhead is drawn, and nothing stands on its lugs.
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

  it('the turret layer tracks the sim count at every step, not just at the ends', () => {
    // The check above compares three snapshots; this one walks the count up and
    // back down and asserts the picture at each stop, which is the re-arm tell
    // (GDD §2.5) stated as a test rather than as a pair of screenshots.
    const { world, ship } = dockedArena();
    const station = stationOf(world, 0)!;
    const stage = new Container();
    const r = new Renderer(stage, VIEW);

    for (let n = 1; n <= TURRET.capPerStation; n++) {
      placeOrder(world, ship, 'turret');
      buildOut(world, () => station.turrets.length === n);
      r.draw(world, { cameraTarget: 0, muzzles: [] });
      expect(turretsOnScreen(stage), `${n} built, ${turretsOnScreen(stage)} drawn`).toBe(turretCount(station));
    }
    for (let n = TURRET.capPerStation; n > 0; n--) {
      damageTurret(station.turrets[0]!, TURRET.hp);
      sweepDeadTurrets(world);
      r.draw(world, { cameraTarget: 0, muzzles: [] });
      expect(turretsOnScreen(stage), `${n - 1} standing, ${turretsOnScreen(stage)} drawn`).toBe(turretCount(station));
    }
    expect(turretCount(station)).toBe(0);
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
