/**
 * src/art/vfx/particles.ts — the pool. OWNER: Art & Audio Agent.
 *
 * GDD §4.3 names the performance budget the whole render side lives inside:
 * *"8 ships, up to 32 turrets, ~200 asteroids, hundreds of projectiles at 60 fps
 * on integrated graphics: object pooling, spatial hash collisions, instanced
 * sprites, **zero per-frame allocations***" — and risk 5 says that discipline is
 * built in from M1 rather than retrofitted. Particles are where a VFX set breaks
 * that promise, because the natural way to write them (`particles.push({...})`
 * per spark) allocates on exactly the frames that are already the worst ones:
 * an explosion, a wave landing, a station dying.
 *
 * So this pool buys its storage **once**, in the constructor, and never again:
 *
 *  - **Struct of arrays.** One typed array per field, `capacity` long. A
 *    particle is an index, not an object, so emitting one writes numbers into
 *    slots that already exist.
 *  - **All-numeric API.** {@link ParticlePool.emit} takes thirteen numbers and
 *    no options object, so a caller in a burst loop cannot allocate one per
 *    particle by accident.
 *  - **Swap-remove.** Dead particles are filled from the tail; live ones stay
 *    packed in `[0, count)`, so the update loop is linear with no holes and the
 *    draw loop can read straight down the columns.
 *  - **Full means full.** At capacity, a new particle *takes over* an existing
 *    slot rather than growing the arrays — a firework that lands during a wave
 *    steals an old smoke puff instead of allocating. Every steal is counted
 *    ({@link stolen}) so a capacity that is genuinely too small is a visible
 *    number rather than a mystery.
 *
 * `particles.test.ts` is the assertion that this is true and stays true: it
 * records every backing buffer, runs tens of thousands of emissions and frames,
 * and fails if a single new buffer appears or a single reference changes.
 */

/** Default pool size: every simultaneous burst the design can produce, plus air. */
export const PARTICLE_CAPACITY = 1600;

/**
 * A fixed-capacity particle system as parallel typed arrays.
 *
 * Fields are public and readonly so the draw layer (`./layer`) can walk the
 * columns directly — an accessor per particle per frame would be the other way
 * to spend the budget this class exists to protect.
 */
export class ParticlePool {
  readonly capacity: number;

  /** Which look to draw (`./kinds`). */
  readonly kind: Uint8Array;
  /** Packed RGB tint. `0xRRGGBB`, always a palette or roster colour (`./kinds`). */
  readonly color: Uint32Array;
  /** World position. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** World velocity, units/s. */
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Seconds lived, and seconds it gets. */
  readonly age: Float32Array;
  readonly ttl: Float32Array;
  /** Radius at birth and at death, world units — interpolated by {@link radiusAt}. */
  readonly r0: Float32Array;
  readonly r1: Float32Array;
  /** Rotation (radians) and spin (radians/s). */
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  /** Linear drag per second: `v -= v * drag * dt`. Zero flies straight forever. */
  readonly drag: Float32Array;
  /** Peak alpha; the kind's fade curve shapes it over the lifetime. */
  readonly alpha: Float32Array;

  private live = 0;
  private victim = 0;
  private steals = 0;
  private allocations = 0;

  constructor(capacity: number = PARTICLE_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
    const n = this.capacity;
    this.kind = this.alloc(() => new Uint8Array(n));
    this.color = this.alloc(() => new Uint32Array(n));
    this.x = this.alloc(() => new Float32Array(n));
    this.y = this.alloc(() => new Float32Array(n));
    this.vx = this.alloc(() => new Float32Array(n));
    this.vy = this.alloc(() => new Float32Array(n));
    this.age = this.alloc(() => new Float32Array(n));
    this.ttl = this.alloc(() => new Float32Array(n));
    this.r0 = this.alloc(() => new Float32Array(n));
    this.r1 = this.alloc(() => new Float32Array(n));
    this.rot = this.alloc(() => new Float32Array(n));
    this.spin = this.alloc(() => new Float32Array(n));
    this.drag = this.alloc(() => new Float32Array(n));
    this.alpha = this.alloc(() => new Float32Array(n));
  }

  /** The only place storage is ever created. The test watches this counter. */
  private alloc<T>(make: () => T): T {
    this.allocations++;
    return make();
  }

  /** Backing buffers ever created. Constant after construction, by contract. */
  get bufferCount(): number {
    return this.allocations;
  }

