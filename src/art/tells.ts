/**
 * src/art/tells.ts — the tell vocabulary. OWNER: Art & Audio Agent.
 *
 * The Art & Audio mandate in one line (GDD §3.6): *"Every mechanic in section 2
 * has a visible and audible tell."* This file is that sentence as a type. A
 * **tell** is one moment worth showing and hearing — a beam biting a rock, a
 * shield shrugging off a hit, a core taking damage, a home dying — and the same
 * queue of tells feeds both halves: `src/art/vfx/` draws them, `src/art/audio/`
 * sounds them. One vocabulary, so a mechanic can never be visible but silent.
 *
 * ## Where tells come from
 *
 * Not from the simulation. `src/sim/` is the Gameplay Engineer's file and it
 * emits no events — it is a plain, hashable state tree, deliberately (GDD §4.1).
 * So tells are **derived by diffing successive world states** (`./vfx/observer`):
 * a crack stage that went up, a rock that vanished with its ore spent, a turret
 * whose cooldown just reset, a planet whose `alive` flipped. Nothing in the sim
 * changes to make art possible, which also means the same derivation works on a
 * client watching *server snapshots* it did not simulate (GDD §4.2).
 *
 * ## Why numbers, not objects
 *
 * The queue is struct-of-arrays over fixed-length typed arrays: a tell is six
 * numbers written into preallocated columns. That is the same discipline the
 * renderer works under — "zero per-frame allocations" (GDD §4.3, risk 5) — and
 * it holds through the busiest frame in the game (a wave landing on a firefight
 * next to a dying planet), because the storage was bought once at construction.
 *
 * ## The payload convention
 *
 * Every tell carries `x, y, angle, magnitude, player`. What they *mean* is
 * per-kind and documented in {@link TELL_PAYLOAD}; the two constants a reader
 * should hold on to are: `angle` is radians in sim space (y-down, +x at angle 0,
 * matching `Ship.angle`), and `magnitude` is normalised 0..1 wherever it is a
 * strength — so the VFX scales a burst and the audio scales a gain from the same
 * number, and they can never disagree about how big a moment was.
 */

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

/**
 * Every moment the game shows and sounds. Numeric so a tell costs no allocation
 * and a switch compiles to a jump table.
 *
 * A plain `const` object rather than an `enum` because `isolatedModules` is on
 * (tsconfig) and a `const enum` is illegal under it — and because a frozen
 * lookup table is what the audio bank and the VFX router both want to index.
 */
export const TELL = {
  // --- Mine (GDD §2.3) -----------------------------------------------------
  /** Beam biting rock. Sustained: re-emitted every firing tick. */
  beamRock: 0,
  /** Beam biting hull, turret, shield or core — the *other* beam voice (§3.6). */
  beamHull: 1,
  /** A rock's crack stage advanced (§5.5, three stages). */
  rockCrack: 2,
  /** A rock mined out: crack-and-burst into ore chunks. */
  rockBurst: 3,
  /** A chunk tractored into a hold. */
  oreCollect: 4,
  /** The hold just hit capacity — "fly home" (§2.3, ore HUD flashes). */
  holdFull: 5,

  // --- Fight (GDD §2.6) ----------------------------------------------------
  /** A turret fired: muzzle flash. */
  turretFire: 6,
  /** A turret shot landed. */
  shotImpact: 7,
  /** A shield took damage: shimmer. */
  shieldHit: 8,
  /** A shield collapsed — pressure beat regeneration (§2.6). */
  shieldDown: 9,
  /** The core took damage. The half of the alarm that is not the alarm. */
  coreHit: 10,
  /** A ship died: explosions are fireworks (§4.7). */
  shipExplode: 11,
  /** A ship (re)spawned — free and fast, 5 s (§2.7). */
  shipSpawn: 12,
  /** Spawn protection still up: the glow pulses while it lasts (§2.1). */
  spawnPulse: 13,
  /** Per-frame thruster state; `magnitude` is throttle 0..1. */
  thrust: 14,

  // --- Spend (GDD §2.5) ----------------------------------------------------
  /** Construction started — ore spent, only time remains. */
  buildPlaced: 15,
  /** A turret or shield finished assembling. */
  buildComplete: 16,
  /** The repair channel is running on a core (§2.5). Periodic while held. */
  repairTick: 17,
  /** Ore moved into the bank: the safe half of the economy. */
  bankOre: 18,
  /** A ship-upgrade tier was bought (§2.5 upgrade panel). */
  upgradeBought: 19,

  // --- The clock (GDD §2.3) ------------------------------------------------
  /** An asteroid wave arrived, each closer to centre than the last. */
  waveArrive: 20,
  /** Collapse phase: no regen, no repair, no new ore. */
  collapseBegin: 21,

  // --- The one serious thing (GDD §4.7) ------------------------------------
  /**
   * A planet core died. The tell that owns the tone paragraph: the game goes
   * quiet for three seconds and nobody jokes (see `./vfx/death-moment`).
   */
  planetDeath: 22,
  /** The match resolved — one planet left standing (§1). */
  matchEnd: 23,

  /** A turret was picked off — the deterrent the attacker paid for (§2.6). */
  turretDown: 24,
} as const;

