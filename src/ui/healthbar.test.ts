/**
 * Over-entity health-bar tests (GDD §2.2, style-guide §2 / §3). The load-bearing
 * contracts, from the developer's field reports:
 *
 *  - a bar is drawn over a combat entity while it is **damaged OR in combat**,
 *    and hidden when it is full *and* idle — the field stays clean;
 *  - **field request v0.1.1:** the local player's own **ship** now GETS a bar
 *    under the same conditions (plus forced on during a siege), carrying the
 *    distinct `local` style flag;
 *  - **field request v0.2.2:** every **turret** — yours and the enemy's — now
 *    GETS a bar when damaged or in combat (a local turret no longer reads off the
 *    HOME HP readout), flagged `turret`; a local turret draws in the player colour
 *    at the narrow enemy size, never the larger own-ship `local` style;
 *  - the fill is the true HP fraction, clamped, and the colour is the owner's
 *    identity colour from the ratified roster — never threat red (reserved for
 *    *your* danger, style-guide §2).
 */
import { describe, it, expect } from 'vitest';
import { PALETTE, PLAYER_COLORS } from '@render/index';
import {
  combatantGetsBar,
  healthBarModel,
  isLocalCombatant,
  HEALTHBAR_FULL_EPSILON,
} from './healthbar';
import type { Combatant } from './healthbar';

/** A full-health, idle, alive enemy at the origin — the "no bar" baseline that
 *  each test perturbs one field of. Owner 3, local player is 0 throughout. */
function enemy(over: Partial<Combatant> = {}): Combatant {
  return {
    owner: 3,
    hp: 50,
    maxHp: 50,
    alive: true,
    inCombat: false,
    pos: { x: 100, y: 100 },
    radius: 12,
    ...over,
  };
}

const LOCAL = 0;

/** A turret (field request v0.2.2) — same baseline as {@link enemy} but flagged
 *  `turret`, so a local one is no longer suppressed by ownership. Defaults to an
 *  enemy-owned turret; pass `owner: LOCAL` for one of yours. */
const turret = (over: Partial<Combatant> = {}): Combatant => enemy({ turret: true, ...over });

describe('which entities get a bar (the field report)', () => {
  it('draws over a damaged enemy', () => {
    expect(combatantGetsBar(enemy({ hp: 30 }), LOCAL)).toBe(true);
  });

  it('draws over a full-health enemy that is in combat', () => {
    // A fresh attacker that has not been scratched yet is still a fight.
    expect(combatantGetsBar(enemy({ hp: 50, inCombat: true }), LOCAL)).toBe(true);
  });

  it('hides over a full-health enemy that is idle — keep the field clean', () => {
    expect(combatantGetsBar(enemy(), LOCAL)).toBe(false);
  });

  it('never draws over a local entity that is neither the own ship nor a turret', () => {
    // Ownership still suppresses a bare local entity (no `local`, no `turret`
    // flag) — only the flagged own ship and turrets are exempt.
    expect(combatantGetsBar(enemy({ owner: LOCAL, hp: 5 }), LOCAL)).toBe(false);
    expect(isLocalCombatant({ owner: LOCAL }, LOCAL)).toBe(true);
    expect(isLocalCombatant({ owner: 3 }, LOCAL)).toBe(false);
  });

  it('never draws over a dead / eliminated entity', () => {
    expect(combatantGetsBar(enemy({ alive: false, hp: 10, inCombat: true }), LOCAL)).toBe(false);
  });

  it('draws over an un-owned hostile wave unit (owner is not the local slot)', () => {
    expect(combatantGetsBar(enemy({ owner: -1, hp: 20 }), LOCAL)).toBe(true);
  });

  it('does not draw over a degenerate maxHp <= 0 entity', () => {
    expect(combatantGetsBar(enemy({ hp: 0, maxHp: 0 }), LOCAL)).toBe(false);
  });

  it('treats a hair of float dust below full as still full (no phantom bar)', () => {
    const dust = enemy({ hp: 50 - HEALTHBAR_FULL_EPSILON / 2, maxHp: 50 });
    expect(combatantGetsBar(dust, LOCAL)).toBe(false);
    // But a real scratch past the epsilon does show.
    expect(combatantGetsBar(enemy({ hp: 49.9, maxHp: 50 }), LOCAL)).toBe(true);
  });
});

