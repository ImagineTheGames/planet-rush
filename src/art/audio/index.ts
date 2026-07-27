/**
 * src/art/audio/ — the audible half of the mandate. OWNER: Art & Audio Agent.
 *
 * *"Every mechanic in section 2 has a visible and audible tell"* (GDD §3.6).
 * `../vfx/` is the visible half; this is the other one, reading the same tell
 * queue (`../tells`) so the two can never disagree about what happened.
 *
 * | file | what it is |
 * |---|---|
 * | `synth.ts` | jsfxr-style voices rendered to `Float32Array` — pure numbers |
 * | `bank.ts` | every sound in the game, as specs, plus the tell → sound map |
 * | `graph.ts` | four gain nodes and a buffer cache: the whole mix |
 * | `weapons.ts` | held voices — the rock/hull firing pair, and the thruster |
 * | `alarm.ts` | the under-attack alarm (GDD §2.2): a mechanic, not polish |
 * | `music.ts` | the adaptive soundtrack — four stems that follow match phase |
 * | `unlock.ts` | the first user gesture, and the iOS half of it (risk 7) |
 * | `engine.ts` | the routing: tells in, sound out |
 * | `context.ts` | the only file that describes the Web Audio API at all |
 *
 * No binary assets: every sound is a few dozen numbers, rendered at load. Art is
 * code, and so is audio — reproducible, diffable, licence-clean (GDD §4.5).
 *
 * ```ts
 * const ctx = openAudioContext();
 * const audio = new AudioEngine({ context: ctx, local: mySlot, death: field.death });
 * if (ctx) new AudioUnlock(ctx, defaultUnlockTarget()!, { onUnlock: () => audio.start() }).arm();
 * // per frame, over the same queue the VFX field reads:
 * audio.consume(tells);
 * audio.update(dt);
 * ```
 */

export * from './synth';
export * from './bank';
export * from './context';
export * from './graph';
export * from './weapons';
export * from './alarm';
export * from './music';
export * from './unlock';
export * from './engine';
