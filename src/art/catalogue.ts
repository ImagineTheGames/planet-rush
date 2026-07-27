/**
 * src/art/catalogue.ts — every sprite the generators can make. OWNER: Art & Audio.
 *
 * One enumeration, two consumers:
 *
 *  1. **`compliance.test.ts`** walks it and audits every colour on every shape,
 *     so the RESERVED rule (style-guide §2) is checked across the *whole* art
 *     set rather than across whatever a test author remembered to import.
 *  2. **`preview.ts`** renders it to a committed SVG contact sheet, which is how
 *     art review happens in a repo with no art tool: you open one file and look
 *     at the whole game, and a PR diff shows what actually changed.
 *
 * Adding a generator means adding it here. That is the point — a sprite outside
 * the catalogue is a sprite nothing checks.
 */

import { ShipClass } from '@shared/types';
import { asteroidSprite, oreChunkSprite, ASTEROID_KINDS, type AsteroidKind } from './asteroids';
import { buildProgressSprite, shieldSprite, turretSprite } from './buildings';
import {
  atmosphereHaloSprite,
  beaconRingSprite,
  damageRingSprite,
  planetSprite,
  planetVariantNote,
  repairAuraSprite,
  PLANET_VARIANT_COUNT,
} from './planets';
import { SHIP_CLASSES, shipHulkSprite, shipSilhouette, shipSprite } from './ships';
import type { SpriteDef } from './shapes';
import { debrisFieldSprite, planetWreckSprite } from './wrecks';
import { PARTICLE_KINDS, particleSprite } from './vfx/kinds';

/** One catalogued sprite: what it is, and a caption for the contact sheet. */
export interface CatalogueEntry {
  /** Contact-sheet section — also the grouping the compliance failures report. */
  readonly group: string;
  /** Short caption under the tile. */
  readonly label: string;
  readonly def: SpriteDef;
}

const ALL_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7];