/** One of the {@link TELL} kinds. */
export type TellKind = (typeof TELL)[keyof typeof TELL];

/** Kind names, indexed by kind. Debugging, test failure messages, and nothing hot. */
export const TELL_NAMES: readonly string[] = (() => {
  const names: string[] = [];
  for (const [name, kind] of Object.entries(TELL)) names[kind] = name;
  return names;
})();

/** How many kinds there are — the width of every per-kind lookup table. */
export const TELL_COUNT = TELL_NAMES.length;

/** What `x, y, angle, magnitude, player` mean for one kind. */
export interface PayloadNote {
  readonly at: string;
  readonly angle: string;
  readonly magnitude: string;
}

/**
 * The payload convention, per kind, in prose — because five bare number columns
 * are exactly the kind of interface that rots. The compliance-minded half of
 * this is a test: every kind has an entry, and every entry names its units.
 */
export const TELL_PAYLOAD: Readonly<Record<TellKind, PayloadNote>> = {
  [TELL.beamRock]: { at: 'the beam hit point', angle: 'beam direction', magnitude: 'beam power 0..1' },
  [TELL.beamHull]: { at: 'the beam hit point', angle: 'beam direction', magnitude: 'beam power 0..1' },
  [TELL.rockCrack]: { at: 'rock centre', angle: 'unused (0)', magnitude: 'new crack stage / 2' },
  [TELL.rockBurst]: { at: 'rock centre', angle: 'unused (0)', magnitude: 'rock radius / 24, clamped' },
  [TELL.oreCollect]: { at: 'the collecting ship', angle: 'chunk → ship direction', magnitude: 'hold fullness 0..1' },
  [TELL.holdFull]: { at: 'the ship', angle: 'unused (0)', magnitude: '1' },
  [TELL.turretFire]: { at: 'the muzzle', angle: 'barrel facing', magnitude: '1' },
  [TELL.shotImpact]: { at: 'where the shot died', angle: 'flight direction', magnitude: 'damage / 10, clamped' },
  [TELL.shieldHit]: { at: 'the shield bubble centre', angle: 'unused (0)', magnitude: 'remaining strength 0..1' },
  [TELL.shieldDown]: { at: 'the shield bubble centre', angle: 'unused (0)', magnitude: 'bubble radius / 64' },
  [TELL.coreHit]: { at: 'the core', angle: 'unused (0)', magnitude: 'remaining core fraction 0..1' },
  [TELL.shipExplode]: { at: 'the wreck point', angle: 'travel direction', magnitude: 'ship radius / 16' },
  [TELL.shipSpawn]: { at: 'the spawn point', angle: 'facing', magnitude: '1' },
  [TELL.spawnPulse]: { at: 'the ship', angle: 'facing', magnitude: 'protection left 0..1' },
  [TELL.thrust]: { at: 'the engine bell (behind the hull)', angle: 'exhaust direction', magnitude: 'throttle 0..1' },
  [TELL.buildPlaced]: { at: 'the planet', angle: 'unused (0)', magnitude: '1 turret, 0.5 shield' },
  [TELL.buildComplete]: { at: 'the finished building', angle: 'mount facing', magnitude: '1 turret, 0.5 shield' },
  [TELL.repairTick]: { at: 'the core', angle: 'unused (0)', magnitude: 'core fraction 0..1' },
  [TELL.bankOre]: { at: 'the planet', angle: 'unused (0)', magnitude: 'ore banked / 8, clamped' },
  [TELL.upgradeBought]: { at: 'the ship', angle: 'unused (0)', magnitude: 'new tier / 4, clamped' },
  [TELL.waveArrive]: { at: 'the arena centre', angle: 'unused (0)', magnitude: 'wave number / 5' },
  [TELL.collapseBegin]: { at: 'the arena centre', angle: 'unused (0)', magnitude: '1' },
  [TELL.planetDeath]: { at: 'the dying planet', angle: 'outward angle from centre', magnitude: 'planet radius / 64' },
  [TELL.matchEnd]: { at: 'the arena centre', angle: 'unused (0)', magnitude: '1 win, 0 loss' },
  [TELL.turretDown]: { at: 'the turret mount', angle: 'barrel facing', magnitude: '1 (player = the owner whose deterrent died)' },
};

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** Default capacity: a wave landing on a firefight next to a dying planet. */
export const TELL_CAPACITY = 512;