  /** Live particles, packed in `[0, count)`. */
  get count(): number {
    return this.live;
  }

  /** True when the next emission will have to steal a slot. */
  get full(): boolean {
    return this.live >= this.capacity;
  }

  /** Slots taken over from older particles since construction (see class doc). */
  get stolen(): number {
    return this.steals;
  }

  /**
   * Add one particle and return its slot.
   *
   * Thirteen numbers, no object: this is the hot path, called up to a few dozen
   * times per burst and several bursts per frame.
   *
   * @param kind   Look to draw — a `PARTICLE` value (`./kinds`).
   * @param color  Packed RGB tint, `0xRRGGBB`.
   * @param x,y    Spawn position, world units.
   * @param vx,vy  Initial velocity, world units/s.
   * @param ttl    Lifetime in seconds. Values ≤ 0 are clamped to one frame.
   * @param r0,r1  Radius at birth and death, world units.
   * @param rot    Initial rotation, radians.
   * @param spin   Rotation rate, radians/s.
   * @param drag   Velocity decay per second.
   * @param alpha  Peak opacity, 0..1.
   */
  emit(
    kind: number,
    color: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ttl: number,
    r0: number,
    r1: number,
    rot = 0,
    spin = 0,
    drag = 0,
    alpha = 1,
  ): number {
    let i: number;
    if (this.live < this.capacity) {
      i = this.live++;
    } else {
      // Full: cycle a victim so a new burst always shows, and an old one thins.
      i = this.victim;
      this.victim = (this.victim + 1) % this.capacity;
      this.steals++;
    }
    this.kind[i] = kind;
    this.color[i] = color >>> 0;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.age[i] = 0;
    this.ttl[i] = ttl > 0 ? ttl : 1 / 60;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.rot[i] = rot;
    this.spin[i] = spin;
    this.drag[i] = drag;
    this.alpha[i] = alpha;
    return i;
  }

  /**
   * Integrate every live particle and retire the expired ones.
   *
   * Euler with linear drag, matching the sim's own movement model (GDD §4.1) —
   * a spark and a ship slow down the same way, so debris from an explosion
   * drifts like it belongs to the world it came from.
   */
  update(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < this.live; i++) {
      const age = this.age[i]! + dt;
      if (age >= this.ttl[i]!) {
        this.retire(i);
        i--; // the tail particle moved into slot i and has not been stepped yet
        continue;
      }
      this.age[i] = age;
      const decay = 1 - this.drag[i]! * dt;
      const k = decay > 0 ? decay : 0;
      this.vx[i] = this.vx[i]! * k;
      this.vy[i] = this.vy[i]! * k;
      this.x[i] = this.x[i]! + this.vx[i]! * dt;
      this.y[i] = this.y[i]! + this.vy[i]! * dt;
      this.rot[i] = this.rot[i]! + this.spin[i]! * dt;
    }
  }

  /** Lifetime progress of slot `i`, 0 at birth → 1 at death. */
  progress(i: number): number {
    const ttl = this.ttl[i]!;
    return ttl > 0 ? Math.min(1, this.age[i]! / ttl) : 1;
  }

  /** Current radius of slot `i`, world units. */
  radiusAt(i: number): number {
    const p = this.progress(i);
    return this.r0[i]! + (this.r1[i]! - this.r0[i]!) * p;
  }

  /** Kill everything without touching a buffer — a match teardown or a rejoin. */
  clear(): void {
    this.live = 0;
    this.victim = 0;
  }

  /** Swap-remove: the last live particle fills the hole. */
  private retire(i: number): void {
    const last = --this.live;
    if (i !== last) this.copy(last, i);
  }

  private copy(from: number, to: number): void {
    this.kind[to] = this.kind[from]!;
    this.color[to] = this.color[from]!;
    this.x[to] = this.x[from]!;
    this.y[to] = this.y[from]!;
    this.vx[to] = this.vx[from]!;
    this.vy[to] = this.vy[from]!;
    this.age[to] = this.age[from]!;
    this.ttl[to] = this.ttl[from]!;
    this.r0[to] = this.r0[from]!;
    this.r1[to] = this.r1[from]!;
    this.rot[to] = this.rot[from]!;
    this.spin[to] = this.spin[from]!;
    this.drag[to] = this.drag[from]!;
    this.alpha[to] = this.alpha[from]!;
  }
}
