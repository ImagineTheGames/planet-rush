/**
 * src/art/ — visuals and audio, generated as code. OWNER: Art & Audio Agent
 * (GDD §3.6, §5).
 *
 * Art is code: every sprite in Planet Rush is a function, not a file. A
 * generator returns a {@link SpriteDef} — plain, hashable, diffable data — and
 * that one definition becomes three things without ever diverging:
 *
 *  - a **pooled GPU texture** for the renderer (./textures),
 *  - an **SVG** for review and the committed contact sheet (./svg, ./preview),
 *  - a **rasterized silhouette** for the 24px legibility test (./raster).
 *
 * That is what makes the art contract enforceable instead of aspirational:
 * `compliance.test.ts` audits every colour on every shape against the RESERVED
 * rule (style-guide §2), and `ships.test.ts` proves the four hulls stay
 * distinguishable at 24 pixels (§4). Both are CI assertions, not review notes.
 *
 * Everything is deterministic — same inputs, deep-equal output — drawing any
 * randomness from the ratified `mulberry32` (`@shared/types`), so a rock looks
 * the same on the client, the server, and in a replay (GDD §4.1).
 *
 * ```ts
 * const cache = new SpriteTextureCache(app.renderer);
 * const tex = cache.getBy(`ship:${cls}:${slot}`, () => shipSprite({ shipClass: cls, playerId: slot }), 64);
 * ```
 *
 * The other two thirds of the mandate live in subdirectories, each with its own
 * index, because each is a whole subsystem rather than another sprite:
 *
 *  - `./vfx/` — the specified VFX set (GDD §3.6): shot impacts, crack-and-burst,
 *    shield shimmer, muzzle flashes, explosions, thruster trails, spawn glow,
 *    and the station-death moment with its three seconds of quiet (§4.7).
 *  - `./audio/` — synthesized SFX, the two firing voices, the under-attack alarm
 *    (§2.2) and the ambient loop. No binary assets: audio is code too.
 *
 * Both read one vocabulary of moments (`./tells`), so a mechanic can never be
 * visible but silent. `./presenter` puts all of it behind one object and two
 * calls a frame, which is the intended way to wire it into the game loop.
 */

export * from './palette';
export * from './materials';
export * from './shapes';
export * from './raster';
export * from './ring-scan';
export * from './decals';
export * from './ships';
export * from './stations';
export * from './asteroids';
export * from './wrecks';
export * from './buildings';
export * from './compliance';
export * from './catalogue';
export * from './svg';
export * from './preview';
export * from './textures';
export * from './atlas';
export * from './tells';
export * from './presenter';
