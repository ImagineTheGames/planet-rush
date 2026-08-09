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
  stationSprite,
  stationVariantFor,
  repairAuraSprite,
  STATION_VARIANT_COUNT,
} from './stations';
import { SHIP_CLASSES, shipHulkSprite, shipSilhouette, shipSprite } from './ships';
import { satelliteSprite, satelliteWreckSprite } from './satellite';
import type { SpriteDef } from './shapes';
import { debrisFieldSprite, stationWreckSprite } from './wrecks';
import { PARTICLE_KINDS, particleSprite } from './vfx/kinds';
import { SHOT_FAMILIES, SHOT_TIERS, shotSprite } from './vfx/shots';
import {
  MAP_NEBULA,
  NEBULAE,
  NEBULA_IDS,
  STAR_LAYERS,
  VOID_SEED,
  nebulaTileSprite,
  starFieldSprite,
  type MapId,
  type NebulaId,
} from './backdrop';

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

  // --- Stations: THE CUTTERHEAD (facility-concepts-r2.html, direction D) -----
  // The board's own ownership card is the claim being audited here: "one sprite,
  // one palette swap: the roster colour touches the beacon ring, the damage ring
  // and a few trim marks — never the steel."
  // Exactly the eight the game builds — `stationVariantFor(owner)` is `owner % 4`,
  // so this row is four arrangements AND eight roster colours at once, and it is
  // the eight sprites a full match actually pools.
  // The tile caption is centred in a 104px cell, so it stays SHORT — a variant's
  // one-line note (`stationVariantNote`) belongs in a failing-test message, not
  // here, where four of them side by side overlap into an unreadable smear.
  for (const slot of ALL_SLOTS) {
    const v = stationVariantFor(slot);
    out.push({
      group: 'Facilities — the Cutterhead: 4 arrangements × 8 owners',
      label: `P${slot + 1} · v${v}`,
      def: stationSprite(v, slot),
    });
  }
  for (const slot of ALL_SLOTS) {
    out.push({ group: 'Stations — ownership beacons', label: `P${slot + 1}`, def: beaconRingSprite(slot) });
  }
  for (const slot of ALL_SLOTS) {
    out.push({ group: 'Stations — atmosphere halo (deposit range)', label: `P${slot + 1}`, def: atmosphereHaloSprite(slot) });
  }
  for (const f of [1, 0.75, 0.5, 0.25, 0]) {
    // Owner-colour base, red filling as HP is lost (p11) — P1's colour here.
    out.push({ group: 'Stations — scouted damage ring', label: `${Math.round(f * 100)}% core`, def: damageRingSprite(0, f) });
  }
  out.push({ group: 'Stations — scouted damage ring', label: 'repair channel', def: repairAuraSprite() });

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
  // The ratified turret pool (docs/art-direction §5.5), mapped onto the Mk ladder
  // so the body and the shot-tier ramp tell one escalating story. Each silhouette
  // shows its three live telegraph states; the scaffold and an enemy-colour read
  // sit below (`building` is one look — a fresh build is always Mk I).
  const TURRET_POOL = [
    { sil: 'breech', title: 'T5 Breech Cannon · Mk I' },
    { sil: 'twin', title: 'T7 Twin Cannon · Mk II' },
    { sil: 'rail', title: 'T3b Rail Spike · Mk III' },
    { sil: 'dome', title: 'T6 Dome Bunker · reserve' },
  ] as const;
  for (const t of TURRET_POOL) {
    for (const state of ['idle', 'tracking', 'firing'] as const) {
      out.push({ group: `Turrets — ${t.title}`, label: state, def: turretSprite({ playerId: 0, state, silhouette: t.sil }) });
    }
  }
  out.push({ group: 'Turrets — build & identity', label: 'building scaffold', def: turretSprite({ playerId: 0, state: 'building' }) });
  out.push({ group: 'Turrets — build & identity', label: 'Mk II · P5 tracking', def: turretSprite({ playerId: 4, state: 'tracking', tier: 1 }) });
  for (const strength of ['full', 'weakened', 'failing'] as const) {
    out.push({ group: 'Shields — pressure beats regeneration', label: strength, def: shieldSprite({ playerId: 0, strength }) });
  }
  out.push({ group: 'Shields — pressure beats regeneration', label: 'stacked #2', def: shieldSprite({ playerId: 0, strength: 'full', stackIndex: 1 }) });
  for (const p of [0.2, 0.6, 1]) {
    out.push({ group: 'Shields — pressure beats regeneration', label: `build ${Math.round(p * 100)}%`, def: buildProgressSprite(p) });
  }

  // --- Satellites -----------------------------------------------------------
  // The radar eye (f1): a DISH in the 5.5 structure language, distinct from every
  // turret in the pool. Its live sensor states sit next to an enemy-colour read
  // and the scaffold, and its cold death remnant sits below — the wreck language,
  // with nothing to loot (a satellite carries no ore bank).
  for (const state of ['idle', 'sweeping', 'pinging'] as const) {
    out.push({ group: 'Satellites — the radar eye', label: state, def: satelliteSprite({ playerId: 0, state }) });
  }
  out.push({ group: 'Satellites — build & identity', label: 'P5 sweeping', def: satelliteSprite({ playerId: 4, state: 'sweeping' }) });
  out.push({ group: 'Satellites — build & identity', label: 'building scaffold', def: satelliteSprite({ playerId: 0, state: 'building' }) });
  for (const seed of [0, 2]) {
    out.push({ group: 'Satellites — build & identity', label: `downed dish ${seed}`, def: satelliteWreckSprite(seed) });
  }

  // --- Wrecks ---------------------------------------------------------------
  for (let v = 0; v < STATION_VARIANT_COUNT; v++) {
    out.push({ group: 'Wrecks — the quiet (and the lootable derelict)', label: `derelict v${v}`, def: stationWreckSprite(v) });
  }
  for (const seed of [0, 4]) {
    out.push({ group: 'Wrecks — the quiet (and the lootable derelict)', label: `debris ${seed}`, def: debrisFieldSprite(seed) });
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

  // The DAMAGE-tier shot ramp (p11-06): a shooter's weapon tier tints its shot,
  // brightening within its own family — `own` fire up the plasma family, `enemy`
  // fire up the threat-red family — so "how strong" reads at a glance without ever
  // spending signal yellow. Every rung sits on the review surface next to the
  // turret pool it escalates alongside, and goes through the same palette audit.
  for (const family of SHOT_FAMILIES) {
    for (const tier of SHOT_TIERS) {
      out.push({
        group: `Shots — DAMAGE-tier ramp (${family} fire)`,
        label: `tier ${tier}`,
        def: shotSprite(family, tier),
      });
    }
  }

  // --- The void (a2-06, re-grounded a0-07) ----------------------------------
  // The layered parallax star-field the fleet flies against (./backdrop). Sampled
  // here at a fixed review tile so the palette audit covers the void's colours —
  // the live field is the same generator at arena scale. Steel value-ramp stars:
  // no seventh hue, all role `material` (style-guide §1). A sample star that went
  // signal yellow would be a RESERVED-rule violation like any other sprite.
  const VOID_TILE = { w: 480, h: 300 } as const;
  const LAYER_NOTE: Record<string, string> = {
    deep: 'far dust — dim, dense, no white',
    mid: 'mid field — lit steel + a little white',
    near: 'near points — the ramp’s white endpoint, faint glints',
  };
  for (const spec of STAR_LAYERS) {
    out.push({
      group: 'The void — parallax star-field',
      label: `${spec.key}: ${LAYER_NOTE[spec.key] ?? ''}`,
      def: starFieldSprite(spec, VOID_SEED, VOID_TILE.w, VOID_TILE.h),
    });
  }
  // The six ratified skies (a0-07), one per map. Each tile is the WHOLE stack in
  // composite order — Floor, stars, and the sky either behind them or in front —
  // because a 5%-alpha wash on its own is an invisible tile, and because the one
  // sky whose entire point is what it REMOVES (Coalsack) says nothing without
  // stars behind it to remove. Which map flies under which is on the caption.
  const SKY_OF: Partial<Record<NebulaId, MapId>> = {};
  for (const [mapId, nebulaId] of Object.entries(MAP_NEBULA) as [MapId, NebulaId][]) {
    SKY_OF[nebulaId] = mapId;
  }
  for (const id of NEBULA_IDS) {
    const spec = NEBULAE[id];
    const map = SKY_OF[id];
    out.push({
      group: 'The void — the six skies (one per map)',
      label: `${spec.name} — ${map ?? 'unassigned (a0-12)'}`,
      def: nebulaTileSprite(id, VOID_SEED, VOID_TILE.w, VOID_TILE.h),
    });
  }

  return out;
}

/** The whole art set, in contact-sheet order. */
export const ART_CATALOGUE: readonly CatalogueEntry[] = entries();

/** Just the sprites, for the compliance audit. */
export const ALL_SPRITES: readonly SpriteDef[] = ART_CATALOGUE.map((e) => e.def);

/** Sanity check used by tests: the catalogue covers every ship class. */
export const CATALOGUED_CLASSES: readonly ShipClass[] = SHIP_CLASSES;