function entries(): CatalogueEntry[] {
  const out: CatalogueEntry[] = [];

  // --- Hulls: the 24px legibility subjects, then the full liveries ----------
  for (const c of SHIP_CLASSES) {
    out.push({ group: 'Silhouettes (24px test subjects)', label: c, def: shipSilhouette(c) });
  }
  for (const c of SHIP_CLASSES) {
    for (const slot of ALL_SLOTS) {
      out.push({ group: 'Ships — all eight liveries', label: `${c} P${slot + 1}`, def: shipSprite({ shipClass: c, playerId: slot }) });
    }
  }
  for (const c of SHIP_CLASSES) {
    out.push({
      group: 'Ships — states',
      label: `${c} spawn-protected`,
      def: shipSprite({ shipClass: c, playerId: 0, spawnProtected: true }),
    });
  }
  for (const c of SHIP_CLASSES) {
    for (const damage of ['scarred', 'critical'] as const) {
      out.push({
        group: 'Ships — states',
        label: `${c} ${damage}`,
        def: shipSprite({ shipClass: c, playerId: 0, damage }),
      });
    }
  }
  for (const c of SHIP_CLASSES) {
    out.push({ group: 'Ships — states', label: `${c} hulk`, def: shipHulkSprite(c) });
  }

  // --- Planets --------------------------------------------------------------
  for (let v = 0; v < PLANET_VARIANT_COUNT; v++) {
    out.push({ group: 'Planets — four variants', label: `v${v}: ${planetVariantNote(v)}`, def: planetSprite(v) });
  }
  for (const slot of ALL_SLOTS) {
    out.push({ group: 'Planets — ownership beacons', label: `P${slot + 1}`, def: beaconRingSprite(slot) });
  }
  for (const slot of ALL_SLOTS) {
    out.push({ group: 'Planets — atmosphere halo (deposit range)', label: `P${slot + 1}`, def: atmosphereHaloSprite(slot) });
  }
  for (const f of [1, 0.75, 0.5, 0.25, 0]) {
    // Owner-colour base, red filling as HP is lost (p11) — P1's colour here.
    out.push({ group: 'Planets — scouted damage ring', label: `${Math.round(f * 100)}% core`, def: damageRingSprite(0, f) });
  }
  out.push({ group: 'Planets — scouted damage ring', label: 'repair channel', def: repairAuraSprite() });

  // --- Asteroids: the ratified pool (docs/art-direction §5.5) ----------------
  // Every one of the six by name, across its three crack stages, and rich-vs-poor
  // so the payout read is on the review surface next to the silhouette.
  const KIND_NOTE: Record<AsteroidKind, string> = {
    shard: 'A1 · veins along the fractures',
    ice: 'A2 · frost brightens near breaking',
    rubble: 'A3 · pebbles pop first',
    husk: 'A4 · ore-rimmed cavity',
    geode: 'A5 · crystals countable',
    patina: 'A6 · teal oxidation bands',
  };
  ASTEROID_KINDS.forEach((kind, k) => {
    const group = `Asteroids — A${k + 1} ${kind.toUpperCase()} (${KIND_NOTE[kind]})`;
    const seed = k; // asteroidKindFor(k) === kind, so a natural rock of this type
    // Three crack stages at their natural richness (stage 0 is the full, rich read).
    for (let stage = 0; stage < 3; stage++) {
      out.push({ group, label: `stage ${stage}`, def: asteroidSprite({ seed, crackStage: stage, kind }) });
    }
    // A poor intact rock beside the full one, so the payout read is on the sheet.
    out.push({ group, label: 'stage 0 · poor', def: asteroidSprite({ seed, crackStage: 0, richness: 0.2, kind }) });
  });
  for (const seed of [0, 3]) {
    out.push({ group: 'Asteroids — loose ore chunks', label: `ore chunk ${seed}`, def: oreChunkSprite(seed) });
  }

  // --- Buildings ------------------------------------------------------------
  for (const state of ['building', 'idle', 'tracking', 'firing'] as const) {
    out.push({ group: 'Turrets — threat telegraph', label: state, def: turretSprite({ playerId: 0, state }) });
  }
  out.push({ group: 'Turrets — threat telegraph', label: 'tracking P5', def: turretSprite({ playerId: 4, state: 'tracking' }) });
  for (const strength of ['full', 'weakened', 'failing'] as const) {
    out.push({ group: 'Shields — pressure beats regeneration', label: strength, def: shieldSprite({ playerId: 0, strength }) });
  }
  out.push({ group: 'Shields — pressure beats regeneration', label: 'stacked #2', def: shieldSprite({ playerId: 0, strength: 'full', stackIndex: 1 }) });
  for (const p of [0.2, 0.6, 1]) {
    out.push({ group: 'Shields — pressure beats regeneration', label: `build ${Math.round(p * 100)}%`, def: buildProgressSprite(p) });
  }

  // --- Wrecks ---------------------------------------------------------------
  for (let v = 0; v < PLANET_VARIANT_COUNT; v++) {
    out.push({ group: 'Wrecks — the quiet', label: `wreck v${v}`, def: planetWreckSprite(v) });
  }
  for (const seed of [0, 4]) {
    out.push({ group: 'Wrecks — the quiet', label: `debris ${seed}`, def: debrisFieldSprite(seed) });
  }

  // --- VFX ------------------------------------------------------------------
  // The eleven particle looks carry the whole effects set (./vfx/kinds), and
  // they are sprites like any other — so they belong on the same review surface
  // and go through the same palette audit. A spark that quietly went signal
  // yellow is a RESERVED-rule violation (style-guide §2) whether it is drawn on
  // a hull or thrown by an explosion.
  for (const spec of PARTICLE_KINDS) {
    out.push({ group: 'VFX — the eleven particle looks', label: spec.name, def: particleSprite(spec.kind) });
  }

  return out;
}

/** The whole art set, in contact-sheet order. */
export const ART_CATALOGUE: readonly CatalogueEntry[] = entries();

/** Just the sprites, for the compliance audit. */
export const ALL_SPRITES: readonly SpriteDef[] = ART_CATALOGUE.map((e) => e.def);

/** Sanity check used by tests: the catalogue covers every ship class. */
export const CATALOGUED_CLASSES: readonly ShipClass[] = SHIP_CLASSES;