/**
 * A fixed-capacity, allocation-free queue of tells for one frame.
 *
 * Filled by the observer, read by the VFX field and the audio engine, then
 * {@link clear}ed. Storage is bought once in the constructor: pushing a tell
 * writes six numbers into typed-array columns and bumps a counter, so the
 * busiest frame in the game allocates nothing (GDD §4.3).
 *
 * **Overflow drops, and says so.** A full queue refuses new tells and counts
 * them in {@link dropped} rather than growing — growing mid-frame is the exact
 * thing the performance budget forbids, and a silently resized buffer would
 * hide it. If `dropped` is ever non-zero in practice, the capacity is wrong and
 * that is a number someone can see.
 */
export class TellQueue {
  readonly capacity: number;

  /** Kind column. */
  readonly kind: Uint8Array;
  /** World x / y of the moment. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Radians, sim space (y-down, +x at 0). */
  readonly angle: Float32Array;
  /** Normalised strength, 0..1, unless {@link TELL_PAYLOAD} says otherwise. */
  readonly magnitude: Float32Array;
  /** Owning player slot, or -1 where a tell belongs to nobody. */
  readonly player: Int8Array;

  private used = 0;
  private overflow = 0;
  /** Backing buffers created. Only the constructor may raise this (see the test). */
  private allocations = 0;

  constructor(capacity: number = TELL_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.kind = this.alloc(() => new Uint8Array(this.capacity));
    this.x = this.alloc(() => new Float32Array(this.capacity));
    this.y = this.alloc(() => new Float32Array(this.capacity));
    this.angle = this.alloc(() => new Float32Array(this.capacity));
    this.magnitude = this.alloc(() => new Float32Array(this.capacity));
    this.player = this.alloc(() => new Int8Array(this.capacity));
  }

  private alloc<T>(make: () => T): T {
    this.allocations++;
    return make();
  }

  /** How many backing buffers this queue has ever created. A test assertion. */
  get bufferCount(): number {
    return this.allocations;
  }

  /** Tells queued this frame. */
  get length(): number {
    return this.used;
  }

  /** Tells refused because the queue was full since the last {@link clear}. */
  get dropped(): number {
    return this.overflow;
  }

  /**
   * Queue one tell. Returns false if it was dropped (queue full).
   *
   * All-numeric on purpose: no options object, so a caller in a hot loop cannot
   * accidentally allocate one per tell.
   */
  push(
    kind: TellKind,
    x: number,
    y: number,
    angle = 0,
    magnitude = 1,
    player = -1,
  ): boolean {
    if (this.used >= this.capacity) {
      this.overflow++;
      return false;
    }
    const i = this.used++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.angle[i] = angle;
    this.magnitude[i] = magnitude;
    this.player[i] = player;
    return true;
  }

  /** The kind at slot `i` (`0 <= i < length`). */
  kindAt(i: number): TellKind {
    return (this.kind[i] ?? 0) as TellKind;
  }

  /** How many tells of one kind are queued. Cheap enough for tests and HUD debug. */
  count(kind: TellKind): number {
    let n = 0;
    for (let i = 0; i < this.used; i++) if (this.kind[i] === kind) n++;
    return n;
  }

  /** True if any tell of this kind is queued. */
  has(kind: TellKind): boolean {
    for (let i = 0; i < this.used; i++) if (this.kind[i] === kind) return true;
    return false;
  }

  /** Index of the first tell of a kind, or -1. */
  indexOf(kind: TellKind): number {
    for (let i = 0; i < this.used; i++) if (this.kind[i] === kind) return i;
    return -1;
  }

  /** Empty the queue for the next frame. Keeps every buffer. */
  clear(): void {
    this.used = 0;
    this.overflow = 0;
  }
}
