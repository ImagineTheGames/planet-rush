/**
 * src/art/vfx/ — the specified VFX set (GDD §3.6). OWNER: Art & Audio Agent.
 *
 * Five layers, each testable without the one above it:
 *
 * | file | what it is |
 * |---|---|
 * | `observer.ts` | world deltas → tells (`../tells`), with no sim changes |
 * | `particles.ts` | the fixed-capacity pool that never allocates mid-frame |
 * | `kinds.ts` | the eleven particle looks, palette-audited like any sprite |
 * | `emitters.ts` | the named effects: impacts, cracks, shimmer, flashes, … |
 * | `field.ts` | the routing table, and the owner of the death moment |
 * | `layer.ts` | the only file here that imports PixiJS |
 *
 * `death-moment.ts` sits beside them holding the tone contract's three seconds
 * of quiet (GDD §4.7), because it belongs to neither the picture nor the sound —
 * both read it.
 */

export * from './particles';
export * from './kinds';
export * from './emitters';
export * from './death-moment';
export * from './observer';
export * from './field';
export * from './layer';