describe('the local player’s own ship (field request v0.1.1)', () => {
  /** The camera-followed own ship: local-owned AND flagged `local` — which is
   *  what separates it from the player's turrets. */
  const own = (over: Partial<Combatant> = {}): Combatant =>
    enemy({ owner: LOCAL, local: true, ...over });

  it('DRAWS over the own ship while damaged — the whole point of the request', () => {
    expect(combatantGetsBar(own({ hp: 30 }), LOCAL)).toBe(true);
  });

  it('DRAWS over the own ship at full hull while in combat — same rule as enemies', () => {
    expect(combatantGetsBar(own({ hp: 50, inCombat: true }), LOCAL)).toBe(true);
  });

  it('hides over the own ship when full and idle — the field still stays clean', () => {
    expect(combatantGetsBar(own({ hp: 50 }), LOCAL)).toBe(false);
  });

  it('forces the own ship’s bar on during a siege alarm, even full and idle', () => {
    // always-on while your home is under attack — you are about to fly into it.
    expect(combatantGetsBar(own({ hp: 50, forceShow: true }), LOCAL)).toBe(true);
  });

  it('does not force a bare local entity on via forceShow — the flag is own-ship only', () => {
    // forceShow is the siege affordance for the own ship; a local entity that is
    // neither the flagged ship nor a turret is still suppressed by ownership.
    expect(combatantGetsBar(enemy({ owner: LOCAL, hp: 5, forceShow: true }), LOCAL)).toBe(false);
  });

  it('marks the own ship’s bar with the distinct `local` style flag', () => {
    const [bar] = healthBarModel([own({ hp: 20 })], LOCAL);
    expect(bar?.local).toBe(true);
    // …and an enemy’s bar is NOT local-styled, so the view can tell them apart.
    const [foe] = healthBarModel([enemy({ hp: 20 })], LOCAL);
    expect(foe?.local).toBe(false);
  });

  it('paints the own ship’s bar in the player’s own identity colour', () => {
    const [bar] = healthBarModel([own({ hp: 20 })], LOCAL);
    expect(bar?.color).toBe(PLAYER_COLORS[LOCAL]);
    expect(bar?.color).not.toBe(PALETTE.threatRed);
  });

  it('emits the own ship alongside a damaged own turret and enemies, in input order', () => {
    const frame: Combatant[] = [
      own({ hp: 20, pos: { x: 400, y: 300 } }), // damaged own ship — bar (local style)
      turret({ owner: LOCAL, hp: 5 }), // damaged own turret — bar now (v0.2.2), NOT local style
      enemy({ owner: 2, hp: 40, maxHp: 50 }), // damaged enemy — bar
    ];
    const bars = healthBarModel(frame, LOCAL);
    expect(bars.map((b) => b.owner)).toEqual([LOCAL, LOCAL, 2]);
    // Only the own SHIP carries the larger `local` style — the own turret is a
    // narrow player-colour bar, and the enemy is a narrow enemy bar.
    expect(bars.map((b) => b.local)).toEqual([true, false, false]);
  });
});

describe('turrets show health when damaged (field request v0.2.2)', () => {
  it('draws over a damaged OWN turret — no longer suppressed by ownership', () => {
    expect(combatantGetsBar(turret({ owner: LOCAL, hp: 5 }), LOCAL)).toBe(true);
  });

  it('draws over a damaged ENEMY turret', () => {
    expect(combatantGetsBar(turret({ owner: 3, hp: 5 }), LOCAL)).toBe(true);
  });

  it('draws over a full turret that is in combat (loosing a shot)', () => {
    expect(combatantGetsBar(turret({ owner: LOCAL, hp: 50, inCombat: true }), LOCAL)).toBe(true);
    expect(combatantGetsBar(turret({ owner: 3, hp: 50, inCombat: true }), LOCAL)).toBe(true);
  });

  it('hides over a full, idle turret — own or enemy — the field stays clean', () => {
    expect(combatantGetsBar(turret({ owner: LOCAL, hp: 50 }), LOCAL)).toBe(false);
    expect(combatantGetsBar(turret({ owner: 3, hp: 50 }), LOCAL)).toBe(false);
  });

  it('never draws over a dead turret (hp gone, alive false)', () => {
    expect(combatantGetsBar(turret({ owner: LOCAL, hp: 0, alive: false }), LOCAL)).toBe(false);
  });

  it('paints an own turret in the player colour, at the narrow (non-local) size', () => {
    const [bar] = healthBarModel([turret({ owner: LOCAL, hp: 5, pos: { x: 250, y: 180 } })], LOCAL);
    expect(bar?.owner).toBe(LOCAL);
    expect(bar?.color).toBe(PLAYER_COLORS[LOCAL]);
    // NOT the larger own-ship style — a turret is never `local`-flagged, so the
    // view draws it at the narrow enemy size (just in the player colour).
    expect(bar?.local).toBe(false);
    // The bar tracks the turret's (orbit) position the caller projected.
    expect(bar?.x).toBe(250);
    expect(bar?.y).toBe(180);
  });

  it('paints an enemy turret in the enemy colour, narrow style', () => {
    const [bar] = healthBarModel([turret({ owner: 4, hp: 5 })], LOCAL);
    expect(bar?.color).toBe(PLAYER_COLORS[4]);
    expect(bar?.local).toBe(false);
  });
});

describe('the fill fraction each bar shows', () => {
  it('is the true HP fraction', () => {
    const [bar] = healthBarModel([enemy({ hp: 25, maxHp: 50 })], LOCAL);
    expect(bar?.fraction).toBeCloseTo(0.5);
  });

  it('clamps out-of-range HP instead of over/under-drawing the bar', () => {
    // A shielded/overhealed hp above max, and a negative hp mid-explosion.
    const over = healthBarModel([enemy({ hp: 80, maxHp: 50, inCombat: true })], LOCAL);
    expect(over[0]?.fraction).toBe(1);
    const under = healthBarModel([enemy({ hp: -5, maxHp: 50 })], LOCAL);
    expect(under[0]?.fraction).toBe(0);
  });
});

describe('the bar colour (style-guide §2 / §3 — owner identity, never red)', () => {
  it('is the owner’s identity colour, from the ratified 8-slot roster', () => {
    const [bar] = healthBarModel([enemy({ owner: 5, hp: 20 })], LOCAL);
    expect(bar?.color).toBe(PLAYER_COLORS[5]);
  });

  it('is never threat red — red is your danger, not a tell over an enemy', () => {
    for (let slot = 0; slot < PLAYER_COLORS.length; slot++) {
      const [bar] = healthBarModel([enemy({ owner: slot, hp: 1 })], LOCAL);
      expect(bar?.color).not.toBe(PALETTE.threatRed);
      expect(bar?.color).not.toBe(PALETTE.signalYellow);
    }
  });

  it('degrades an un-owned hostile to steel rather than crashing', () => {
    const [bar] = healthBarModel([enemy({ owner: -1, hp: 20 })], LOCAL);
    expect(bar?.color).toBe(PALETTE.hullSteel);
  });
});

describe('healthBarModel over a whole frame', () => {
  it('emits exactly the bars that should draw, in input order, position passed through', () => {
    const frame: Combatant[] = [
      enemy({ owner: LOCAL, hp: 10, inCombat: true }), // bare local entity (no flag) — no bar
      enemy({ owner: 1, hp: 40, maxHp: 50, pos: { x: 200, y: 150 }, radius: 12 }), // damaged — bar
      enemy({ owner: 2, hp: 50, maxHp: 50 }), // full + idle — no bar
      enemy({ owner: 4, hp: 50, maxHp: 50, inCombat: true, pos: { x: 10, y: 20 } }), // fighting — bar
      enemy({ owner: 6, hp: 0, maxHp: 50, alive: false }), // corpse — no bar
    ];
    const bars = healthBarModel(frame, LOCAL);
    expect(bars.map((b) => b.owner)).toEqual([1, 4]);
    expect(bars[0]?.x).toBe(200);
    expect(bars[0]?.y).toBe(150);
    expect(bars[0]?.fraction).toBeCloseTo(0.8);
    expect(bars[1]?.fraction).toBe(1);
    expect(bars[1]?.radius).toBe(12);
  });

  it('is empty when the field is clean — every enemy full and idle', () => {
    const bars = healthBarModel([enemy({ owner: 1 }), enemy({ owner: 2 })], LOCAL);
    expect(bars).toEqual([]);
  });
});
